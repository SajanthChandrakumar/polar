import hashlib
from datetime import datetime, timezone

from bson import Binary
import pytest

from test_store import make_store


def legacy(store, body=b' {"sample": 42} '):
    return store.db.raw_api_responses.insert_one({
        'path': '/sleeps', 'params': {'from': '2026-10-01'}, 'http_status': 200,
        'sha256': hashlib.sha256(body).hexdigest(), 'size': len(body),
        'body': Binary(body), 'fetched_at': datetime(2026, 10, 1, 12, tzinfo=timezone.utc),
    }).inserted_id


def test_backup_and_compaction_preserve_every_response_and_reference(tmp_path):
    from scripts.compact_archive import backup_archive, compact_archive, verify_archive
    store = make_store()
    a, b = legacy(store), legacy(store)
    c = legacy(store, b'other')
    store.db.sync_endpoint_results.insert_one({'response_ids': [str(a), str(b), str(c)]})
    original = list(store.db.raw_api_responses.find({}))
    references = list(store.db.sync_endpoint_results.find({}))
    backup = tmp_path / 'backup'
    backup_archive(store.db, backup)
    result = compact_archive(store, backup)
    assert result['converted'] == 3
    assert store.db.raw_api_responses.count_documents({}) == 3
    assert store.db['fs.files'].count_documents({}) == 2
    assert list(store.db.sync_endpoint_results.find({})) == references
    for document in original:
        current, body = store.response(str(document['_id']))
        assert body == bytes(document['body'])
        assert {k:v for k,v in current.items() if k != 'body_gridfs_id'} == {k:v for k,v in document.items() if k != 'body'}
    assert verify_archive(store, backup)['verified_responses'] == 3
    assert compact_archive(store, backup)['converted'] == 0
    assert store.db['fs.files'].count_documents({}) == 2


def test_corrupt_backup_blocks_changes(tmp_path):
    from scripts.compact_archive import backup_archive, compact_archive
    store = make_store()
    legacy(store)
    before = list(store.db.raw_api_responses.find({}))
    backup = tmp_path / 'backup'
    backup_archive(store.db, backup)
    with (backup / 'archive.bson.gz').open('ab') as stream:
        stream.write(b'corruption')
    with pytest.raises(ValueError, match='checksum'):
        compact_archive(store, backup)
    assert list(store.db.raw_api_responses.find({})) == before


def test_missing_backup_and_wrong_database_block_changes(tmp_path):
    from scripts.compact_archive import backup_archive, compact_archive
    store = make_store()
    legacy(store)
    with pytest.raises(FileNotFoundError):
        compact_archive(store, tmp_path / 'missing')
    backup = tmp_path / 'backup'
    backup_archive(store.db, backup)
    other = make_store()
    other.db = other.db.client['wrong_database']
    with pytest.raises(ValueError, match='database'):
        compact_archive(other, backup)


def test_corrupt_shared_body_is_never_substituted(tmp_path):
    from scripts.compact_archive import backup_archive, compact_archive
    store = make_store()
    a = legacy(store)
    backup = tmp_path / 'backup'
    backup_archive(store.db, backup)
    store.fs.put(b'wrong bytes', metadata={'sha256': hashlib.sha256(b' {"sample": 42} ').hexdigest()})
    with pytest.raises(ValueError, match='body'):
        compact_archive(store, backup)
    assert 'body' in store.db.raw_api_responses.find_one({'_id': a})


def test_backup_cannot_be_overwritten(tmp_path):
    from scripts.compact_archive import backup_archive
    store = make_store()
    backup = tmp_path / 'backup'
    backup_archive(store.db, backup)
    with pytest.raises(FileExistsError):
        backup_archive(store.db, backup)


@pytest.mark.parametrize('change', ['replace', 'remove', 'delete'])
def test_verification_detects_changed_or_deleted_history(tmp_path, change):
    from scripts.compact_archive import backup_archive, compact_archive, verify_archive
    store = make_store()
    a, b = legacy(store), legacy(store, b'other')
    rid = store.db.sync_endpoint_results.insert_one({'nested': {'response_ids': [str(a)]}}).inserted_id
    backup = tmp_path / 'backup'
    backup_archive(store.db, backup)
    compact_archive(store, backup)
    if change == 'delete':
        store.db.sync_endpoint_results.delete_one({'_id': rid})
    else:
        store.db.sync_endpoint_results.update_one({'_id': rid}, {'$set': {'nested.response_ids': [str(b)] if change == 'replace' else []}})
    with pytest.raises(ValueError, match='history'):
        verify_archive(store, backup)


