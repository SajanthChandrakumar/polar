"""Deduplicate raw bodies without deleting fetch metadata or changing references.

Default: read-only inventory. --backup-only creates a BSON/gzip archive;
--apply requires that verified backup. Existing readers already support GridFS.
"""
import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import secrets
import time

from bson import BSON, Binary, decode_file_iter
from bson.codec_options import CodecOptions
from dotenv import dotenv_values
from pymongo import MongoClient, ReturnDocument

from polar_api.store import Store, RunBusy, LeaseLost

COLLECTIONS = ('raw_api_responses', 'fs.files', 'fs.chunks', 'sync_runs', 'sync_endpoint_results', 'sync_lock')
STORAGE_FIELDS = {'body', 'body_gridfs_id'}


@contextmanager
def maintenance_lock(db):
    """Fence collectors while exporting or converting; restore the expired lock."""
    Store(db).recover()
    now = datetime.now(timezone.utc)
    db.sync_lock.update_one({'_id': 'sync'}, {'$setOnInsert': {
        'expires_at': now, 'last_automatic_at': datetime(1970, 1, 1, tzinfo=timezone.utc),
    }}, upsert=True)
    token = secrets.token_hex(32)
    previous = db.sync_lock.find_one_and_update(
        {'_id': 'sync', 'expires_at': {'$lte': now}},
        {'$set': {'lease_token': token, 'maintenance_token': token,
                  'run_status': 'maintenance', 'expires_at': now + timedelta(minutes=5)}},
        return_document=ReturnDocument.BEFORE,
    )
    if previous is None:
        raise RunBusy('A sync or maintenance operation is already active')
    renewed = time.monotonic()
    def heartbeat():
        nonlocal renewed
        if time.monotonic() - renewed < 20:
            return
        timestamp = datetime.now(timezone.utc)
        result = db.sync_lock.update_one(
            {'_id': 'sync', 'maintenance_token': token, 'lease_token': token,
             'run_status': 'maintenance', 'expires_at': {'$gt': timestamp}},
            {'$set': {'expires_at': timestamp + timedelta(minutes=5)}},
        )
        if not result.matched_count:
            raise LeaseLost('Maintenance lease was lost')
        renewed = time.monotonic()
    try:
        yield previous, heartbeat
    finally:
        db.sync_lock.replace_one({'_id': 'sync', 'maintenance_token': token,
                                 'lease_token': token, 'run_status': 'maintenance'}, previous)


