"""Calendar-day analytics replayed from successful raw Polar responses."""
import json
import math
import re
from datetime import date, datetime, time, timedelta, timezone
from statistics import median
from zoneinfo import ZoneInfo

ZURICH = ZoneInfo('Europe/Zurich')
AREAS = {
    'heart': ('/continuous-samples', 'Herzfrequenz', 'bpm', 'line'),
    'moon': ('/sleeps', 'Schlafdauer', 'min', 'line'),
    'recharge': ('/nightly-recharge-results', 'ANS-Status', 'ANS', 'line'),
    'activity': ('/activity/list', 'Schritte', 'Schritte', 'bar'),
    'training': ('/training-sessions/list', 'Trainingsdauer', 'min', 'bar'),
}
PATHS = tuple(area[0] for area in AREAS.values())


def _number(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _recovery_value(row):
    raw = row.get('recoveryIndicator')
    if raw is None:
        return None, 'missing'
    if isinstance(raw, int) and not isinstance(raw, bool) and 1 <= raw <= 6:
        return raw, 'available'
    return None, 'invalid'


def _dict(value):
    return value if isinstance(value, dict) else {}


def _objects(value):
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _stable(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(',', ':'), default=str)
    except (TypeError, ValueError, RecursionError):
        return str(value)


def _date(value):
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        return value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is not None:
        try:
            parsed = parsed.astimezone(ZURICH)
        except (OverflowError, OSError, ValueError):
            return None
    return parsed.date()


def _timestamp(value, naive_zone):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=naive_zone)
    try:
        return value.timestamp()
    except (OverflowError, OSError, ValueError):
        return None


def _rows(payload, key, nested=None):
    value = payload.get(key)
    if value is None and nested:
        value = _dict(payload.get(nested)).get(key)
    if isinstance(value, dict):
        value = value.get(key)
    return _objects(value)


def _row_rank(row, document, response_id, order, detail):
    modified = _timestamp(row.get('modified'), ZURICH)
    fetched = _timestamp(document.get('fetched_at'), timezone.utc)
    features = _dict(document.get('params')).get('features')
    return (
        int(detail),
        int(isinstance(features, list) and bool(features)),
        modified if modified is not None else fetched if fetched is not None else float('-inf'),
        fetched if fetched is not None else float('-inf'),
        order,
        response_id,
    )


def _put_latest(target, key, candidate):
    previous = target.get(key)
    if previous is None or candidate['rank'] > previous['rank']:
        target[key] = candidate


def _device_key(value):
    return _stable(value) if value is not None else 'unknown-device'


def _metric_payloads(store, since):
    archived = store.analytics_responses(PATHS, since)
    result = []
    for response_id, item in archived.items():
        try:
            document, body = item
            path = document.get('path')
            status = document.get('http_status')
            fetched = _timestamp(document.get('fetched_at'), timezone.utc)
            if path not in PATHS or not isinstance(status, int) or not 200 <= status < 300:
                continue
            if fetched is None:
                continue
            payload = json.loads(body)
            if isinstance(payload, dict):
                result.append((str(response_id), document, path, payload, fetched))
        except (TypeError, ValueError, UnicodeError, RecursionError):
            continue
    return result


def _sleep_minutes(row):
    raw = _dict(row.get('sleepEvaluation')).get('asleepDuration')
    if not isinstance(raw, str) or not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?s', raw):
        return None
    value = float(raw[:-1]) / 60
    return value if math.isfinite(value) else None


def _sport_key(value):
    return _stable(value) if value is not None else 'unknown-sport'


def _session_key(row):
    identifier = row.get('identifier')
    if isinstance(identifier, str) and identifier:
        return ('id', identifier)
    if isinstance(identifier, dict) and identifier:
        return ('id', _stable(identifier))
    start = row.get('startTime')
    return ('fallback', str(start or ''), _sport_key(row.get('sport')))


def _steps_start(day, value):
    if not isinstance(value, str):
        return None
    try:
        if 'T' in value:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=ZURICH)
            return parsed.astimezone(ZURICH)
        parsed_time = time.fromisoformat(value)
        return datetime.combine(day, parsed_time, ZURICH)
    except (TypeError, ValueError, OverflowError):
        return None


