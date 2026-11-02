"""Read-only nightly summaries assembled from corrected archived Polar responses."""
import math
import re
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from .analytics import (
    _build_values, _date, _device_key, _dict, _metric_payloads,
    _number, _put_latest, _row_rank, _rows, _sleep_minutes,
)

ZURICH = ZoneInfo('Europe/Zurich')
NIGHT_DAYS = 90
NIGHT_PATHS = ('/continuous-samples', '/sleeps', '/nightly-recharge-results', '/activity/list')
PULSE_BIN_SECONDS = 5 * 60
_STAGES = {
    'SLEEP_STATE_WAKE': 'awake',
    'SLEEP_STATE_NON_REM1': 'light',
    'SLEEP_STATE_NON_REM2': 'light',
    'SLEEP_STATE_NON_REM3': 'deep',
    'SLEEP_STATE_REM': 'rem',
}


def _now(value):
    if value is None:
        return datetime.now(ZURICH)
    if value.tzinfo is None:
        return value.replace(tzinfo=ZURICH)
    return value.astimezone(ZURICH)


def _instant(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    if not isinstance(value, datetime) or value.tzinfo is None:
        return None
    try:
        timestamp = value.timestamp()
        return (timestamp, datetime.fromtimestamp(timestamp, ZURICH)) if math.isfinite(timestamp) else None
    except (OverflowError, OSError, ValueError):
        return None


def _seconds(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?s', value):
        return None
    try:
        result = float(value[:-1])
        return result if math.isfinite(result) else None
    except OverflowError:
        return None


def _at(timestamp):
    return datetime.fromtimestamp(timestamp, ZURICH).isoformat()


def _phase(stage, start, end):
    if end <= start:
        return None
    return {'start': _at(start), 'end': _at(end), 'stage': stage}


def _phases(hypnogram, start, end):
    if start is None or end is None or end[0] <= start[0]:
        return []
    duration = end[0] - start[0]
    changes = hypnogram.get('sleepStateChanges')
    if not isinstance(changes, list):
        return []
    transitions = []
    for index, item in enumerate(changes):
        if not isinstance(item, dict):
            continue
        offset = _seconds(item.get('offsetFromStart'))
        if offset is not None and 0 <= offset < duration:
            state = item.get('newState')
            transitions.append((offset, index, _STAGES.get(state, 'unknown') if isinstance(state, str) else 'unknown'))
    transitions.sort(key=lambda item: (item[0], item[1]))

    result, cursor, stage = [], 0.0, 'unknown'
    for offset, _, next_stage in transitions:
        if offset > cursor:
            item = _phase(stage, start[0] + cursor, start[0] + offset)
            if item:
                result.append(item)
        cursor, stage = offset, next_stage
    item = _phase(stage, start[0] + cursor, end[0])
    if item:
        result.append(item)
    return result


def _pulse(samples_by_day, start, end):
    if start is None or end is None or end[0] <= start[0]:
        return []
    first_day = datetime.fromtimestamp(start[0], ZURICH).date()
    last_day = datetime.fromtimestamp(math.nextafter(end[0], -math.inf), ZURICH).date()
    buckets = {}
    for day in sorted(day for day in samples_by_day if first_day <= day <= last_day):
        for timestamp, bpm in samples_by_day[day]:
            if start[0] <= timestamp < end[0]:
                index = int((timestamp - start[0]) // PULSE_BIN_SECONDS)
                buckets.setdefault(index, []).append(bpm)
    return [
        {'time': _at(start[0] + index * PULSE_BIN_SECONDS), 'bpm': round(sum(values) / len(values), 1)}
        for index, values in sorted(buckets.items())
    ]


def nights(store, now=None):
    """Return observed nights in the last 90 Zurich calendar dates."""
    current = _now(now)
    end_day = current.date()
    start_day = end_day - timedelta(days=NIGHT_DAYS - 1)
    history_start = start_day - timedelta(days=1)
    since = datetime.combine(history_start, time.min, ZURICH).astimezone(timezone.utc)
    archive = _metric_payloads(store, since, NIGHT_PATHS)
    analytics_archive = [item for item in archive if item[2] in ('/activity/list', '/nightly-recharge-results')]
    daily = _build_values(analytics_archive, current, history_start)

    sleep_rows, pulse_rows = {}, {}
    for response_id, document, path, payload, fetched in archive:
        if fetched > current.timestamp():
            continue
        if path == '/sleeps':
            for order, row in enumerate(_rows(payload, 'nightSleeps')):
                day = _date(row.get('sleepDate'))
                if day is None or not start_day <= day <= end_day:
                    continue
                _put_latest(sleep_rows, day, {
                    'row': row,
                    'rank': _row_rank(row, document, response_id, order, _sleep_minutes(row) is not None),
                })
        elif path == '/continuous-samples':
            for order, row in enumerate(_rows(payload, 'heartRateSamplesPerDay', 'continuousSamples')):
                day = _date(row.get('date'))
                if day is None or not history_start <= day <= end_day:
                    continue
                samples = row.get('samples')
                device = _device_key(row.get('deviceRef', row.get('deviceReference')))
                _put_latest(pulse_rows, (day, device), {
                    'row': row,
                    'rank': _row_rank(row, document, response_id, order, isinstance(samples, list)),
                })

    samples_by_day = {}
    for (day, _), candidate in pulse_rows.items():
        day_start = datetime.combine(day, time.min, ZURICH).timestamp()
        day_end = datetime.combine(day + timedelta(days=1), time.min, ZURICH).timestamp()
        deduplicated = {}
        samples = candidate['row'].get('samples')
        for sample in samples if isinstance(samples, list) else ():
            if not isinstance(sample, dict):
                continue
            bpm, offset = sample.get('heartRate'), sample.get('offsetMillis')
            if not _number(bpm) or not 0 < bpm <= 300 or not _number(offset) or offset < 0:
                continue
            timestamp = day_start + offset / 1000
            if math.isfinite(timestamp) and day_start <= timestamp < day_end:
                deduplicated[offset] = (timestamp, bpm)
        samples_by_day.setdefault(day, []).extend(deduplicated.values())

    result = []
    for day in sorted(sleep_rows, reverse=True):
        row = sleep_rows[day]['row']
        sleep_result = _dict(row.get('sleepResult'))
        hypnogram = _dict(sleep_result.get('hypnogram'))
        start = _instant(hypnogram.get('sleepStart'))
        end = _instant(hypnogram.get('sleepEnd'))
        if start is not None and end is not None and end[0] <= start[0]:
            start = end = None

        duration = _sleep_minutes(row)
        score = _dict(row.get('sleepScore')).get('sleepScore')
        if not _number(score) or not 1 <= score <= 100:
            score = None

        recharge = daily['recharge'].get(day)
        ans = recharge.get('value') if recharge else None
        recovery = _dict(recharge.get('row')).get('meanNightlyRecoveryRmssd') if recharge else None
        if not _number(recovery) or recovery <= 0:
            recovery = None

        activity = daily['activity'].get(day - timedelta(days=1))
        steps = (sum(activity['buckets'].values())
                 if activity and not activity.get('provisional') and activity.get('buckets') else None)
        if steps is not None and (not _number(steps) or steps < 0):
            steps = None

        result.append({
            'date': day.isoformat(),
            'start': start[1].isoformat() if start else None,
            'end': end[1].isoformat() if end else None,
            'sleep_minutes': round(duration, 1) if duration is not None else None,
            'sleep_score': score,
            'steps_previous_day': steps,
            'ans': ans if _number(ans) else None,
            'hrv_ms': recovery,
            'phases': _phases(hypnogram, start, end),
            'pulse': _pulse(samples_by_day, start, end),
        })
    return {'nights': result}