def _checksum(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def _records(directory):
    with gzip.open(directory / 'archive.bson.gz', 'rb') as stream:
        yield from decode_file_iter(stream, codec_options=CodecOptions(tz_aware=True))


def _references(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == 'response_id' and isinstance(item, str):
                yield item
            elif key == 'response_ids' and isinstance(item, list):
                yield from item
            elif isinstance(item, (dict, list)):
                yield from _references(item)
    elif isinstance(value, list):
        for item in value:
            yield from _references(item)


def backup_archive(db, directory):
    with maintenance_lock(db) as (previous, heartbeat):
        return _backup_archive(db, directory, previous, heartbeat)


def _backup_archive(db, directory, previous, heartbeat):
    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    archive = directory / 'archive.bson.gz'
    counts = Counter({name: 0 for name in COLLECTIONS})
    with os.fdopen(os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as output:
        with gzip.GzipFile(fileobj=output, mode='wb', compresslevel=1) as stream:
            for name in COLLECTIONS:
                rows = db[name].find({}).batch_size(10)
                if name == 'fs.chunks':
                    rows = rows.sort([('files_id', 1), ('n', 1)])
                for document in rows:
                    heartbeat()
                    if name == 'sync_lock' and document['_id'] == 'sync':
                        document = previous
                    stream.write(BSON.encode({'collection': name, 'document': document}))
                    counts[name] += 1
                print(f'Backed up {name}: {counts[name]} documents', flush=True)
    manifest = {'database': db.name, 'created_at': datetime.now(timezone.utc).isoformat(),
                'collections': dict(counts), 'sha256': _checksum(archive)}
    (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    _validate_backup(db.name, directory)
    return manifest


def _validate_backup(database, directory):
    manifest = json.loads((directory / 'manifest.json').read_text())
    if manifest['database'] != database:
        raise ValueError('Backup belongs to a different database')
    if _checksum(directory / 'archive.bson.gz') != manifest['sha256']:
        raise ValueError('Backup checksum mismatch')
    counts, files, chunks = Counter(), {}, {}
    raw_ids, references, external_bodies = set(), set(), []
    for record in _records(directory):
        name = record['collection']
        if name not in COLLECTIONS:
            raise ValueError('Unknown backup collection')
        counts[name] += 1
        document = record['document']
        if name == 'raw_api_responses':
            raw_ids.add(str(document['_id']))
            if 'body' in document:
                body = bytes(document['body'])
                if document.get('sha256') != hashlib.sha256(body).hexdigest() or document.get('size') != len(body):
                    raise ValueError('Archived body checksum or size mismatch')
            elif 'body_gridfs_id' in document:
                external_bodies.append((document['body_gridfs_id'], document['sha256'], document['size']))
            else:
                raise ValueError('Archived response has no body')
        elif name == 'fs.files':
            files[document['_id']] = document
        elif name == 'fs.chunks':
            file_id = document['files_id']
            file = files.get(file_id)
            if file is None:
                raise ValueError('GridFS chunk has no file')
            state = chunks.setdefault(file_id, {'n': 0, 'length': 0, 'hash': hashlib.sha256()})
            data = bytes(document['data'])
            if document['n'] != state['n'] or len(data) != min(file['chunkSize'], file['length'] - state['length']):
                raise ValueError('GridFS chunks are incomplete or out of order')
            state['n'] += 1
            state['length'] += len(data)
            state['hash'].update(data)
        else:
            references.update(_references(document))
    if any(counts[name] != count for name, count in manifest['collections'].items()) or any(name not in manifest['collections'] for name in counts):
        raise ValueError('Backup document counts mismatch')
    for file_id, file in files.items():
        state = chunks.get(file_id, {'length': 0, 'hash': hashlib.sha256()})
        if state['length'] != file['length']:
            raise ValueError('GridFS body is incomplete')
        expected = file.get('metadata', {}).get('sha256')
        if expected is not None and state['hash'].hexdigest() != expected:
            raise ValueError('GridFS body checksum mismatch')
    for file_id, digest, size in external_bodies:
        state = chunks.get(file_id, {'length': 0, 'hash': hashlib.sha256()})
        if file_id not in files or state['length'] != size or state['hash'].hexdigest() != digest:
            raise ValueError('GridFS response body differs from backup')
    if references - raw_ids:
        raise ValueError('Backup history contains broken references')
    return manifest


def compact_archive(store, directory):
    with maintenance_lock(store.db) as (_, heartbeat):
        return _compact_archive(store, directory, heartbeat)


def _compact_archive(store, directory, heartbeat):
    directory = Path(directory)
    manifest = _validate_backup(store.db.name, directory)
    journal_path = directory / 'quota-bootstrap.json'
    restorable = set()
    if journal_path.exists():
        journal = json.loads(journal_path.read_text())
        if journal['backup_sha256'] != manifest['sha256']:
            raise ValueError('Quota journal belongs to a different backup')
        restorable = set(journal['planned_ids'])
    store.db['fs.files'].create_index('metadata.sha256', unique=True, sparse=True)
    converted, restored, verified_files = 0, 0, set()
    current = {row['_id']: row for row in store.db.raw_api_responses.find({}, {'body': 0})}
    for record in _records(directory):
        heartbeat()
        document = record['document']
        if record['collection'] != 'raw_api_responses' or 'body' not in document:
            continue
        expected = {k:v for k,v in document.items() if k not in STORAGE_FIELDS}
        missing = document['_id'] not in current
        observed = {k:v for k,v in current.get(document['_id'], {}).items() if k not in STORAGE_FIELDS}
        if (missing and str(document['_id']) not in restorable) or (not missing and observed != expected):
            raise ValueError('Response metadata changed since backup')
        raw = bytes(document['body'])
        file_id = store.archive_body(raw)
        if file_id not in verified_files:
            if store.fs.get(file_id).read() != raw:
                raise ValueError('Shared body differs from backup')
            verified_files.add(file_id)
        if missing:
            store.db.raw_api_responses.insert_one({**expected, 'body_gridfs_id': file_id})
            restored += 1
            continue
        result = store.db.raw_api_responses.update_one(
            {'_id': document['_id'], 'sha256': document['sha256'], 'size': len(raw), 'body': {'$exists': True}},
            {'$set': {'body_gridfs_id': file_id}, '$unset': {'body': ''}},
        )
        converted += result.modified_count
        if converted and converted % 100 == 0 and result.modified_count:
            print(f'Converted {converted} responses; IDs and metadata preserved', flush=True)
    return {'converted': converted, 'restored': restored, 'verified_shared_bodies': len(verified_files)}


def bootstrap_quota(store, directory, target_bytes=40_000_000):
    """Emergency only: stage backed-up, unreferenced duplicate IDs for restoration.

    Atlas rejects even a maintenance lease when full. No unique bytes or currently
    referenced response may be removed. The normal compactor restores all IDs.
    """
    directory = Path(directory)
    manifest = _validate_backup(store.db.name, directory)
    journal_path = directory / 'quota-bootstrap.json'
    journal = json.loads(journal_path.read_text()) if journal_path.exists() else None
    if journal is not None and journal['backup_sha256'] != manifest['sha256']:
        raise ValueError('Quota journal belongs to a different backup')
    planned_ids = set(journal['planned_ids']) if journal is not None else set()
    history = {name: {row['_id']: row for row in store.db[name].find({})} for name in ('sync_runs', 'sync_endpoint_results', 'sync_lock')}
    lock = history['sync_lock'].get('sync', {})
    if lock.get('expires_at', datetime.min.replace(tzinfo=timezone.utc)) > datetime.now(timezone.utc):
        raise RunBusy('An active collector prevents quota recovery')
    references = {ref for rows in history.values() for row in rows.values() for ref in _references(row)}
    current = {row['_id']: row for row in store.db.raw_api_responses.find({}, {'body': 0})}
    saved = {}
    for record in _records(directory):
        name, document = record['collection'], record['document']
        if name == 'raw_api_responses':
            saved[document['_id']] = {k:v for k,v in document.items() if k != 'body'}
        elif name in history and history[name].get(document['_id']) != document:
            raise ValueError('Fetch history changed since backup')
    missing = set(saved) - set(current)
    if any(row != saved.get(key) for key, row in current.items()) or {str(key) for key in missing} - planned_ids:
        raise ValueError('Response snapshot changed since backup')
    survivors = {(row['path'], row['sha256']): row['_id'] for row in current.values() if str(row['_id']) in references}
    candidates = sorted((row for row in saved.values() if str(row['_id']) not in references
                         and row.get('size',0) >= 1_000_000 and 'body_gridfs_id' not in row
                         and (row['path'], row['sha256']) in survivors
                         and (journal is None or str(row['_id']) in planned_ids)), key=lambda row: row['size'], reverse=True)
    chosen, released = {}, 0
    for row in candidates:
        chosen[row['_id']] = row
        released += row['size']
        if journal is None and released >= target_bytes:
            break
    if (journal is None and released < target_bytes) or (journal is not None and {str(key) for key in chosen} != planned_ids):
        raise ValueError('Insufficient unreferenced duplicates for safe headroom')
    documents = []
    for record in _records(directory):
        document = record['document']
        if record['collection'] == 'raw_api_responses' and document['_id'] in chosen:
            survivor = survivors[(document['path'], document['sha256'])]
            if store.response(str(survivor))[1] != bytes(document['body']):
                raise ValueError('Duplicate body differs from surviving copy')
            documents.append(document)
    if journal is None:
        journal = {'backup_sha256': manifest['sha256'], 'planned_ids': [str(row['_id']) for row in documents], 'body_bytes': released}
        with os.fdopen(os.open(journal_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
            json.dump(journal, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        descriptor = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    removed = 0
    for document in documents:
        if document['_id'] in missing:
            continue
        # Exact body equality is part of the delete predicate, not just its hash.
        result = store.db.raw_api_responses.delete_one({**document, 'body': Binary(bytes(document['body']))})
        if result.deleted_count != 1:
            raise ValueError('Duplicate changed during quota recovery; resume normal compaction')
        removed += 1
    return {'removed_documents': removed, 'released_body_bytes': released, 'restore_required': True}


def verify_archive(store, directory):
    with maintenance_lock(store.db) as (previous, heartbeat):
        return _verify_archive(store, directory, previous, heartbeat)


def _verify_archive(store, directory, previous, heartbeat):
    directory = Path(directory)
    _validate_backup(store.db.name, directory)
    current = {row['_id']: row for row in store.db.raw_api_responses.find({}, {'body': 0})}
    history = {name: {row['_id']: row for row in store.db[name].find({})} for name in ('sync_runs', 'sync_endpoint_results')}
    saved_history = {name: {} for name in history}
    saved_lock = {}
    verified_files, verified_responses = {}, 0
    for record in _records(directory):
        heartbeat()
        document = record['document']
        name = record['collection']
        if name in saved_history:
            saved_history[name][document['_id']] = document
        if name == 'sync_lock':
            saved_lock = document
        if name == 'sync_lock' and previous.get('run_id') == document.get('run_id'):
            if any(previous.get(key) != document.get(key) for key in ('last_results', 'active_results')):
                raise ValueError('Fetch history lock references differ from backup')
        if name != 'raw_api_responses':
            continue
        observed = current.get(document['_id'], {})
        if {k:v for k,v in observed.items() if k not in STORAGE_FIELDS} != {k:v for k,v in document.items() if k not in STORAGE_FIELDS}:
            raise ValueError('Response metadata differs from backup')
        file_id = observed.get('body_gridfs_id')
        if file_id is None or file_id not in verified_files:
            _, raw = store.response(str(document['_id']))
            if raw is None or hashlib.sha256(raw).hexdigest() != document['sha256'] or len(raw) != document['size']:
                raise ValueError('Response body differs from backup')
            if file_id is not None:
                verified_files[file_id] = (document['sha256'], document['size'])
        elif verified_files[file_id] != (document['sha256'], document['size']):
            raise ValueError('Shared body reference differs from backup')
        verified_responses += 1
    for name, documents in saved_history.items():
        for identity, document in documents.items():
            observed = history[name].get(identity, {})
            if observed == document:
                continue
            mutable = {'status', 'finished_at', 'message', 'results'}
            results = list(saved_lock.get('active_results', {}).values()) if all(saved_lock.get(key) == document.get(key) for key in ('run_id','lease_token')) else document.get('results', [])
            recovered = (name == 'sync_runs' and document.get('status') == 'running'
                         and observed.get('status') == 'interrupted'
                         and observed.get('message') == 'Abruf wurde unterbrochen.'
                         and isinstance(observed.get('finished_at'), datetime)
                         and observed.get('results') == results
                         and {k:v for k,v in observed.items() if k not in mutable} == {k:v for k,v in document.items() if k not in mutable})
            if not recovered:
                raise ValueError('Fetch history differs from backup')
    references = set(_references(previous))
    for documents in history.values():
        for document in documents.values():
            references.update(_references(document))
    if references - {str(key) for key in current}:
        raise ValueError('Broken response reference')
    return {'verified_responses': verified_responses, 'verified_bodies': len(verified_files), 'broken_references': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', default='.env')
    parser.add_argument('--backup-dir', type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--backup-only', action='store_true')
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--verify', action='store_true')
    mode.add_argument('--bootstrap-quota', action='store_true')
    args = parser.parse_args()
    if (args.backup_only or args.apply or args.verify or args.bootstrap_quota) and args.backup_dir is None:
        parser.error('--backup-dir is required for backup, apply, or verification')
    cfg = dotenv_values(args.env_file)
    uri = cfg.get('MONGODB_URI') or cfg.get('MONGO_URI')
    if not uri:
        parser.error('MongoDB connection is not configured')
    with MongoClient(uri, tz_aware=True, compressors='zlib', serverSelectionTimeoutMS=10000, socketTimeoutMS=60000, appname='polar-archive-maintenance') as client:
        db = client[cfg.get('MONGODB_DATABASE') or 'polar_health_analytics']
        store = Store(db)
        if args.backup_only:
            result = backup_archive(db, args.backup_dir)
        elif args.apply:
            result = compact_archive(store, args.backup_dir)
        elif args.verify:
            result = verify_archive(store, args.backup_dir)
        elif args.bootstrap_quota:
            result = bootstrap_quota(store, args.backup_dir)
        else:
            rows = list(db.raw_api_responses.find({}, {'sha256':1, 'size':1, 'body_gridfs_id':1}))
            unique = {}
            for row in rows:
                unique.setdefault(row.get('sha256') or str(row['_id']), row.get('size', 0))
            result = {'database':db.name, 'responses':len(rows), 'unique_bodies':len(unique),
                      'body_bytes':sum(row.get('size',0) for row in rows), 'unique_body_bytes':sum(unique.values()),
                      'inline_responses':sum('body_gridfs_id' not in row for row in rows)}
        print(json.dumps(result, indent=2), flush=True)


if __name__ == '__main__':
    main()
