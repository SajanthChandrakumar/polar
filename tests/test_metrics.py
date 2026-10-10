from datetime import datetime
from zoneinfo import ZoneInfo
import json
import pytest

from polar_api.metrics import dashboard_metrics

NOW = datetime(2026, 10, 7, 13, tzinfo=ZoneInfo('Europe/Zurich'))

class Archive:
    def __init__(self, bodies): self.bodies = bodies
    def response(self, key):
        return {'http_status': 200}, json.dumps(self.bodies[key]).encode()
    def responses(self, keys): return {key: self.response(key) for key in keys}

def snapshot(path, ids):
    return {'path': path, 'status': 'populated', 'response_ids': ids}

def test_live_metrics_use_latest_dates_and_deduplicate_repeated_step_buckets():
    bodies = {
        'hr': {'heartRateSamplesPerDay': [{'date': '2026-10-07', 'samples': [{'heartRate': 60}, {'heartRate': 80}, {'heartRate': 0}]}]},
        'sleep': {'nightSleeps': [{'sleepDate': '2026-10-07', 'sleepEvaluation': {'asleepDuration': '25200s', 'sleepSpan': '28800s'}}, {'sleepDate': '2026-10-06', 'sleepEvaluation': {'asleepDuration': '18000s'}}]},
        'recovery': {'nightlyRechargeResults': [{'sleepResultDate': '2026-10-07', 'ansStatus': 0.0}]},
        'steps': {'activityDays': [{'date': '2026-10-07', 'activitiesPerDevice': [{'deviceReference': {'deviceId': 'loop'}, 'activitySamples': [{'stepSamples': {'startTime': '00:00:00', 'interval': 60000, 'steps': [10, 20, 0]}}]}]}]},
        'training': {'trainingSessions': [{'startTime': '2026-10-06T10:00:00', 'durationMillis': 600000}, {'startTime': '2026-10-07T10:00:00', 'durationMillis': 1800000}]},
        'device': {'devicesData': [{'deviceReference': {'uuid': 'loop'}, 'productVariant': {'productDescription': 'Polar Loop Gen 2'}}, {'deviceReference': {'uuid': 'other'}, 'productVariant': {'productDescription': 'Other watch'}}]},
    }
    sources = [snapshot(p, ids) for p, ids in [('/continuous-samples', ['hr']), ('/sleeps', ['sleep']), ('/nightly-recharge-results', ['recovery']), ('/activity/list', ['steps', 'steps']), ('/training-sessions/list', ['training']), ('/user-devices', ['device'])]]
    result = dashboard_metrics(Archive(bodies), sources, NOW)
    assert {k: v['value'] for k, v in result.items()} == {'heart': 70, 'moon': 420, 'recharge': 0, 'activity': 30, 'training': 30, 'device': 1}
    assert result['moon']['date'] == '2026-10-07'
    assert result['heart']['sample_count'] == 2

def test_old_readings_are_marked_stale_and_missing_fields_do_not_become_zero():
    archive = Archive({'old': {'nightlyRechargeResults': [{'sleepResultDate': '2026-10-03', 'ansStatus': -1.2}]}, 'missing': {'nightSleeps': [{'sleepDate': '2026-10-07', 'sleepScore': {'sleepScore': 90}}]}})
    result = dashboard_metrics(archive, [snapshot('/nightly-recharge-results', ['old']), snapshot('/sleeps', ['missing'])], NOW)
    assert result['recharge']['status'] == 'stale'
    assert result['moon']['value'] is None
    assert result['moon']['status'] == 'unavailable'
    assert result['activity']['value'] is None

def test_failed_source_cannot_publish_a_successful_metric_or_read_its_archive():
    result = dashboard_metrics(Archive({}), [{'path': '/activity/list', 'status': 'failed', 'response_ids': ['unreadable']}], NOW)
    assert result['activity']['value'] is None

