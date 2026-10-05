import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
import pytest

from polar_api.collector import collect, plan_requests
from polar_api.inventory import ENDPOINTS, SCOPES

NOW = datetime(2026, 10, 25, 12, 30, tzinfo=ZoneInfo('Europe/Zurich'))

class Store:
    def __init__(self):
        self.raw = []
        self.results = []
        self.connected = True
        self.connection_error = None
    def save_response(self, run_id, path, params, response):
        self.raw.append((path, params, response.status_code, response.content))
        return str(len(self.raw))
    def connection_failed(self):
        self.connected = False
        self.connection_error = "Polar-Verbindung muss erneuert werden."
    def save_result(self, run_id, result):
        self.results.append(result)

async def token(force_refresh=False):
    return 'synthetic-token'

def fixture(endpoint):
    if endpoint['result_type'] == 'binary':
        return httpx.Response(200, content=b'\x89PNG\r\n', headers={'content-type': 'image/png'})
    value = [] if endpoint.get('count_path') else {}
    for key in reversed(endpoint.get('count_path', endpoint.get('object_path', []))):
        value = {key: value}
    return httpx.Response(200, json=value)

def run_collect(monkeypatch, handler, store=None):
    import polar_api.collector as collector
    monkeypatch.setattr(collector, 'utc_now', lambda: NOW)
    async def no_sleep(delay):
        return None
    monkeypatch.setattr(collector.asyncio, 'sleep', no_sleep)
    async def run():
        actual = store or Store()
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await collect(actual, client, token, 'run')
        return actual
    return asyncio.run(run())

def test_inventory_contains_all_21_read_paths_and_operation_scopes():
    assert len(ENDPOINTS) == 21
    assert len({e['path'] for e in ENDPOINTS}) == 21
    assert 'accesslink.read_all' not in SCOPES
    assert set(SCOPES) == {e['scope'] for e in ENDPOINTS}
    assert next(e for e in ENDPOINTS if e['path'] == '/training-sessions/list')['features'] == ['samples', 'test-results', 'training-load-report', 'laps', 'hill-splits', 'routes', 'statistics', 'zones', 'pause-times', 'strength-training-results', 'comments', 'physical-info']

def test_planner_all_features_sizes_and_calendar_days_including_dst_today():
    for endpoint in ENDPOINTS:
        if '{routeId}' in endpoint['path']:
            continue
        requests = plan_requests(endpoint, NOW)
        if endpoint['result_type'] == 'binary':
            assert [p['size'] for p in requests] == ['small', 'medium', 'large']
        if endpoint.get('date_fields'):
            start_key, end_key = endpoint['date_fields']
            assert datetime.fromisoformat(requests[0][start_key]).date().isoformat() == '2026-10-18'
            assert datetime.fromisoformat(requests[-1][end_key]) == NOW
            for params in requests:
                start = datetime.fromisoformat(params[start_key])
                end = datetime.fromisoformat(params[end_key])
                assert start < end <= NOW
                assert (end.date() - start.date()).days <= endpoint['max_days']
            if endpoint.get('detail_per_day'):
                detail = [p for p in requests if 'features' in p]
                assert len(detail) == 8
                assert detail[-2]['to'] == '2026-10-25T00:00:00+02:00'
                assert detail[-1]['to'] == '2026-10-25T12:30:00+01:00'
        if endpoint['features']:
            assert any(p.get('features') == endpoint['features'] for p in requests)
            assert 'features' not in requests[0]

def test_all_areas_archive_discovery_and_details_binary_and_routes_skip(monkeypatch):
    by_path = {e['path']: e for e in ENDPOINTS}
    seen = []
    def handler(request):
        assert str(request.url).startswith('https://www.polaraccesslink.com/v4/data/')
        seen.append(request)
        return fixture(by_path[request.url.path.removeprefix('/v4/data')])
    store = run_collect(monkeypatch, handler)
    assert len(store.results) == 21
    assert {r['path'] for r in store.results} == set(by_path)
    route = next(r for r in store.results if '{routeId}' in r['path'])
    assert route['status'] == 'skipped' and 'referenz' in route['message'].lower()
    assert all(r['status'] in {'empty', 'populated', 'skipped'} for r in store.results)
    training = [r for r in seen if r.url.path.endswith('/training-sessions/list')]
    assert len(training) == 9
    assert training[1].url.params.get_list('features') == by_path['/training-sessions/list']['features']
    assert sum(len(r['response_ids']) for r in store.results) == len(store.raw)