def _activity_detail(device_row):
    for sample in _objects(device_row.get('activitySamples')):
        steps = sample.get('stepSamples')
        if isinstance(steps, dict) and isinstance(steps.get('steps'), list):
            return True
    return False


def _build_values(archive, now, history_start):
    daily = {key: {} for key in AREAS}
    for response_id, document, path, payload, fetched in archive:
        try:
            fetched_local_date = datetime.fromtimestamp(fetched, ZURICH).date()
        except (OverflowError, OSError, ValueError):
            continue
        if fetched > now.timestamp():
            continue
        if path == '/continuous-samples':
            for order, row in enumerate(_rows(payload, 'heartRateSamplesPerDay', 'continuousSamples')):
                day = _date(row.get('date'))
                if not day or day < history_start or day > now.date():
                    continue
                device = _device_key(row.get('deviceRef', row.get('deviceReference')))
                samples = row.get('samples')
                candidate = {
                    'row': row,
                    'document': document,
                    'response_id': response_id,
                    'provisional': day < now.date() and fetched_local_date <= day,
                    'rank': _row_rank(row, document, response_id, order, isinstance(samples, list)),
                }
                _put_latest(daily['heart'], (day, device), candidate)
        elif path == '/activity/list':
            for order, row in enumerate(_rows(payload, 'activityDays', 'activities')):
                day = _date(row.get('date'))
                if not day or day < history_start or day > now.date():
                    continue
                for device_row in _objects(row.get('activitiesPerDevice')):
                    device = _device_key(device_row.get('deviceReference', device_row.get('deviceRef')))
                    candidate = {
                        'row': device_row,
                        'document': document,
                        'response_id': response_id,
                        'provisional': day < now.date() and fetched_local_date <= day,
                        'rank': _row_rank(row, document, response_id, order, _activity_detail(device_row)),
                    }
                    _put_latest(daily['activity'], (day, device), candidate)
        elif path == '/sleeps':
            for order, row in enumerate(_rows(payload, 'nightSleeps')):
                day = _date(row.get('sleepDate'))
                if not day or day < history_start or day > now.date():
                    continue
                value = _sleep_minutes(row)
                candidate = {
                    'value': value,
                    'row': row,
                    'document': document,
                    'response_id': response_id,
                    'rank': _row_rank(row, document, response_id, order, value is not None),
                }
                _put_latest(daily['moon'], day, candidate)
        elif path == '/nightly-recharge-results':
            for order, row in enumerate(_rows(payload, 'nightlyRechargeResults')):
                day = _date(row.get('sleepResultDate'))
                value = row.get('ansStatus')
                if not day or day < history_start or day > now.date():
                    continue
                usable = value if _number(value) else None
                complete = usable is not None or 'ansStatus' in row or 'recoveryIndicator' in row
                candidate = {
                    'value': usable,
                    'row': row,
                    'document': document,
                    'response_id': response_id,
                    'rank': _row_rank(row, document, response_id, order, complete),
                }
                _put_latest(daily['recharge'], day, candidate)
        else:
            for order, row in enumerate(_rows(payload, 'trainingSessions')):
                day = _date(row.get('startTime'))
                if not day or day < history_start or day > now.date():
                    continue
                duration = row.get('durationMillis')
                value = duration / 60000 if _number(duration) and duration >= 0 else None
                candidate = {
                    'value': value,
                    'row': row,
                    'document': document,
                    'response_id': response_id,
                    'provisional': day < now.date() and fetched_local_date <= day,
                    'rank': _row_rank(row, document, response_id, order, value is not None),
                }
                _put_latest(daily['training'], _session_key(row), candidate)

    values = {key: {} for key in AREAS}
    for (day, device), candidate in daily['heart'].items():
        entry = values['heart'].setdefault(day, {'buckets': {}, 'response_ids': set(), 'provisional': False})
        entry['provisional'] = entry['provisional'] or candidate['provisional']
        buckets = {}
        for index, sample in enumerate(_objects(candidate['row'].get('samples'))):
            value = sample.get('heartRate')
            if not _number(value) or value <= 0:
                continue
            offset = sample.get('offsetMillis')
            bucket = offset if _number(offset) and offset >= 0 else index
            buckets[bucket] = value
        if buckets:
            for offset, value in buckets.items():
                entry['buckets'][(device, offset)] = value
            entry['response_ids'].add(candidate['response_id'])

    for (day, device), candidate in daily['activity'].items():
        entry = values['activity'].setdefault(day, {'buckets': {}, 'response_ids': set(), 'provisional': False})
        entry['provisional'] = entry['provisional'] or candidate['provisional']
        day_start = datetime.combine(day, time.min, ZURICH).timestamp()
        day_end = datetime.combine(day + timedelta(days=1), time.min, ZURICH).timestamp()
        buckets = {}
        for sample in _objects(candidate['row'].get('activitySamples')):
            step_samples = _dict(sample.get('stepSamples'))
            interval = step_samples.get('interval')
            start = _steps_start(day, step_samples.get('startTime'))
            step_values = step_samples.get('steps')
            if not _number(interval) or interval <= 0 or start is None or not isinstance(step_values, list):
                continue
            for index, value in enumerate(step_values):
                if not _number(value) or value < 0:
                    continue
                try:
                    bucket = start.timestamp() + interval * index / 1000
                except (OverflowError, OSError, ValueError):
                    continue
                if not math.isfinite(bucket) or not day_start <= bucket < day_end:
                    continue
                buckets[bucket] = value
        if buckets:
            for timestamp, value in buckets.items():
                entry['buckets'][(device, timestamp)] = value
            entry['response_ids'].add(candidate['response_id'])

    for name in ('moon', 'recharge'):
        for day, candidate in daily[name].items():
            if name == 'recharge' or candidate['value'] is not None:
                values[name][day] = {
                    'value': candidate['value'],
                    'response_ids': {candidate['response_id']},
                    'row': candidate['row'],
                    'response_id': candidate['response_id'],
                }

    for session_key, candidate in daily['training'].items():
        if candidate['value'] is None:
            continue
        # Session date was retained on the candidate row to avoid relying on archive fetch dates.
        day = _date(candidate['row']['startTime'])
        if day is None:
            continue
        entry = values['training'].setdefault(day, {'sessions': [], 'response_ids': set(), 'provisional': False})
        entry['sessions'].append(candidate['value'])
        entry['response_ids'].add(candidate['response_id'])
        entry['provisional'] = entry['provisional'] or candidate['provisional']

    return values


