"""Replay six dashboard values from archived, successful Polar responses."""
import json
import math
import re
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

ZURICH = ZoneInfo('Europe/Zurich')
AREAS = {
    'heart': ('/continuous-samples', 'heartRateSamplesPerDay', 'bpm', 'Mittelwert der Pulsmessungen'),
    'moon': ('/sleeps', 'nightSleeps', 'min', 'Tatsächliche Schlafdauer'),
    'recharge': ('/nightly-recharge-results', 'nightlyRechargeResults', 'ANS', 'ANS-Status von Polar'),
    'activity': ('/activity/list', 'activityDays', 'Schritte', 'Schritte aus Polar-Flow-Samples'),
    'training': ('/training-sessions/list', 'trainingSessions', 'min', 'Dauer des letzten Trainings'),
    'device': ('/user-devices', 'devicesData', 'Gerät', 'Polar Loop Gen 2'),
}

def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def obj(value):
    return value if isinstance(value, dict) else {}


def array(value):
    return value if isinstance(value, list) else []


def objects(value):
    return [item for item in array(value) if isinstance(item, dict)]


def text(value):
    return value if isinstance(value, str) else ''


def dashboard_metrics(store, sources, now=None):
    now = (now or datetime.now(ZURICH)).astimezone(ZURICH)
    by_path = {s['path']: s for s in sources}
    usable = {path: by_path[path] for path, *_ in AREAS.values() if path in by_path and by_path[path]['status'] in ('populated', 'empty')}
    ids = [rid for source in usable.values() for rid in source.get('response_ids', [])]
    archive = store.responses(ids) if ids else {}

    def date(value):
        if not isinstance(value, str): return None
        try:
            parsed = datetime.fromisoformat(value)
            day = (parsed.astimezone(ZURICH) if parsed.tzinfo else parsed).date()
            return day.isoformat() if day <= now.date() else None
        except ValueError: return None

    def records(path, key):
        result = []
        for rid in usable.get(path, {}).get('response_ids', []):
            document, body = archive.get(rid, (None, None))
            if not document or document['http_status'] != 200: continue
            try: payload = json.loads(body)
            except (ValueError, UnicodeError): continue
            if not isinstance(payload, dict): continue
            value = payload.get(key)
            if value is None and key == 'heartRateSamplesPerDay': value = obj(payload.get('continuousSamples')).get(key)
            if value is None and key == 'activityDays': value = obj(payload.get('activities')).get(key)
            if isinstance(value, dict): value = value.get(key)
            if isinstance(value, list): result.extend(r for r in value if isinstance(r, dict))
        return result

    metrics = {}
    for name, (path, key, unit, detail) in AREAS.items():
        metric = {'value': None, 'unit': unit, 'detail': detail, 'date': None, 'status': 'unavailable', 'source_path': path, 'response_ids': usable.get(path, {}).get('response_ids', [])}
        rows = records(path, key)
        if name == 'device':
            loops = {obj(r.get('deviceReference')).get('uuid') or r.get('hardwareIdentifier') for r in rows if text(obj(r.get('productVariant')).get('productDescription')).lower() == 'polar loop gen 2'} - {None}
            if loops: metric.update(value=len(loops), status='available')
        elif name in ('heart', 'activity'):
            daily = {}
            for r in rows:
                day = date(r.get('date'))
                if not day: continue
                buckets = daily.setdefault(day, {})
                if name == 'heart':
                    device = json.dumps(r.get('deviceRef', {}), sort_keys=True)
                    for index, sample in enumerate(objects(r.get('samples'))):
                        value = sample.get('heartRate')
                        if number(value) and value > 0:
                            buckets[(device, sample.get('offsetMillis', index))] = value
                else:
                    for device in objects(r.get('activitiesPerDevice')):
                        ref = json.dumps(device.get('deviceReference', {}), sort_keys=True)
                        for samples in objects(device.get('activitySamples')):
                            steps = obj(samples.get('stepSamples'))
                            interval = steps.get('interval')
                            if not number(interval) or interval <= 0: continue
                            try: start = datetime.combine(datetime.fromisoformat(day).date(), time.fromisoformat(steps.get('startTime', '')))
                            except (ValueError, TypeError): continue
                            for index, value in enumerate(array(steps.get('steps'))):
                                if number(value) and value >= 0:
                                    bucket = start + timedelta(milliseconds=interval * index)
                                    buckets[(ref, bucket.isoformat(), interval)] = value
            days = [day for day, buckets in daily.items() if buckets]
            if days:
                day = max(days)
                buckets = daily[day]
                value = round(sum(buckets.values()) / len(buckets), 1) if name == 'heart' else sum(buckets.values())
                metric.update(value=value, date=day, sample_count=len(buckets))
        else:
            candidates = []
            for order, r in enumerate(rows):
                day = date(r.get('sleepDate' if name == 'moon' else 'sleepResultDate' if name == 'recharge' else 'startTime'))
                if not day: continue
                if name == 'moon':
                    raw = obj(r.get('sleepEvaluation')).get('asleepDuration')
                    value = float(raw[:-1]) / 60 if isinstance(raw, str) and re.fullmatch(r'[0-9]+(?:\.[0-9]+)?s', raw) else None
                elif name == 'recharge': value = r.get('ansStatus')
                else:
                    raw = r.get('durationMillis')
                    value = raw / 60000 if number(raw) and raw >= 0 else None
                if number(value): candidates.append((day, text(r.get('startTime')), text(r.get('modified')), order, value))
            if candidates:
                day, _, _, _, value = max(candidates, key=lambda item: item[:4])
                metric.update(value=round(value, 1), date=day)
        if metric['value'] is not None and name != 'device':
            metric['status'] = 'available' if metric['date'] == now.date().isoformat() else 'stale'
        metrics[name] = metric
    return metrics
