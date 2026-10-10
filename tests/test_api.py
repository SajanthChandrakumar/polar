import asyncio
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from test_store import make_store


def build_client(transport=None, collector=None):
    from polar_api.app import create_app
    from polar_api.config import Settings
    settings = Settings(owner_password='test-password-only', session_secret='x' * 40,
                        token_encryption_key=Fernet.generate_key().decode(), client_id='test-client',
                        client_secret='test-secret', public_url='http://testserver',
                        redirect_uri='http://testserver/oauth2_callback')
    store = make_store()
    app = create_app(settings, store, transport=transport, collector=collector)
    return TestClient(app), store


def login(client):
    return client.post('/api/login', json={'password': 'test-password-only'}, headers={'Origin': 'http://testserver'})


def test_health_checks_database_and_frontend_without_login_or_collection(tmp_path, monkeypatch):
    from polar_api.app import create_app
    from polar_api.config import Settings
    from pymongo.errors import ConnectionFailure
    settings = Settings(owner_password='test-password-only', session_secret='x' * 40,
                        token_encryption_key=Fernet.generate_key().decode(),
                        frontend_dist=tmp_path)
    store = make_store()
    monkeypatch.setattr(store.db, 'command', lambda command: {'ok': 1})
    client = TestClient(create_app(settings, store))
    assert client.get('/api/health').status_code == 503
    (tmp_path / 'index.html').write_text('<html>Dashboard</html>')
    response = client.get('/api/health')
    assert response.status_code == 200
    assert response.json() == {'status': 'ok'}
    assert client.get('/api/dashboard').status_code == 401
    def unavailable(command):
        raise ConnectionFailure('private-database-details')
    monkeypatch.setattr(store.db, 'command', unavailable)
    response = client.get('/api/health')
    assert response.status_code == 503
    assert 'private-database-details' not in response.text
    assert store.db.sync_runs.count_documents({}) == 0


