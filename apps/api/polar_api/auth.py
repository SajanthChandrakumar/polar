"""Opaque owner sessions, one-use OAuth state and serialized server token refresh."""
import asyncio
import hashlib
import hmac
import ipaddress
import os
import secrets
from datetime import timedelta

import httpx
from cryptography.fernet import Fernet
from fastapi import HTTPException

from .store import now


class Auth:
    COOKIE = 'polar_session'
    SESSION_SECONDS = 12 * 60 * 60

    def __init__(self, settings, store):
        self.settings, self.store = settings, store
        self.cipher = Fernet(settings.token_encryption_key.encode())
        self.refresh_lock = asyncio.Lock()

    def _hash(self, value):
        return hashlib.sha256(value.encode()).hexdigest()

    def _signature(self, value):
        return hmac.new(self.settings.session_secret.encode(), value.encode(), hashlib.sha256).hexdigest()

    def session(self, request):
        cookie = request.cookies.get(self.COOKIE, '')
        if len(cookie) > 200 or '.' not in cookie:
            return None
        sid, signature = cookie.split('.', 1)
        if not hmac.compare_digest(self._signature(sid), signature):
            return None
        return self.store.db.sessions.find_one({'_id': self._hash(sid), 'expires_at': {'$gt': now()}})

    def require(self, request):
        session = self.session(request)
        if not session:
            raise HTTPException(401, 'Anmeldung erforderlich.')
        return session

    def origin(self, request):
        if request.headers.get('origin') != self.settings.public_url:
            raise HTTPException(403, 'Ungültiger Anfrageursprung.')

    def _login_client_host(self, request):
        if os.getenv('RENDER') == 'true':
            addresses = request.headers.getlist('cf-connecting-ip')
            if len(addresses) != 1:
                raise HTTPException(503, 'Anmeldung derzeit nicht verfügbar.')
            try:
                return str(ipaddress.ip_address(addresses[0]))
            except ValueError:
                raise HTTPException(503, 'Anmeldung derzeit nicht verfügbar.') from None
        return request.client.host if request.client and request.client.host else '<missing-client>'

    def login(self, request, password, response):
        self.origin(request)
        # Render's edge overwrites CF-Connecting-IP; X-Forwarded-For is not trusted.
        client_host = self._login_client_host(request)
        timestamp = now()
        bucket = int(timestamp.timestamp()) // 60
        client_id = hmac.new(self.settings.session_secret.encode(), b'login-limit:' + client_host.encode(), hashlib.sha256).hexdigest()
        attempt = self.store.db.login_limits.find_one_and_update({'_id': f'{bucket}:{client_id}'}, {'$inc': {'attempts': 1}, '$set': {'expires_at': timestamp + timedelta(minutes=2)}}, upsert=True, return_document=True)
        if attempt['attempts'] > 5:
            raise HTTPException(429, 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.', headers={'Retry-After': '60'})
        if not hmac.compare_digest(self._hash(password), self._hash(self.settings.owner_password)):
            raise HTTPException(401, 'Anmeldung fehlgeschlagen.')
        sid = secrets.token_urlsafe(32)
        self.store.db.sessions.insert_one({'_id': self._hash(sid), 'expires_at': timestamp + timedelta(seconds=self.SESSION_SECONDS)})
        response.set_cookie(self.COOKIE, sid + '.' + self._signature(sid), httponly=True,
                            secure=self.settings.secure_cookie, samesite='lax', max_age=self.SESSION_SECONDS, path='/')

    def logout(self, request, response):
        self.origin(request)
        session = self.require(request)
        self.store.db.sessions.delete_one({'_id': session['_id']})
        self.store.db.oauth_states.delete_many({'session': session['_id']})
        response.delete_cookie(self.COOKIE, httponly=True, secure=self.settings.secure_cookie, samesite='lax', path='/')

    def state(self, session):
        value = secrets.token_urlsafe(32)
        self.store.db.oauth_states.insert_one({'_id': self._hash(value), 'session': session['_id'], 'expires_at': now() + timedelta(minutes=10)})
        return value

    def consume_state(self, request, state):
        session = self.session(request)
        if not session or not state or len(state) > 200:
            raise HTTPException(400, 'Ungültige oder abgelaufene Polar-Anfrage.')
        found = self.store.db.oauth_states.find_one_and_delete({'_id': self._hash(state), 'session': session['_id'], 'expires_at': {'$gt': now()}})
        if not found:
            raise HTTPException(400, 'Ungültige oder abgelaufene Polar-Anfrage.')

    async def exchange(self, client, data):
        try:
            response = await client.post('https://auth.polar.com/oauth/token', data=data,
                                         auth=httpx.BasicAuth(self.settings.client_id, self.settings.client_secret))
            if response.status_code != 200:
                raise ValueError()
            tokens = response.json()
            self.store.save_tokens(tokens, self.cipher)
            return tokens['access_token']
        except (httpx.HTTPError, ValueError, KeyError):
            self.store.connection_failed()
            raise HTTPException(502, 'Polar-Verbindung konnte nicht erneuert werden.') from None

    async def access_token(self, client, force_refresh=False):
        async with self.refresh_lock:
            tokens = self.store.tokens(self.cipher)
            if not tokens:
                raise HTTPException(409, 'Polar-Verbindung erforderlich.')
            if not force_refresh and tokens['expires_at'] > now().timestamp() + 60:
                return tokens['access_token']
            return await self.exchange(client, {'grant_type': 'refresh_token', 'refresh_token': tokens['refresh_token']})