def _clean(value, key):
    if not math.isfinite(value):
        return None
    if key in ('heart', 'moon', 'training'):
        return round(value, 1)
    if key == 'recharge':
        return round(value, 2)
    return int(value) if isinstance(value, (int, float)) and value == int(value) else value


def _day_value(entry, key):
    if not entry:
        return None, [], None, False
    provisional = entry.get('provisional', False)
    ids = sorted(entry['response_ids'])
    if key in ('heart', 'activity'):
        buckets = entry['buckets']
        if not buckets:
            return None, [], None, provisional
        raw = sum(buckets.values()) / len(buckets) if key == 'heart' else sum(buckets.values())
        return _clean(raw, key), ids, len(buckets), provisional
    if key == 'training':
        sessions = entry['sessions']
        if not sessions:
            return None, [], None, provisional
        return _clean(sum(sessions), key), ids, len(sessions), provisional
    if entry['value'] is None:
        return None, [], None, provisional
    return _clean(entry['value'], key), ids, None, provisional


def _format(value):
    return f'{value:g}'


def _feedback(day, value, baseline, comparison_days, key, provisional, today):
    required = 7
    start = day - timedelta(days=28)
    end = day - timedelta(days=1)
    if value is None:
        status, baseline, delta = 'missing', None, None
        text = 'Für diesen Tag liegen keine gültigen Messwerte vor.'
    elif provisional:
        status, baseline, delta = 'provisional', None, None
        text = ('Der heutige Wert ist vorläufig; der Tag ist noch nicht abgeschlossen.' if day == today else
                'Unvollständiger Tagesstand; ein Vergleich ist nicht möglich.')
    elif comparison_days < required:
        status, baseline, delta = 'insufficient', None, None
        text = f'Noch zu wenig Vergleichsdaten: {comparison_days} von mindestens {required} gültigen Vortagen im 28-Tage-Fenster.'
    else:
        status = 'comparison'
        delta = _clean(value - baseline, key)
        baseline = _clean(baseline, key)
        unit = {'moon': 'Minuten', 'training': 'Minuten'}.get(key, AREAS[key][2])
        subject = {
            'heart': 'Deine Herzfrequenz',
            'moon': 'Deine Schlafdauer',
            'recharge': 'Dein Nightly-Recharge-Wert',
            'activity': 'Deine Schrittzahl',
            'training': 'Deine Trainingsdauer',
        }[key]
        delta_unit = 'Punkte' if key == 'recharge' else unit
        if delta == 0:
            text = f'{subject} entspricht deinem bisherigen Median ({_format(baseline)} {unit}).'
        else:
            direction = 'unter' if delta < 0 else 'über'
            text = f'{subject} liegt {_format(abs(delta))} {delta_unit} {direction} deinem bisherigen Median ({_format(baseline)} {unit}).'
    return {
        'date': day.isoformat(),
        'status': status,
        'value': value,
        'baseline': baseline,
        'delta': delta,
        'comparison_days': comparison_days,
        'required_days': required,
        'from': start.isoformat(),
        'to': end.isoformat(),
        'text': text,
    }