def test_latest_usable_day_survives_empty_newer_rows_and_overlapping_buckets():
    archive = Archive({
        'hr': {'heartRateSamplesPerDay': [{'date': '2026-10-06', 'samples': [{'heartRate': 70, 'offsetMillis': 0}]}, {'date': '2026-10-07', 'samples': []}]},
        'steps': {'activityDays': [{'date': '2026-10-06', 'activitiesPerDevice': [{'deviceReference': {'deviceId': 'loop'}, 'activitySamples': [{'stepSamples': {'startTime': '00:00:00', 'interval': 60000, 'steps': [10, 20]}}, {'stepSamples': {'startTime': '00:01:00', 'interval': 60000, 'steps': [20]}}]}]}, {'date': '2026-10-07'}]},
    })
    result = dashboard_metrics(archive, [snapshot('/continuous-samples', ['hr']), snapshot('/activity/list', ['steps'])], NOW)
    assert result['heart']['value'] == 70
    assert result['heart']['status'] == 'stale'
    assert result['activity']['value'] == 30
    assert result['activity']['date'] == '2026-10-06'

def test_training_prefers_modified_record_when_its_start_time_is_unchanged():
    archive = Archive({'training': {'trainingSessions': [{'identifier': {'id': 'same'}, 'startTime': '2026-10-07T10:00:00', 'modified': '2026-10-07T11:00:00', 'durationMillis': 1800000}, {'identifier': {'id': 'same'}, 'startTime': '2026-10-07T10:00:00', 'modified': '2026-10-07T10:01:00', 'durationMillis': 600000}]}})
    result = dashboard_metrics(archive, [snapshot('/training-sessions/list', ['training'])], NOW)
    assert result['training']['value'] == 30

@pytest.mark.parametrize('path,payload,card', [
    ('/sleeps', {'nightSleeps': [{'sleepDate': '2026-10-07', 'sleepEvaluation': None}]}, 'moon'),
    ('/continuous-samples', {'heartRateSamplesPerDay': [{'date': '2026-10-07', 'samples': None}]}, 'heart'),
    ('/activity/list', {'activityDays': [{'date': '2026-10-07', 'activitiesPerDevice': [{'activitySamples': [{'stepSamples': None}]}]}]}, 'activity'),
    ('/activity/list', {'activityDays': [{'date': '2026-10-07', 'activitiesPerDevice': [None]}]}, 'activity'),
    ('/user-devices', {'devicesData': [{'productVariant': None}]}, 'device'),
])
def test_null_optional_fields_do_not_break_other_cards(path, payload, card):
    archive = Archive({'bad': payload, 'good': {'nightlyRechargeResults': [{'sleepResultDate': '2026-10-07', 'ansStatus': 0}]}})
    result = dashboard_metrics(archive, [snapshot(path, ['bad']), snapshot('/nightly-recharge-results', ['good'])], NOW)
    assert result[card]['value'] is None
    assert result['recharge']['value'] == 0

def test_training_prefers_latest_archive_when_modified_is_missing():
    archive = Archive({'older': {'trainingSessions': [{'startTime': '2026-10-07T10:00:00', 'durationMillis': 600000}]}, 'newer': {'trainingSessions': [{'startTime': '2026-10-07T10:00:00', 'durationMillis': 1800000}]}})
    result = dashboard_metrics(archive, [snapshot('/training-sessions/list', ['older', 'newer'])], NOW)
    assert result['training']['value'] == 30


def test_activity_supports_documented_wrapper_and_keeps_zero_samples():
    archive = Archive({'wrapped': {'activities': {'activityDays': [{'date': '2026-10-07', 'activitiesPerDevice': [{'deviceReference': {'deviceId': 'loop'}, 'activitySamples': [{'stepSamples': {'startTime': '00:00:00', 'interval': 60000, 'steps': [0, 5]}}]}]}]}}})
    result = dashboard_metrics(archive, [snapshot('/activity/list', ['wrapped'])], NOW)
    assert result['activity']['value'] == 5
