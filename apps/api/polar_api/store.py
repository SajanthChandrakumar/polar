"""Mongo raw archive and database-owned leases. Never store OAuth responses as raw."""
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import gridfs
from bson import Binary, ObjectId
from cryptography.fernet import InvalidToken
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError


class RunBusy(Exception):
    pass


class Cooldown(Exception):
    pass


class LeaseLost(Exception):
    pass


def now():
    return datetime.now(timezone.utc)


def public(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: public(v) for k, v in value.items() if k not in {'_id', 'lease_token', 'body', 'body_gridfs_id'}}
    if isinstance(value, list):
        return [public(v) for v in value]
    return value


class Store:
    LEASE_SECONDS = 90

    def __init__(self, db, gridfs_threshold=14_000_000):
        self.db = db
        self.gridfs_threshold = gridfs_threshold
        self.fs = gridfs.GridFS(db)

    def initialize(self):
        self.db.command('ping')
        self.db.sessions.create_index('expires_at', expireAfterSeconds=0)
        self.db.oauth_states.create_index('expires_at', expireAfterSeconds=0)
        self.db.login_limits.create_index('expires_at', expireAfterSeconds=0)
        self.db.sync_runs.create_index('started_at')
        self.db.sync_endpoint_results.create_index([('run_id', 1), ('path', 1)], unique=True)
        self.db.raw_api_responses.create_index([('path', 1), ('http_status', 1), ('fetched_at', 1)])
        self.recover()

    def recover(self):
        """Recover each expired/orphaned run without touching newly acquired runs."""
        timestamp = now()
        for run in self.db.sync_runs.find({'status': 'running'}):
            identity = {'_id': 'sync', 'run_id': run['run_id'], 'lease_token': run['lease_token']}
            lock = self.db.sync_lock.find_one(identity)
            if lock and lock['expires_at'] > timestamp and lock.get('run_status') == 'running':
                continue
            status = lock.get('run_status', 'interrupted') if lock else 'interrupted'
            if status == 'running':
                status = 'interrupted'
            if lock:
                # An atomic claim prevents a stale recovery read from changing a replacement lease.
                query = {**identity, 'run_status': lock.get('run_status')}
                if lock['expires_at'] <= timestamp:
                    query['expires_at'] = {'$lte': timestamp}
                observed = self.db.sync_lock.find_one_and_update(query, {'$set': {'run_status': status}}, return_document=ReturnDocument.BEFORE)
                if observed is None:
                    continue
                lock = observed
            fields = {'status': status, 'finished_at': timestamp, 'results': list(lock.get('active_results', {}).values()) if lock else run.get('results', [])}
            if status == 'interrupted':
                fields['message'] = 'Abruf wurde unterbrochen.'
            self.db.sync_runs.update_one({'run_id': run['run_id'], 'lease_token': run['lease_token'], 'status': 'running'}, {'$set': fields})

    def begin_run(self, automatic):
        timestamp = now()
        # The singleton is initialized separately so a conditional upsert cannot create duplicate lock rows.
        try:
            self.db.sync_lock.update_one({'_id': 'sync'}, {'$setOnInsert': {'expires_at': timestamp, 'last_automatic_at': datetime(1970, 1, 1, tzinfo=timezone.utc)}}, upsert=True)
        except DuplicateKeyError:
            pass
        query = {'_id': 'sync', 'expires_at': {'$lte': timestamp}}
        if automatic:
            query['last_automatic_at'] = {'$lte': timestamp - timedelta(minutes=15)}
        rid, token = secrets.token_hex(16), secrets.token_hex(32)
        update = {'expires_at': timestamp + timedelta(seconds=self.LEASE_SECONDS), 'run_id': rid, 'lease_token': token, 'run_status': 'running', 'active_results': {}}
        if automatic:
            update['last_automatic_at'] = timestamp
        previous = self.db.sync_lock.find_one_and_update(query, {'$set': update}, return_document=ReturnDocument.BEFORE)
        if previous is None:
            lock = self.db.sync_lock.find_one({'_id': 'sync'})
            if lock and lock['expires_at'] > timestamp:
                raise RunBusy()
            raise Cooldown()
        if previous.get('run_id'):
            status = previous.get('run_status', 'interrupted')
            if status == 'running':
                status = 'interrupted'
            fields = {'status': status, 'finished_at': timestamp, 'results': list(previous.get('active_results', {}).values())}
            if status == 'interrupted':
                fields['message'] = 'Abruf wurde unterbrochen.'
            self.db.sync_runs.update_one({'run_id': previous['run_id'], 'status': 'running'}, {'$set': fields})
        today = timestamp.astimezone(ZoneInfo('Europe/Zurich')).date()
        run = {'run_id': rid, 'lease_token': token, 'status': 'running', 'started_at': timestamp,
               'automatic': automatic, 'from': (today - timedelta(days=7)).isoformat(), 'to': today.isoformat(), 'timezone': 'Europe/Zurich'}
        try:
            self.db.sync_runs.insert_one(run)
        except Exception:
            self.db.sync_lock.update_one({'_id': 'sync', 'lease_token': token}, {'$set': {'expires_at': timestamp}})
            raise
        return public(run)

    def _lease(self, run_id):
        run = self.db.sync_runs.find_one({'run_id': run_id, 'status': 'running'})
        if not run or not self.db.sync_lock.find_one({'_id': 'sync', 'run_id': run_id, 'lease_token': run['lease_token'], 'run_status': 'running', 'expires_at': {'$gt': now()}}):
            raise LeaseLost()
        return run['lease_token']

    def heartbeat(self, run_id):
        token = self._lease(run_id)
        result = self.db.sync_lock.update_one({'_id': 'sync', 'run_id': run_id, 'lease_token': token, 'expires_at': {'$gt': now()}}, {'$set': {'expires_at': now() + timedelta(seconds=self.LEASE_SECONDS)}})
        if not result.matched_count:
            raise LeaseLost()
        return True

    def finish_run(self, run_id, status, message=None):
        token = self._lease(run_id)
        lock = self.db.sync_lock.find_one_and_update(
            {'_id': 'sync', 'run_id': run_id, 'lease_token': token, 'expires_at': {'$gt': now()}},
            {'$set': {'run_status': status}}, return_document=ReturnDocument.BEFORE)
        if lock is None:
            raise LeaseLost()
        fields = {'status': status, 'finished_at': now(), 'results': list(lock.get('active_results', {}).values())}
        if message:
            fields['message'] = message
        self.db.sync_runs.update_one({'run_id': run_id, 'lease_token': token, 'status': 'running'}, {'$set': fields})
        self.db.sync_lock.update_one({'_id': 'sync', 'run_id': run_id, 'lease_token': token}, {'$set': {'expires_at': now()}})

    def save_response(self, run_id, path, params, response):
        token = self._lease(run_id)
        raw = response.content
        document = {'run_id': run_id, 'sync_run_id': run_id, 'lease_token': token, 'path': path,
                    'params': {k: v for k, v in params.items() if k.lower() not in {'access_token', 'refresh_token', 'token', 'authorization', 'client_secret', 'password', 'code', 'state'}},
                    'http_status': response.status_code, 'content_type': response.headers.get('content-type', ''),
                    'fetched_at': now(), 'sha256': hashlib.sha256(raw).hexdigest(), 'size': len(raw)}
        if len(raw) >= self.gridfs_threshold:
            document['body_gridfs_id'] = self.fs.put(raw)
        else:
            document['body'] = Binary(raw)
        response_id = self.db.raw_api_responses.insert_one(document).inserted_id
        # Fencing after persistence prevents a replaced worker from reporting its writes as live results.
        self._lease(run_id)
        return str(response_id)

    def save_result(self, run_id, result):
        token = self._lease(run_id)
        document = {k: v for k, v in result.items() if k in {'path', 'status', 'http_status', 'count', 'fetched_at', 'message', 'response_id', 'response_ids', 'period'}}
        document.update(run_id=run_id, lease_token=token)
        self.db.sync_endpoint_results.replace_one({'run_id': run_id, 'path': document['path']}, document, upsert=True)
        key = hashlib.sha256(document['path'].encode()).hexdigest()
        committed = self.db.sync_lock.update_one(
            {'_id': 'sync', 'run_id': run_id, 'lease_token': token, 'run_status': 'running', 'expires_at': {'$gt': now()}},
            {'$set': {f'active_results.{key}': document, f'last_results.{key}': document}})
        if not committed.matched_count:
            raise LeaseLost()

    def run(self, run_id):
        run = self.db.sync_runs.find_one({'run_id': run_id})
        if not run:
            return None
        if run['status'] == 'running':
            self.recover()
            run = self.db.sync_runs.find_one({'run_id': run_id})
        lock = self.db.sync_lock.find_one({'_id': 'sync', 'run_id': run_id, 'lease_token': run['lease_token']})
        if lock:
            run['results'] = list(lock.get('active_results', {}).values())
        else:
            run.setdefault('results', [])
        return public(run)

    def latest_run(self):
        self.recover()
        run = self.db.sync_runs.find_one(sort=[('started_at', -1), ('_id', -1)])
        return self.run(run['run_id']) if run else None

    def sources(self, endpoints):
        self.recover()
        lock = self.db.sync_lock.find_one({'_id': 'sync'}) or {}
        sources = []
        for endpoint in endpoints:
            key = hashlib.sha256(endpoint['path'].encode()).hexdigest()
            saved = lock.get('last_results', {}).get(key)
            item = {'path': endpoint['path'], 'status': 'pending', 'http_status': None, 'count': None, 'fetched_at': None}
            if saved:
                item.update(public(saved))
                item.pop('run_id', None)
            sources.append(item)
        return sources

    def response(self, response_id):
        try:
            oid = ObjectId(response_id)
        except Exception:
            return None, None
        document = self.db.raw_api_responses.find_one({'_id': oid})
        if not document:
            return None, None
        body = self.fs.get(document['body_gridfs_id']).read() if 'body_gridfs_id' in document else bytes(document['body'])
        return document, body

    def responses(self, response_ids):
        """Batch archived bodies for the dashboard; no requests to Polar."""
        result = {}
        ids = [ObjectId(value) for value in dict.fromkeys(response_ids)]
        for document in self.db.raw_api_responses.find({'_id': {'$in': ids}}):
            body = self.fs.get(document['body_gridfs_id']).read() if 'body_gridfs_id' in document else bytes(document['body'])
            result[str(document['_id'])] = (document, body)
        return result

    def analytics_responses(self, paths, since=None):
        """Load latest successful unique metric bodies within a fetch-time window."""
        paths = tuple(dict.fromkeys(path for path in paths if isinstance(path, str)))
        if not paths:
            return {}
        query = {
            'path': {'$in': paths},
            'http_status': {'$gte': 200, '$lt': 300},
        }
        if since is not None:
            query['fetched_at'] = {'$gte': since}
        metadata = self.db.raw_api_responses.find(
            query, {'_id': 1, 'path': 1, 'sha256': 1, 'fetched_at': 1},
        ).sort([('fetched_at', -1), ('_id', -1)])
        selected, seen = [], set()
        for document in metadata:
            digest = document.get('sha256')
            identity = (document.get('path'), digest) if isinstance(digest, str) and digest else ('_id', document['_id'])
            if identity not in seen:
                selected.append(str(document['_id']))
                seen.add(identity)
        return self.responses(selected) if selected else {}

    def save_tokens(self, tokens, cipher):
        access = tokens.get('access_token')
        refresh = tokens.get('refresh_token')
        if refresh is None:
            previous = self.tokens(cipher) or {}
            refresh = previous.get('refresh_token')
        expiry = tokens.get('expires_in')
        if not isinstance(access, str) or not access or not isinstance(refresh, str) or not refresh or not isinstance(expiry, (int, float)) or expiry <= 0:
            raise ValueError('Invalid token response')
        protected = {'access_token': access, 'refresh_token': refresh, 'expires_at': now().timestamp() + expiry}
        self.db.oauth_tokens.replace_one({'_id': 'owner'}, {'_id': 'owner', 'encrypted': Binary(cipher.encrypt(json.dumps(protected).encode())), 'connected': True}, upsert=True)

    def tokens(self, cipher):
        record = self.db.oauth_tokens.find_one({'_id': 'owner'})
        if not record or not record.get('connected'):
            return None
        try:
            return json.loads(cipher.decrypt(bytes(record['encrypted'])))
        except InvalidToken:
            self.connection_failed()
            return None

    def connection(self):
        record = self.db.oauth_tokens.find_one({'_id': 'owner'})
        return bool(record and record.get('connected')), record.get('error') if record else None

    def connection_failed(self):
        self.db.oauth_tokens.update_one({'_id': 'owner'}, {'$set': {'connected': False, 'error': 'Polar-Verbindung muss erneuert werden.'}})
