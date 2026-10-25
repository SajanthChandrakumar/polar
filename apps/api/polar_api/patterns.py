"""Descriptive next-day activity and recovery patterns from archived readings."""
import math
from datetime import date, datetime, time, timedelta, timezone
from statistics import median, quantiles
from zoneinfo import ZoneInfo

from .analytics import _daily_points

ZURICH = ZoneInfo('Europe/Zurich')
MINIMUM_GROUP_SIZE = 7


def _now(value):
    if value is None:
        return datetime.now(ZURICH)
    if value.tzinfo is None:
        return value.replace(tzinfo=ZURICH)
    return value.astimezone(ZURICH)


def _date(value):
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(ZURICH)
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _number(value, *, nonnegative=False):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value) and (not nonnegative or value >= 0)
    except OverflowError:
        return False


def _point_map(points):
    result = {}
    for item in points:
        if not isinstance(item, dict):
            continue
        day = _date(item.get('date'))
        if day is not None:
            result[day] = item
    return result


def _median(values):
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return ordered[middle - 1] / 2 + ordered[middle] / 2


def _group_summary(values, *, available):
    if not available:
        return {'count': len(values), 'median': None, 'q1': None, 'q3': None}
    q1, _, q3 = quantiles(values, n=4, method='inclusive')
    middle = median(values)
    return {
        'count': len(values),
        'median': middle if _number(middle) else None,
        'q1': q1 if _number(q1) else None,
        'q3': q3 if _number(q3) else None,
    }


def calculate_patterns(activity_points, outcome_points, *, days=90, outcome='sleep', now=None):
    """Pair normalized activity dates with the next Zurich calendar day's outcome."""
    if days not in (30, 90):
        raise ValueError('days must be 30 or 90')
    if outcome not in ('sleep', 'ans'):
        raise ValueError("outcome must be 'sleep' or 'ans'")

    end = _now(now).date()
    start = end - timedelta(days=days - 1)
    activity_start, activity_end = start - timedelta(days=1), end - timedelta(days=1)
    activity_by_day = _point_map(activity_points)
    outcome_by_day = _point_map(outcome_points)

    steps_by_day = {}
    for index in range(days):
        day = activity_start + timedelta(days=index)
        item = activity_by_day.get(day)
        value = item.get('value') if item else None
        provisional = bool(item and item.get('provisional'))
        steps_by_day[day] = (value, provisional, item)

    threshold_values = [
        value for value, provisional, _ in steps_by_day.values()
        if not provisional and _number(value, nonnegative=True)
    ]
    threshold = _median(threshold_values) if threshold_values else None
    threshold = threshold if _number(threshold) else None

    result = {
        'days': days,
        'outcome': outcome,
        'from': start.isoformat(),
        'to': end.isoformat(),
        'activity_from': activity_start.isoformat(),
        'activity_to': activity_end.isoformat(),
        'timezone': 'Europe/Zurich',
        'unit': 'min' if outcome == 'sleep' else 'ANS',
        'threshold': threshold,
        'status': 'insufficient',
        'minimum_group_size': MINIMUM_GROUP_SIZE,
        'groups': {},
        'pairs': [],
        'exclusions': {'activity_unavailable': 0, 'activity_provisional': 0, 'outcome_unavailable': 0},
    }

    values = {'lower': [], 'upper': []}
    for index in range(days):
        outcome_day = start + timedelta(days=index)
        activity_day = outcome_day - timedelta(days=1)
        steps, provisional, activity_item = steps_by_day[activity_day]
        if not _number(steps, nonnegative=True):
            result['exclusions']['activity_unavailable'] += 1
            continue
        if provisional:
            result['exclusions']['activity_provisional'] += 1
            continue
        outcome_item = outcome_by_day.get(outcome_day)
        value = outcome_item.get('value') if outcome_item else None
        if not _number(value, nonnegative=outcome == 'sleep'):
            result['exclusions']['outcome_unavailable'] += 1
            continue
        if threshold is None:
            result['exclusions']['activity_unavailable'] += 1
            continue
        group = 'lower' if steps < threshold else 'upper'
        values[group].append(value)
        result['pairs'].append({
            'activity_date': activity_day.isoformat(),
            'outcome_date': outcome_day.isoformat(),
            'steps': steps,
            'value': value,
            'group': group,
            'activity_response_ids': activity_item.get('response_ids', []),
            'outcome_response_ids': outcome_item.get('response_ids', []),
        })

    available = all(len(values[group]) >= MINIMUM_GROUP_SIZE for group in ('lower', 'upper'))
    result['status'] = 'available' if available else 'insufficient'
    result['groups'] = {
        group: _group_summary(values[group], available=available)
        for group in ('lower', 'upper')
    }
    return result


def patterns(store, days=90, outcome='sleep', now=None):
    """Load normalized archive readings and calculate their descriptive groups."""
    if days not in (30, 90):
        raise ValueError('days must be 30 or 90')
    if outcome not in ('sleep', 'ans'):
        raise ValueError("outcome must be 'sleep' or 'ans'")

    current = _now(now)
    end = current.date()
    start = end - timedelta(days=days - 1)
    activity_start = start - timedelta(days=1)
    daily = _daily_points(store, activity_start, end, current)
    activity_points = [daily['activity'][activity_start + timedelta(days=index)] for index in range(days)]
    outcome_key = 'moon' if outcome == 'sleep' else 'recharge'
    outcome_points = [daily[outcome_key][start + timedelta(days=index)] for index in range(days)]
    return calculate_patterns(activity_points, outcome_points, days=days, outcome=outcome, now=current)