def analytics(store, days=30, now=None):
    """Return five daily measurement series and non-medical historical comparisons."""
    if days not in (7, 30, 90):
        raise ValueError('days must be 7, 30, or 90')
    if now is None:
        now = datetime.now(ZURICH)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=ZURICH)
    else:
        now = now.astimezone(ZURICH)
    end = now.date()
    start = end - timedelta(days=days - 1)
    history_start = start - timedelta(days=28)
    since = datetime.combine(history_start, time.min, ZURICH).astimezone(timezone.utc)
    values = _build_values(_metric_payloads(store, since), now, history_start)
    result = {
        'days': days,
        'from': start.isoformat(),
        'to': end.isoformat(),
        'timezone': 'Europe/Zurich',
        'series': [],
        'daily_recovery': [],
    }
    for key, (path, label, unit, kind) in AREAS.items():
        point_values = {}
        point_ids = {}
        sample_counts = {}
        point_provisional = {}
        all_days = (start - timedelta(days=28) + timedelta(days=index) for index in range(days + 28))
        for day in all_days:
            entry = values[key].get(day)
            value, ids, count, provisional = _day_value(entry, key)
            point_values[day] = value
            point_ids[day] = ids
            point_provisional[day] = provisional or (key == 'heart' and day == end and value is not None)
            if count is not None:
                sample_counts[day] = count

        points, feedback, valid_days = [], [], 0
        for index in range(days):
            day = start + timedelta(days=index)
            value = point_values[day]
            if value is not None:
                valid_days += 1
            provisional = key in ('heart', 'activity', 'training') and value is not None and (day == end or point_provisional[day])
            point_item = {
                'date': day.isoformat(),
                'value': value,
                'provisional': provisional,
                'response_ids': point_ids[day],
            }
            if day in sample_counts:
                point_item['sample_count'] = sample_counts[day]
            points.append(point_item)

            comparison_days = [
                point_values.get(day - timedelta(days=offset))
                for offset in range(1, 29)
            ]
            comparison_values = [
                item for offset, item in enumerate(comparison_days, start=1)
                if item is not None and not point_provisional.get(day - timedelta(days=offset), False)
            ]
            baseline = median(comparison_values) if len(comparison_values) >= 7 else None
            feedback.append(_feedback(day, value, baseline, len(comparison_values), key, provisional, end))
        result['series'].append({
            'key': key,
            'label': label,
            'unit': unit,
            'kind': kind,
            'source_path': path,
            'points': points,
            'coverage': {'valid_days': valid_days, 'total_days': days},
            'feedback': feedback,
        })
    for index in range(days):
        day = start + timedelta(days=index)
        entry = values['recharge'].get(day)
        row = entry.get('row') if entry else None
        value, reason = _recovery_value(row) if row else (None, 'missing')
        result['daily_recovery'].append({
            'date': day.isoformat(),
            'value': value,
            'reason': reason,
            'source_path': '/nightly-recharge-results',
            'response_ids': [entry['response_id']] if entry else [],
        })
    return result