def test_private_session_same_origin_and_logout_invalidates_cookie():
    client, store = build_client()
    assert client.get('/api/dashboard').status_code == 401
    assert client.post('/api/login', json={'password': 'test-password-only'}, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.post('/api/login', json={'password': 'test-password-only'}).status_code == 403
    assert login(client).status_code == 200
    old = client.cookies.get('polar_session')
    assert client.get('/api/dashboard').json()['connected'] is False
    assert client.post('/api/logout', headers={'Origin': 'http://testserver'}).status_code == 204
    client.cookies.set('polar_session', old)
    assert client.get('/api/dashboard').status_code == 401


def test_login_throttles_wrong_password_without_leaking():
    client, _ = build_client()
    for _ in range(5):
        assert client.post('/api/login', json={'password': 'wrong'}, headers={'Origin': 'http://testserver'}).status_code == 401
    response = login(client)
    assert response.status_code == 429
    assert 'test-password' not in response.text


def test_oauth_state_is_single_use_session_bound_and_tokens_private():
    def handler(request):
        assert str(request.url) == 'https://auth.polar.com/oauth/token'
        assert b'grant_type=authorization_code' in request.content
        return httpx.Response(200, json={'access_token': 'private-access', 'refresh_token': 'private-refresh', 'expires_in': 10000})
    client, store = build_client(httpx.MockTransport(handler))
    assert login(client).status_code == 200
    auth = client.get('/api/polar/authorize', follow_redirects=False)
    state = parse_qs(urlparse(auth.headers['location']).query)['state'][0]
    other, _ = build_client()
    assert login(other).status_code == 200
    assert other.get('/oauth2_callback', params={'state': state, 'code': 'test-code'}).status_code == 400
    callback = client.get('/oauth2_callback', params={'state': state, 'code': 'test-code'}, follow_redirects=False)
    assert callback.status_code == 303
    assert client.get('/oauth2_callback', params={'state': state, 'code': 'test-code'}).status_code == 400
    assert client.get('/api/dashboard').json()['connected'] is True
    assert 'private-access' not in client.get('/api/dashboard').text
    assert store.db.raw_api_responses.count_documents({}) == 0


def test_raw_api_json_and_invalid_json_binary_metadata():
    client, store = build_client()
    login(client)
    run = store.begin_run(False)
    for body, content_type, binary, payload in [(b'{"a":1}', 'application/json', False, {'a': 1}), (b'{bad', 'application/json', False, None), (b'\xff\x00', 'image/jpeg', True, None)]:
        rid = store.save_response(run['run_id'], '/test', {}, httpx.Response(200, content=body, headers={'content-type': content_type}))
        response = client.get('/api/responses/' + rid)
        assert response.status_code == 200
        assert response.json()['payload'] == payload
        assert response.json()['binary'] is binary
        assert response.json()['size'] == len(body)


def test_database_outage_returns_sanitized_error_and_no_success():
    from pymongo.errors import ConnectionFailure
    client, store = build_client()
    login(client)
    store.db.sync_runs.find_one = lambda *a, **k: (_ for _ in ()).throw(ConnectionFailure('mongodb://secret:private'))
    response = client.get('/api/dashboard')
    assert response.status_code == 503
    assert 'secret' not in response.text


def test_sync_requires_connection_and_valid_body():
    client, _ = build_client()
    login(client)
    assert client.post('/api/sync', json={'automatic': False}, headers={'Origin': 'http://testserver'}).status_code == 409
    assert client.post('/api/sync', json={'url': 'http://evil'}, headers={'Origin': 'http://testserver'}).status_code == 422


def test_oauth_state_cannot_be_consumed_by_another_session_on_same_database():
    client, store = build_client(httpx.MockTransport(lambda request: httpx.Response(200, json={'access_token': 'access', 'refresh_token': 'refresh', 'expires_in': 100})))
    login(client)
    state = parse_qs(urlparse(client.get('/api/polar/authorize', follow_redirects=False).headers['location']).query)['state'][0]
    second = TestClient(client.app)
    login(second)
    assert second.get('/oauth2_callback', params={'state': state, 'code': 'x'}).status_code == 400
    assert client.get('/oauth2_callback', params={'state': state, 'code': 'x'}, follow_redirects=False).status_code == 303


def test_expired_access_token_refresh_is_serialized_and_server_only():
    client, store = build_client()
    auth = client.app.state.auth
    store.save_tokens({'access_token': 'old', 'refresh_token': 'old-refresh', 'expires_in': 1}, auth.cipher)
    calls = []
    async def handler(request):
        calls.append(request.content)
        await asyncio.sleep(0.01)
        return httpx.Response(200, json={'access_token': 'new', 'refresh_token': 'new-refresh', 'expires_in': 1000})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            return await asyncio.gather(auth.access_token(http), auth.access_token(http))
    assert asyncio.run(run()) == ['new', 'new']
    assert len(calls) == 1
    assert calls[0] == b'grant_type=refresh_token&refresh_token=old-refresh'
    assert 'new-refresh' not in repr(store.db.oauth_tokens.find_one())


def test_connected_sync_finishes_and_automatic_cooldown_is_visible():
    import time
    async def collector(store, http, token, run_id):
        assert await token() == 'access'
        await asyncio.sleep(0.05)
        store.save_result(run_id, {'path': '/devices', 'status': 'empty', 'count': 0})
    client, store = build_client(collector=collector)
    store.save_tokens({'access_token': 'access', 'refresh_token': 'refresh', 'expires_in': 1000}, client.app.state.auth.cipher)
    with client:
        login(client)
        first = client.post('/api/sync', json={'automatic': True}, headers={'Origin': 'http://testserver'})
        assert first.status_code == 202
        assert client.post('/api/sync', json={'automatic': False}, headers={'Origin': 'http://testserver'}).status_code == 409
        rid = first.json()['run_id']
        for _ in range(50):
            result = client.get('/api/sync/' + rid).json()
            if result['status'] != 'running':
                break
            time.sleep(0.01)
        assert result['status'] == 'completed'
        assert result['results'][0]['status'] == 'empty'
        assert result['timezone'] == 'Europe/Zurich'
        assert client.post('/api/sync', json={'automatic': True}, headers={'Origin': 'http://testserver'}).status_code == 429


def test_invalid_json_has_reason_and_text_and_body_validation_hides_password():
    client, store = build_client()
    login(client)
    run = store.begin_run(False)
    rid = store.save_response(run['run_id'], '/broken', {}, httpx.Response(200, content=b'{invalid', headers={'content-type': 'application/json'}))
    detail = client.get('/api/responses/' + rid).json()
    assert detail['raw_text'] == '{invalid'
    assert detail['payload_unavailable_reason']
    bad = client.post('/api/login', json={'password': ['sensitive-input']}, headers={'Origin': 'http://testserver'})
    assert bad.status_code == 422
    assert 'sensitive-input' not in bad.text


def test_failed_raw_persistence_marks_sync_failed_instead_of_completed():
    import time
    from pymongo.errors import ConnectionFailure
    async def collector(store, http, token, run_id):
        store.save_response(run_id, '/devices', {}, httpx.Response(200, json={'devices': []}))
    client, store = build_client(collector=collector)
    store.save_tokens({'access_token': 'access', 'refresh_token': 'refresh', 'expires_in': 1000}, client.app.state.auth.cipher)
    store.db.raw_api_responses.insert_one = lambda *a, **k: (_ for _ in ()).throw(ConnectionFailure('private'))
    with client:
        login(client)
        start = client.post('/api/sync', json={}, headers={'Origin': 'http://testserver'})
        rid = start.json()['run_id']
        for _ in range(50):
            result = client.get('/api/sync/' + rid).json()
            if result['status'] != 'running':
                break
            time.sleep(0.01)
        assert result['status'] == 'failed'
        assert result['results'] == []
        assert 'private' not in repr(result)


def test_render_requires_https_origin_and_secure_session_cookie(monkeypatch):
    from polar_api.config import Settings
    key = Fernet.generate_key().decode()
    monkeypatch.setenv('RENDER', 'true')
    with pytest.raises(RuntimeError, match='HTTPS'):
        Settings(owner_password='test-password-only', session_secret='x' * 40, token_encryption_key=key).validate()
    settings = Settings(owner_password='test-password-only', session_secret='x' * 40, token_encryption_key=key, public_url='https://polar.example', redirect_uri='https://polar.example/oauth2_callback')
    settings.validate()
    from polar_api.app import create_app
    client = TestClient(create_app(settings, make_store()), base_url='https://polar.example')
    response = client.post('/api/login', json={'password': 'test-password-only'}, headers={'Origin': 'https://polar.example'})
    assert response.status_code == 200
    assert 'Secure' in response.headers['set-cookie']
    assert 'HttpOnly' in response.headers['set-cookie']
    assert 'SameSite=lax' in response.headers['set-cookie']


def test_fresh_oauth_reconnect_replaces_tokens_encrypted_under_a_lost_key():
    client, store = build_client(httpx.MockTransport(lambda request: httpx.Response(200, json={'access_token': 'fresh-access', 'refresh_token': 'fresh-refresh', 'expires_in': 1000})))
    old_cipher = Fernet(Fernet.generate_key())
    store.save_tokens({'access_token': 'old-access', 'refresh_token': 'old-refresh', 'expires_in': 1000}, old_cipher)
    login(client)
    state = parse_qs(urlparse(client.get('/api/polar/authorize', follow_redirects=False).headers['location']).query)['state'][0]
    response = client.get('/oauth2_callback', params={'state': state, 'code': 'new-consent'}, follow_redirects=False)
    assert response.status_code == 303
    assert store.tokens(client.app.state.auth.cipher)['access_token'] == 'fresh-access'
    assert client.get('/api/dashboard').json()['connected'] is True


def test_unreadable_old_token_requires_reconnect_without_exception_or_leak():
    from fastapi import HTTPException
    client, store = build_client()
    store.save_tokens({'access_token': 'old-private-access', 'refresh_token': 'old-private-refresh', 'expires_in': 1000}, Fernet(Fernet.generate_key()))
    async def read_token():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: pytest.fail('Unreadable tokens must not trigger network exchange'))) as http:
            await client.app.state.auth.access_token(http)
    with pytest.raises(HTTPException) as error:
        asyncio.run(read_token())
    assert error.value.status_code == 409
    assert 'old-private' not in str(error.value)
    login(client)
    dashboard = client.get('/api/dashboard').json()
    assert dashboard['connected'] is False
    assert dashboard['connection_error']


def test_analytics_is_private_validates_ranges_and_does_not_collect():
    client, store = build_client()
    assert client.get('/api/analytics').status_code == 401
    login(client)
    assert client.get('/api/analytics?days=8').status_code == 422
    for days in (7, 30, 90):
        response = client.get(f'/api/analytics?days={days}')
        assert response.status_code == 200
        data = response.json()
        assert data['days'] == days
        assert data['timezone'] == 'Europe/Zurich'
        assert len(data['series']) == 5
        assert len(data['daily_recovery']) == days
        assert data['daily_recovery'][-1]['date'] == data['to']
        assert all(item['value'] is None and item['reason'] == 'missing' for item in data['daily_recovery'])
        assert all(item['source_path'] == '/nightly-recharge-results' and item['response_ids'] == [] for item in data['daily_recovery'])
        assert all(len(series['points']) == days for series in data['series'])
        assert all(point['value'] is None for series in data['series'] for point in series['points'])
    assert store.db.sync_runs.count_documents({}) == 0
    assert store.db.raw_api_responses.count_documents({}) == 0
