import hashlib
from datetime import datetime, timedelta, timezone

import httpx
import mongomock
import pytest
from mongomock.gridfs import enable_gridfs_integration


def make_store(threshold=14_000_000):
    from polar_api.store import Store
    enable_gridfs_integration()
    return Store(mongomock.MongoClient(tz_aware=True).polar_test, gridfs_threshold=threshold)


def test_raw_body_and_gridfs_remain_byte_exact_and_no_credentials():
    store = make_store(10)
    run = store.begin_run(False)
    body = b' {"broken": \xff\x00}'
    response = httpx.Response(200, content=body, headers={"content-type": "application/json", "Authorization": "secret"})
    response_id = store.save_response(run['run_id'], '/sleeps', {'from': '2026-10-01', 'access_token': 'secret'}, response)
    saved, raw = store.response(response_id)
    assert raw == body
    assert saved['sha256'] == hashlib.sha256(body).hexdigest()
    assert saved['body_gridfs_id']
    assert saved['params'] == {'from': '2026-10-01'}
    assert 'secret' not in repr(saved)


def test_lease_excludes_tabs_cooldown_and_stale_fencing():
    from polar_api.store import RunBusy, Cooldown, LeaseLost
    store = make_store()
    first = store.begin_run(True)
    with pytest.raises(RunBusy):
        store.begin_run(False)
    store.db.sync_lock.update_one({'_id': 'sync'}, {'$set': {'expires_at': datetime.now(timezone.utc) - timedelta(seconds=1)}})
    second = store.begin_run(False)
    assert store.run(first['run_id'])['status'] == 'interrupted'
    with pytest.raises(LeaseLost):
        store.save_result(first['run_id'], {'path': '/devices', 'status': 'empty'})
    with pytest.raises(LeaseLost):
        store.finish_run(first['run_id'], 'completed')
    assert store.heartbeat(second['run_id'])
    store.finish_run(second['run_id'], 'completed')
    with pytest.raises(Cooldown):
        store.begin_run(True)
    assert store.begin_run(False)['status'] == 'running'


def test_token_storage_is_encrypted_and_database_failure_cannot_succeed():
    from cryptography.fernet import Fernet
    from pymongo.errors import ConnectionFailure
    store = make_store()
    cipher = Fernet(Fernet.generate_key())
    store.save_tokens({'access_token': 'sensitive-access', 'refresh_token': 'sensitive-refresh', 'expires_in': 100}, cipher)
    assert 'sensitive' not in repr(store.db.oauth_tokens.find_one())
    assert store.tokens(cipher)['access_token'] == 'sensitive-access'
    store.db.sync_lock.find_one_and_update = lambda *a, **k: (_ for _ in ()).throw(ConnectionFailure('private-db-uri'))
    with pytest.raises(ConnectionFailure):
        store.begin_run(False)


def test_refresh_response_without_refresh_token_preserves_existing_credential():
    from cryptography.fernet import Fernet
    store = make_store()
    cipher = Fernet(Fernet.generate_key())
    store.save_tokens({'access_token': 'first-access', 'refresh_token': 'first-refresh', 'expires_in': 100}, cipher)
    store.save_tokens({'access_token': 'second-access', 'expires_in': 200}, cipher)
    assert store.tokens(cipher)['access_token'] == 'second-access'
    assert store.tokens(cipher)['refresh_token'] == 'first-refresh'


def test_result_published_after_lease_takeover_is_never_visible():
    from polar_api.store import LeaseLost
    store = make_store()
    first = store.begin_run(False)
    original_replace = store.db.sync_endpoint_results.replace_one

    def lose_lease_after_result_write(*args, **kwargs):
        result = original_replace(*args, **kwargs)
        store.db.sync_lock.update_one({'_id': 'sync'}, {'$set': {'expires_at': datetime.now(timezone.utc) - timedelta(seconds=1)}})
        store.begin_run(False)
        return result

    store.db.sync_endpoint_results.replace_one = lose_lease_after_result_write
    with pytest.raises(LeaseLost):
        store.save_result(first['run_id'], {'path': '/devices', 'status': 'populated', 'count': 99})
    assert store.sources([{'path': '/devices'}])[0]['status'] == 'pending'
    assert store.run(first['run_id'])['results'] == []


def test_startup_recovery_preserves_committed_partial_results():
    store = make_store()
    run = store.begin_run(False)
    store.save_result(run['run_id'], {'path': '/devices', 'status': 'empty', 'count': 0})
    store.db.sync_lock.update_one({'_id': 'sync'}, {'$set': {'expires_at': datetime.now(timezone.utc) - timedelta(seconds=1)}})
    store.recover()
    assert store.run(run['run_id'])['status'] == 'interrupted'
    assert store.run(run['run_id'])['results'][0]['status'] == 'empty'
    assert store.sources([{'path': '/devices'}])[0]['status'] == 'empty'


def test_recovery_cannot_interrupt_a_run_started_during_its_stale_read():
    store = make_store()
    first = store.begin_run(False)
    store.db.sync_lock.update_one({'_id': 'sync'}, {'$set': {'expires_at': datetime.now(timezone.utc) - timedelta(seconds=1)}})
    original_find = store.db.sync_lock.find_one
    replacement = []
    def raced_find(*args, **kwargs):
        observed = original_find(*args, **kwargs)
        if not replacement and observed and observed.get('run_id') == first['run_id']:
            replacement.append('acquiring')
            replacement[0] = store.begin_run(False)['run_id']
        return observed
    store.db.sync_lock.find_one = raced_find
    store.recover()
    assert store.run(replacement[0])['status'] == 'running'
