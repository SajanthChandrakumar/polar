"""Private Polar dashboard API. API GET requests never collect Polar data."""
import asyncio
import json
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from .auth import Auth
from .config import Settings
from .store import Store, RunBusy, Cooldown, LeaseLost, public


class LoginBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    password: str = Field(max_length=1024)


class SyncBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    automatic: bool = False


def create_app(settings=None, store=None, *, transport=None, collector=None):
    settings = settings or Settings.from_env()
    settings.validate()
    if store is None:
        if not settings.mongodb_uri:
            raise RuntimeError('MongoDB configuration is missing')
        mongo = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=4000, connectTimeoutMS=4000, tz_aware=True)
        store = Store(mongo[settings.database])
    else:
        mongo = None
    auth = Auth(settings, store)
    tasks = set()

    @asynccontextmanager
    async def lifespan(app):
        try:
            store.initialize()
        except PyMongoError:
            logging.getLogger(__name__).warning('MongoDB unavailable during startup')
        yield
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if mongo is not None:
            mongo.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store, app.state.auth = store, auth

    @app.middleware('http')
    async def privacy_headers(request, call_next):
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        return response

    @app.exception_handler(PyMongoError)
    async def db_error(request, exception):
        return JSONResponse({'detail': 'Datenspeicher derzeit nicht erreichbar.'}, status_code=503)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exception):
        # Pydantic's default error includes supplied input (including passwords).
        return JSONResponse({'detail': 'Ungültige Anfrage.'}, status_code=422)

    def inventory():
        from .inventory import ENDPOINTS
        return ENDPOINTS

    @app.get('/api/health')
    def health():
        store.db.command('ping')
        if not (settings.frontend_dist / 'index.html').is_file():
            raise HTTPException(503, 'Dashboard-Build noch nicht vorhanden.')
        return {'status': 'ok'}

    @app.get('/api/session')
    def session(request: Request):
        return {'authenticated': bool(auth.session(request))}

    @app.post('/api/login')
    def login(request: Request, body: LoginBody, response: Response):
        auth.login(request, body.password, response)
        return {'authenticated': True}

    @app.post('/api/logout', status_code=204)
    def logout(request: Request, response: Response):
        auth.logout(request, response)

    @app.get('/api/dashboard')
    def dashboard(request: Request):
        auth.require(request)
        connected, error = store.connection()
        from .metrics import dashboard_metrics
        sources = store.sources(inventory())
        return {'connected': connected, 'connection_error': error, 'last_sync': store.latest_run(), 'sources': sources, 'metrics': dashboard_metrics(store, sources)}

    @app.get('/api/endpoints')
    def endpoints(request: Request):
        auth.require(request)
        return inventory()

    @app.get('/api/analytics')
    def analytics_view(request: Request, days: int = 30):
        auth.require(request)
        if days not in (7, 30, 90):
            raise HTTPException(422, 'Zeitraum muss 7, 30 oder 90 Tage betragen.')
        from .analytics import analytics
        return analytics(store, days)

    @app.get('/api/patterns')
    def patterns_view(request: Request, days: int = 90, outcome: str = 'sleep'):
        auth.require(request)
        if days not in (30, 90):
            raise HTTPException(422, 'Zeitraum muss 30 oder 90 Tage betragen.')
        if outcome not in ('sleep', 'ans'):
            raise HTTPException(422, 'Ergebnis muss sleep oder ans sein.')
        from .patterns import patterns
        return patterns(store, days=days, outcome=outcome)

    @app.get('/api/polar/authorize')
    def authorize(request: Request):
        session = auth.require(request)
        if not settings.client_id or not settings.client_secret:
            raise HTTPException(503, 'Polar-Client noch nicht konfiguriert.')
        from .inventory import SCOPES
        scope = SCOPES if isinstance(SCOPES, str) else ' '.join(SCOPES)
        params = {'response_type': 'code', 'client_id': settings.client_id, 'scope': scope,
                  'redirect_uri': settings.redirect_uri, 'state': auth.state(session)}
        return RedirectResponse('https://auth.polar.com/oauth/authorize?' + urlencode(params), status_code=303)

    @app.get('/oauth2_callback')
    async def callback(request: Request, state: str = '', code: str = '', error: str = ''):
        auth.consume_state(request, state)
        if error or not code or len(code) > 2048:
            raise HTTPException(400, 'Polar-Zustimmung wurde nicht abgeschlossen.')
        async with httpx.AsyncClient(transport=transport, timeout=30, follow_redirects=False) as client:
            async with auth.refresh_lock:
                await auth.exchange(client, {'grant_type': 'authorization_code', 'code': code, 'redirect_uri': settings.redirect_uri})
        return RedirectResponse('/', status_code=303)

    async def run_sync(run_id):
        async def heartbeat():
            while True:
                await asyncio.sleep(20)
                await asyncio.to_thread(store.heartbeat, run_id)

        async def collect_data():
            collect = collector
            if collect is None:
                from .collector import collect
            async with httpx.AsyncClient(transport=transport, timeout=30, follow_redirects=False) as client:
                async def token(force_refresh=False):
                    return await auth.access_token(client, force_refresh)
                await collect(store, client, token, run_id)

        beat, work = asyncio.create_task(heartbeat()), asyncio.create_task(collect_data())
        try:
            done, _ = await asyncio.wait({beat, work}, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
            store.finish_run(run_id, 'completed')
        except asyncio.CancelledError:
            with suppress(PyMongoError, LeaseLost):
                store.finish_run(run_id, 'interrupted', 'Abruf wurde unterbrochen.')
            raise
        except Exception:
            # Exceptions can contain complete credential-bearing URLs/bodies. Log only a constant.
            logging.getLogger(__name__).warning('Polar collection interrupted or failed')
            with suppress(PyMongoError, LeaseLost):
                store.finish_run(run_id, 'failed', 'Abruf konnte nicht abgeschlossen werden.')
        finally:
            beat.cancel()
            work.cancel()
            await asyncio.gather(beat, work, return_exceptions=True)

    @app.post('/api/sync', status_code=202)
    async def sync(request: Request, body: SyncBody):
        auth.origin(request)
        auth.require(request)
        if not store.connection()[0]:
            raise HTTPException(409, 'Polar-Verbindung erforderlich.')
        try:
            run = store.begin_run(body.automatic)
        except RunBusy:
            raise HTTPException(409, 'Ein Abruf läuft bereits.') from None
        except Cooldown:
            raise HTTPException(429, 'Automatischer Abruf ist noch in der Wartezeit.', headers={'Retry-After': '900'}) from None
        task = asyncio.create_task(run_sync(run['run_id']))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
        return {'run_id': run['run_id'], 'status': run['status']}

    @app.get('/api/sync/{run_id}')
    def sync_status(request: Request, run_id: str):
        auth.require(request)
        result = store.run(run_id)
        if result is None:
            raise HTTPException(404, 'Abruf nicht gefunden.')
        return result

    @app.get('/api/responses/{response_id}')
    def response_detail(request: Request, response_id: str):
        auth.require(request)
        document, body = store.response(response_id)
        if document is None:
            raise HTTPException(404, 'Antwort nicht gefunden.')
        content_type = document['content_type'].split(';')[0].lower()
        binary = not (content_type == 'application/json' or content_type.endswith('+json'))
        payload = None
        raw_text = None
        unavailable = 'Binärantwort: Inhalt wird als Metadaten angezeigt.' if binary else None
        if not binary:
            try:
                payload = json.loads(body)
            except (ValueError, UnicodeDecodeError):
                raw_text = body.decode('utf-8', errors='replace')
                unavailable = 'Antwort enthält kein gültiges JSON. Originalbytes bleiben archiviert.'
        result = {k: public(document[k]) for k in ('path', 'params', 'http_status', 'content_type', 'fetched_at', 'sha256', 'size')}
        result.update(payload=payload, binary=binary, raw_text=raw_text, payload_unavailable_reason=unavailable)
        return result

    if settings.frontend_dist.is_dir():
        asset_dir = settings.frontend_dist / 'assets'
        if asset_dir.is_dir():
            app.mount('/assets', StaticFiles(directory=asset_dir), name='assets')

    @app.get('/{path:path}')
    def frontend(path: str):
        if path.startswith('api/') or path.startswith('oauth'):
            raise HTTPException(404, 'Nicht gefunden.')
        index = settings.frontend_dist / 'index.html'
        if not index.is_file():
            raise HTTPException(503, 'Dashboard-Build noch nicht vorhanden.')
        return FileResponse(index)

    return app
