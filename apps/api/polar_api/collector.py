"""Sequential, raw-first collection of the documented AccessLink v4 read areas."""
import asyncio
from datetime import datetime, time, timedelta, timezone
from email.utils import parsedate_to_datetime
import math
import re
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException

from .inventory import BASE_URL, ENDPOINTS

ZURICH = ZoneInfo('Europe/Zurich')


def utc_now():
    return datetime.now(timezone.utc)


def plan_requests(endpoint, now):
    """Local datetimes, or date ranges with exclusive end including partial today."""
    if now.tzinfo is None:
        raise ValueError('A timezone-aware collection time is required')
    now = now.astimezone(ZURICH)
    today = now.date()
    start = datetime.combine(today - timedelta(days=7), time.min, ZURICH)
    if not endpoint.get('date_fields'):
        return [{}]
    from_key, to_key = endpoint['date_fields']
    date_only = endpoint['date_kind'] == 'date'
    end = datetime.combine(today + timedelta(days=int(now.time() != time.min)), time.min, ZURICH) if date_only else now
    def wire(value):
        return value.date().isoformat() if date_only else value.replace(tzinfo=None, microsecond=0).isoformat()
    windows = []
    cursor = start
    while cursor < end:
        stop = min(cursor + timedelta(days=endpoint['max_days']), end)
        windows.append({from_key: wire(cursor), to_key: wire(stop)})
        cursor = stop
    if not endpoint['features']:
        return windows
    details = []
    cursor = start
    while cursor < end:
        days = 1 if endpoint['detail_per_day'] else endpoint['max_days']
        stop = min(cursor + timedelta(days=days), end)
        details.append({from_key: wire(cursor), to_key: wire(stop), 'features': endpoint['features'][:]})
        cursor = stop
    return windows + details


class RequestFailure(Exception):
    """Only safe, fixed messages cross this boundary; credentials never appear."""


def retry_after(value, now):
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        try:
            seconds = (parsedate_to_datetime(value) - now.astimezone(timezone.utc)).total_seconds()
        except (TypeError, ValueError, OverflowError):
            seconds = 1
    if not math.isfinite(seconds):
        seconds = 1
    return max(0, min(seconds, 30))


async def fetch(store, client, token_provider, run_id, path, params, response_ids):
    refreshed = False
    retries = 0
    try:
        access_token = await token_provider()
    except HTTPException:
        raise RequestFailure('Polar-Verbindung konnte nicht erneuert werden.') from None
    query = [(key, item) for key, value in params.items() for item in (value if isinstance(value, list) else [value])]
    while True:
        try:
            response = await client.get(
                BASE_URL + path, params=query,
                headers={'Authorization': 'Bearer ' + access_token},
                timeout=30, follow_redirects=False,
            )
        except httpx.RequestError:
            if retries >= 2:
                raise RequestFailure('Netzwerkfehler nach höchstens zwei Wiederholungen.') from None
            retries += 1
            await asyncio.sleep(retries)
            continue
        # Persistence failures must escape: a run with lost raw bodies cannot succeed.
        response_ids.append(store.save_response(run_id, path, params, response))
        if response.status_code == 401 and not refreshed:
            refreshed = True
            try:
                access_token = await token_provider(force_refresh=True)
            except HTTPException:
                return response  # The archived 401 remains the visible authorization failure.
            continue
        if (response.status_code == 429 or 500 <= response.status_code < 600) and retries < 2:
            retries += 1
            delay = retry_after(response.headers.get('retry-after'), utc_now()) if response.status_code == 429 else retries
            await asyncio.sleep(delay)
            continue
        return response