def test_invalid_json_unknown_schema_and_forbidden_are_isolated_and_raw_preserved(monkeypatch):
    by_path = {e['path']: e for e in ENDPOINTS}
    def handler(request):
        path = request.url.path.removeprefix('/v4/data')
        if path == '/user/account-data': return httpx.Response(200, content=b'{broken')
        if path == '/subscriptions': return httpx.Response(200, json={'error': 'oops'})
        if path == '/calendar/list': return httpx.Response(403, json={'error': 'denied'})
        return fixture(by_path[path])
    store = run_collect(monkeypatch, handler)
    results = {r['path']: r for r in store.results}
    assert results['/user/account-data']['status'] == 'failed'
    assert results['/subscriptions']['status'] == 'failed'
    assert results['/subscriptions']['count'] is None
    assert results['/calendar/list']['status'] == 'denied'
    assert store.connected is True
    assert results['/sports/list']['status'] == 'empty'
    assert any(raw[3] == b'{broken' for raw in store.raw)

def test_retries_archive_each_attempt_once_refresh_and_bounded_retry_after(monkeypatch):
    by_path = {e['path']: e for e in ENDPOINTS}
    attempts = {}
    refresh = []
    import polar_api.collector as collector
    async def refresh_token(force_refresh=False):
        refresh.append(force_refresh)
        return 'synthetic-token'
    monkeypatch.setattr(collector, 'utc_now', lambda: NOW)
    waits = []
    async def sleep(delay): waits.append(delay)
    monkeypatch.setattr(collector.asyncio, 'sleep', sleep)
    def handler(request):
        path = request.url.path.removeprefix('/v4/data')
        attempts[path] = attempts.get(path, 0) + 1
        if path == '/user-devices' and attempts[path] == 1: return httpx.Response(401, json={})
        if path == '/user/account-data' and attempts[path] <= 2: return httpx.Response(429, headers={'retry-after': '999999'}, json={})
        if path == '/subscriptions': return httpx.Response(503, json={})
        if path == '/sports/list': raise httpx.ReadTimeout('synthetic', request=request)
        return fixture(by_path[path])
    async def run():
        store = Store()
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await collect(store, client, refresh_token, 'run')
        return store
    store = asyncio.run(run())
    assert refresh.count(True) == 1
    assert attempts['/user-devices'] == 2
    assert attempts['/subscriptions'] == 3
    assert attempts['/sports/list'] == 3
    assert max(waits) <= 30
    assert [r[2] for r in store.raw if r[0] == '/user/account-data'] == [429, 429, 200]
    assert next(r for r in store.results if r['path'] == '/subscriptions')['status'] == 'failed'

def test_routes_use_only_documented_target_exercise_uint64_ids(monkeypatch):
    by_path = {e['path']: e for e in ENDPOINTS}
    route_paths = []
    def handler(request):
        path = request.url.path.removeprefix('/v4/data')
        if path == '/training-target/favorites':
            return httpx.Response(200, json={'favoriteTarget': [{'exercise': [{'routeId': '42'}, {'routeId': 'https://evil.test'}, {'routeId': '../account-data'}, {'routeId': str(2**64)}], 'favorite': {'routeId': '77'}}]})
        if path == '/training-target/calendar-targets':
            return httpx.Response(200, json={'trainingTarget': [{'exercise': [{'routeId': '42'}, {'routeId': '99'}]}]})
        if path.startswith('/routes/'):
            route_paths.append(path)
            return httpx.Response(200, json={'userRoute': {'id': path.split('/')[-1]}})
        return fixture(by_path[path])
    store = run_collect(monkeypatch, handler)
    assert route_paths == ['/routes/42', '/routes/99']
    route = next(r for r in store.results if '{routeId}' in r['path'])
    assert route['count'] == 2 and len(route['response_ids']) == 2

def test_persistence_failure_aborts_without_success(monkeypatch):
    class Broken(Store):
        def save_response(self, *args):
            raise RuntimeError('storage unavailable')
    with pytest.raises(RuntimeError, match='storage unavailable'):
        run_collect(monkeypatch, lambda request: httpx.Response(200, json={}), Broken())

def test_retry_after_supports_http_date_invalid_and_nonfinite_values():
    from polar_api.collector import retry_after
    assert retry_after('Sun, 25 Oct 2026 11:30:10 GMT', NOW) == 10
    assert retry_after('invalid', NOW) == 1
    assert retry_after('NaN', NOW) == 1
    assert retry_after('-5', NOW) == 0


def test_midnight_period_never_sends_zero_or_future_today_window():
    endpoint = next(e for e in ENDPOINTS if e['path'] == '/sleeps')
    midnight = NOW.replace(hour=0, minute=0)
    requests = plan_requests(endpoint, midnight)
    assert len(requests) == 8
    assert requests[-1]['to'] == midnight.isoformat()
    assert all(p['from'] != p['to'] for p in requests)
    with pytest.raises(ValueError, match='timezone-aware'):
        plan_requests(endpoint, NOW.replace(tzinfo=None))