@pytest.mark.parametrize('damage', ['missing', 'truncated', 'wrong-order'])
def test_backup_rejects_incomplete_gridfs_body(tmp_path, damage):
    from scripts.compact_archive import backup_archive
    store = make_store()
    body = b'original'
    fid = store.fs.put(body)
    store.db.raw_api_responses.insert_one({'body_gridfs_id': fid, 'sha256': hashlib.sha256(body).hexdigest(), 'size': len(body)})
    if damage == 'missing':
        store.db['fs.chunks'].delete_many({'files_id': fid})
    else:
        store.db['fs.chunks'].update_one({'files_id': fid}, {'$set': {'data': Binary(b'short')} if damage == 'truncated' else {'n': 2}})
    with pytest.raises(ValueError, match='GridFS'):
        backup_archive(store.db, tmp_path / 'backup')


def test_backup_blocks_active_sync_and_restores_lock_after_failure(tmp_path, monkeypatch):
    from polar_api.store import RunBusy
    from scripts.compact_archive import backup_archive
    store = make_store()
    run = store.begin_run(False)
    with pytest.raises(RunBusy):
        backup_archive(store.db, tmp_path / 'busy')
    store.finish_run(run['run_id'], 'completed')
    before = store.db.sync_lock.find_one()
    def failed_find(*args, **kwargs):
        with pytest.raises(RunBusy):
            store.begin_run(False)
        raise RuntimeError('interrupted backup')
    monkeypatch.setattr(store.db.raw_api_responses, 'find', failed_find)
    with pytest.raises(RuntimeError, match='interrupted'):
        backup_archive(store.db, tmp_path / 'failed')
    assert store.db.sync_lock.find_one() == before


def test_backup_replays_into_an_empty_database_with_gridfs_and_history(tmp_path):
    from scripts.compact_archive import backup_archive, _records, verify_archive
    store = make_store()
    body = b'original bytes' * 30000
    fid = store.fs.put(body)
    rid = store.db.raw_api_responses.insert_one({
        'body_gridfs_id': fid, 'sha256': hashlib.sha256(body).hexdigest(), 'size': len(body),
        'fetched_at': datetime(2026, 10, 1, tzinfo=timezone.utc),
    }).inserted_id
    store.db.sync_endpoint_results.insert_one({'response_ids': [str(rid)]})
    backup = tmp_path / 'backup'
    backup_archive(store.db, backup)
    replay = make_store()
    for record in _records(backup):
        replay.db[record['collection']].insert_one(record['document'])
    assert replay.response(str(rid))[1] == body
    assert verify_archive(replay, backup)['verified_responses'] == 1


def test_expired_maintenance_cannot_renew_or_restore_a_collectors_lock(monkeypatch):
    from datetime import timedelta
    from polar_api.store import LeaseLost
    from scripts import compact_archive as maintenance
    store = make_store()
    clock = [0]
    monkeypatch.setattr(maintenance.time, 'monotonic', lambda: clock[0])
    with pytest.raises(LeaseLost):
        with maintenance.maintenance_lock(store.db) as (_, heartbeat):
            store.db.sync_lock.update_one({'_id': 'sync'}, {'$set': {'expires_at': datetime.now(timezone.utc) - timedelta(seconds=1)}})
            run = store.begin_run(False)
            replacement = store.db.sync_lock.find_one()
            clock[0] = 21
            heartbeat()
    assert store.db.sync_lock.find_one() == replacement
    assert store.heartbeat(run['run_id'])