def parsed_count(endpoint, payload):
    """Counts only the exact documented array/object, never arbitrary JSON keys."""
    if not isinstance(payload, (dict, list)) or (isinstance(payload, dict) and any(key in payload for key in ('error', 'errors', 'errorMessage'))):
        raise ValueError('Unerwartete JSON-Antwort; kein dokumentierter Datensatz gezählt.')
    if endpoint['path'] == '/user/account-data' and isinstance(payload, dict) and isinstance(payload.get('basicInfo'), dict):
        return 1
    # Protobuf JSON omits empty repeated fields, yielding {} for empty lists.
    if payload == {} and endpoint.get('date_fields') and endpoint.get('count_path'):
        return 0
    path = endpoint.get('count_path') or endpoint.get('object_path')
    value = None
    for candidate in [path] + endpoint.get('wire_count_paths', []):
        current = payload
        for key in candidate:
            if not isinstance(current, dict) or key not in current:
                current = None
                break
            current = current[key]
        if (endpoint.get('count_path') and isinstance(current, list)) or (endpoint.get('object_path') and isinstance(current, dict)):
            value = current
            break
    if endpoint.get('count_path'):
        if not isinstance(value, list):
            raise ValueError('Dokumentierte Liste fehlt; Datensatzanzahl unbekannt.')
        if not all(isinstance(item, dict) for item in value):
            raise ValueError('Unerwartete Einträge in dokumentierter Liste.')
        return len(value)
    if not isinstance(value, dict):
        raise ValueError('Dokumentiertes Objekt fehlt; Datensatzanzahl unbekannt.')
    return int(bool(value))


def route_references(endpoint, payload):
    """Only documented trainingTarget/favoriteTarget -> exercise -> routeId."""
    key = 'trainingTarget' if endpoint['path'].endswith('calendar-targets') else 'favoriteTarget'
    refs = []
    for target in (payload if isinstance(payload, list) else payload.get(key, [])):
        if not isinstance(target, dict):
            continue
        exercises = target.get('exercise', [])
        if not isinstance(exercises, list):
            continue
        for exercise in exercises:
            if not isinstance(exercise, dict):
                continue
            ref = exercise.get('routeId')
            if isinstance(ref, str) and re.fullmatch(r'[0-9]{1,20}', ref) and int(ref) <= 2**64 - 1:
                refs.append(str(int(ref)))
    return refs


async def collect(store, client, get_access_token, run_id):
    now = utc_now().astimezone(ZURICH)
    period = {'from': datetime.combine(now.date() - timedelta(days=7), time.min, ZURICH).isoformat(),
              'to': now.isoformat(), 'timezone': 'Europe/Zurich'}
    route_ids = []
    for endpoint in ENDPOINTS:
        path = endpoint['path']
        result = {'path': path, 'status': 'empty', 'http_status': None, 'count': None,
                  'fetched_at': None, 'response_ids': [], 'period': period}
        if path == '/routes/{routeId}' and not route_ids:
            result.update(status='skipped', message='Keine gültige Route-ID in Trainingsziel- oder Favoritenreferenzen gefunden.')
            store.save_result(run_id, result)
            continue
        requests = [(path, params) for params in plan_requests(endpoint, now)] if path != '/routes/{routeId}' else [('/routes/' + quote(ref, safe=''), {}) for ref in dict.fromkeys(route_ids)]
        counts = {'discovery': [], 'detail': []}
        failures = []
        denied = False
        failure_http_status = None
        for request_path, params in requests:
            try:
                response = await fetch(store, client, get_access_token, run_id, request_path, params, result['response_ids'])
            except RequestFailure as error:
                failures.append(str(error))
                continue
            result['fetched_at'] = utc_now().isoformat()
            result['http_status'] = response.status_code
            if response.status_code == 401:
                store.connection_failed()
            if not 200 <= response.status_code < 300:
                denied = denied or response.status_code in (401, 403)
                failure_http_status = response.status_code
                failures.append('Polar-Verbindung erneuern (HTTP 401).' if response.status_code == 401 else 'Zugriff verweigert (HTTP 403).' if response.status_code == 403 else f'Polar-Abruf fehlgeschlagen (HTTP {response.status_code}).')
                continue
            try:
                payload = response.json()
                count = parsed_count(endpoint, payload)
            except (ValueError, UnicodeError):
                failures.append('Ungültiges JSON oder unbekannte Antwortstruktur; Rohantwort gespeichert, Datensatzanzahl unbekannt.')
                continue
            counts['detail' if 'features' in params else 'discovery'].append(count)
            if path in ('/training-target/calendar-targets', '/training-target/favorites'):
                route_ids.extend(route_references(endpoint, payload))
        if result['response_ids']:
            result['response_id'] = result['response_ids'][-1]
        if failures:
            result.update(status='denied' if denied else 'failed', count=None,
                          message=' '.join(dict.fromkeys(failures)))
            if failure_http_status is not None:
                result['http_status'] = failure_http_status
        else:
            # Features return the same records as discovery; never double-count both.
            result['count'] = sum(counts['detail'] or counts['discovery'])
            result['status'] = 'populated' if result['count'] else 'empty'
        store.save_result(run_id, result)