def test_count_does_not_double_count_discovery_records_in_detail(monkeypatch):
    by_path = {e['path']: e for e in ENDPOINTS}
    def handler(request):
        path = request.url.path.removeprefix('/v4/data')
        if path == '/sleeps':
            count = 8 if 'features' not in request.url.params else 1
            return httpx.Response(200, json={'nightSleeps': [{'date': 'synthetic'}] * count})
        return fixture(by_path[path])
    store = run_collect(monkeypatch, handler)
    sleep = next(r for r in store.results if r['path'] == '/sleeps')
    assert sleep['count'] == 8 and len(sleep['response_ids']) == 9


def test_redirect_is_archived_and_not_followed(monkeypatch):
    by_path = {e['path']: e for e in ENDPOINTS}
    def handler(request):
        assert request.url.host == 'www.polaraccesslink.com'
        path = request.url.path.removeprefix('/v4/data')
        if path == '/user/account-data':
            return httpx.Response(302, headers={'location': 'https://evil.test'})
        return fixture(by_path[path])
    store = run_collect(monkeypatch, handler)
    account = next(r for r in store.results if r['path'] == '/user/account-data')
    assert account['http_status'] == 302 and account['status'] == 'failed'


def test_invalid_binary_content_type_never_becomes_populated(monkeypatch):
    by_path = {e['path']: e for e in ENDPOINTS}
    def handler(request):
        path = request.url.path.removeprefix('/v4/data')
        if path == '/user/profile-picture':
            return httpx.Response(200, json={'error': 'cannot load'})
        return fixture(by_path[path])
    store = run_collect(monkeypatch, handler)
    picture = next(r for r in store.results if r['path'] == '/user/profile-picture')
    assert picture['status'] == 'failed' and picture['count'] is None
    assert len(picture['response_ids']) == 3

def test_token_store_failure_aborts_before_any_endpoint_result(monkeypatch):
    import polar_api.collector as collector
    from polar_api.store import LeaseLost
    async def broken_token(force_refresh=False):
        raise LeaseLost()
    async def run():
        store = Store()
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={}))) as client:
            await collector.collect(store, client, broken_token, 'run')
        return store
    with pytest.raises(LeaseLost):
        asyncio.run(run())


def test_second_401_is_denied_and_refresh_stops_once_per_request(monkeypatch):
    by_path = {e['path']: e for e in ENDPOINTS}
    attempts = []
    def handler(request):
        path = request.url.path.removeprefix('/v4/data')
        if path == '/user/account-data':
            attempts.append(path)
            return httpx.Response(401, json={'error': 'expired'})
        return fixture(by_path[path])
    store = run_collect(monkeypatch, handler)
    account = next(r for r in store.results if r['path'] == '/user/account-data')
    assert len(attempts) == 2
    assert account['status'] == 'denied' and account['http_status'] == 401
    assert len(account['response_ids']) == 2
    assert store.connected is False
    assert 'erneuert' in store.connection_error

def test_expected_token_unavailable_is_isolated_without_exposing_detail():
    from fastapi import HTTPException
    async def unavailable_token(force_refresh=False):
        raise HTTPException(409, 'private-detail-should-not-escape')
    async def run():
        store = Store()
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: pytest.fail('No request without token'))) as client:
            await collect(store, client, unavailable_token, 'run')
        return store
    store = asyncio.run(run())
    assert len(store.results) == 21
    assert all(r['status'] in {'failed', 'skipped'} for r in store.results)
    assert 'private-detail' not in str(store.results)
    assert not store.raw

def test_rejected_refresh_preserves_401_provenance_and_denied_status(monkeypatch):
    from fastapi import HTTPException
    import polar_api.collector as collector
    monkeypatch.setattr(collector, 'utc_now', lambda: NOW)
    async def failed_refresh(force_refresh=False):
        if force_refresh:
            raise HTTPException(502, 'private-polar-body')
        return 'synthetic-token'
    async def run():
        store = Store()
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(401, json={}))) as client:
            await collect(store, client, failed_refresh, 'run')
        return store
    store = asyncio.run(run())
    account = next(r for r in store.results if r['path'] == '/user/account-data')
    assert account['status'] == 'denied' and account['http_status'] == 401
    assert account['fetched_at'] is not None
    assert len(account['response_ids']) == 1
    assert 'private-polar' not in str(store.results)

def test_final_401_disconnect_persistence_failure_aborts(monkeypatch):
    class BrokenConnection(Store):
        def connection_failed(self):
            raise RuntimeError('connection state storage unavailable')
    with pytest.raises(RuntimeError, match='connection state storage unavailable'):
        run_collect(monkeypatch, lambda request: httpx.Response(401, json={}), BrokenConnection())