def test_quota_bootstrap_removes_only_unreferenced_exact_copies_then_restores_ids(tmp_path):
    from scripts.compact_archive import backup_archive, bootstrap_quota, compact_archive, verify_archive
    store = make_store()
    body = b'large unchanged original' * 50000
    a, b = legacy(store, body), legacy(store, body)
    unique = legacy(store, b'unique')
    store.db.sync_endpoint_results.insert_one({'response_ids': [str(a), str(unique)]})
    backup = tmp_path / 'backup'
    backup_archive(store.db, backup)
    result = bootstrap_quota(store, backup, target_bytes=len(body))
    assert result['removed_documents'] == 1
    assert store.db.raw_api_responses.find_one({'_id': b}) is None
    assert store.response(str(a))[1] == body
    assert store.response(str(unique))[1] == b'unique'
    result = compact_archive(store, backup)
    assert result['restored'] == 1
    assert store.response(str(b))[1] == body
    assert store.db.raw_api_responses.count_documents({}) == 3
    assert verify_archive(store, backup)['verified_responses'] == 3


def test_quota_bootstrap_refuses_to_delete_referenced_or_unique_bodies(tmp_path):
    from scripts.compact_archive import backup_archive, bootstrap_quota
    store = make_store()
    body = b'large' * 300000
    a, b = legacy(store, body), legacy(store, body)
    legacy(store, b'unique' * 300000)
    store.db.sync_endpoint_results.insert_one({'response_ids': [str(a), str(b)]})
    backup = tmp_path / 'backup'
    backup_archive(store.db, backup)
    with pytest.raises(ValueError, match='headroom'):
        bootstrap_quota(store, backup, target_bytes=1000000)
    assert store.db.raw_api_responses.count_documents({}) == 3


@pytest.mark.parametrize('fail_at', [1, 2])
def test_quota_bootstrap_resumes_after_durable_journal_and_partial_deletes(tmp_path, monkeypatch, fail_at):
    from scripts.compact_archive import backup_archive, bootstrap_quota, compact_archive, verify_archive
    store = make_store()
    body = b'large' * 250000
    a, b, c = [legacy(store, body) for _ in range(3)]
    store.db.sync_endpoint_results.insert_one({'response_ids': [str(a)]})
    backup = tmp_path / 'backup'
    backup_archive(store.db, backup)
    delete = store.db.raw_api_responses.delete_one
    calls = [0]
    def interrupted(*args, **kwargs):
        calls[0] += 1
        if calls[0] == fail_at:
            raise RuntimeError('network interruption')
        return delete(*args, **kwargs)
    monkeypatch.setattr(store.db.raw_api_responses, 'delete_one', interrupted)
    with pytest.raises(RuntimeError, match='interruption'):
        bootstrap_quota(store, backup, target_bytes=2 * len(body))
    assert (backup / 'quota-bootstrap.json').is_file()
    monkeypatch.setattr(store.db.raw_api_responses, 'delete_one', delete)
    bootstrap_quota(store, backup, target_bytes=2 * len(body))
    assert store.db.raw_api_responses.count_documents({}) == 1
    assert compact_archive(store, backup)['restored'] == 2
    assert verify_archive(store, backup)['verified_responses'] == 3


def test_read_only_quota_backup_allows_verified_recovery_of_stale_run(tmp_path):
    from datetime import timedelta
    import httpx
    from scripts.compact_archive import _backup_archive, compact_archive, verify_archive
    store = make_store()
    run = store.begin_run(False)
    rid = store.save_response(run['run_id'], '/sleeps', {}, httpx.Response(200, content=b'original'))
    store.save_result(run['run_id'], {'path': '/sleeps', 'status': 'populated', 'response_ids': [rid]})
    store.db.sync_lock.update_one({'_id':'sync'}, {'$set':{'expires_at':datetime.now(timezone.utc)-timedelta(seconds=1)}})
    backup = tmp_path / 'backup'
    _backup_archive(store.db, backup, store.db.sync_lock.find_one(), lambda: None)
    compact_archive(store, backup)
    assert store.db.sync_runs.find_one()['status'] == 'interrupted'
    assert verify_archive(store, backup)['verified_responses'] == 1
    store.db.sync_runs.update_one({'run_id':run['run_id']}, {'$set':{'results':[]}})
    with pytest.raises(ValueError,match='history'):
        verify_archive(store, backup)
