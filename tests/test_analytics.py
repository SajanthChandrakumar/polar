import json
import hashlib
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import mongomock
import pytest
from bson import Binary
from mongomock.gridfs import enable_gridfs_integration

from polar_api.analytics import analytics
from polar_api.store import Store

ZURICH = ZoneInfo('Europe/Zurich')
NOW = datetime(2026, 10, 9, 12, tzinfo=ZURICH)


class Archive:
    def __init__(self, *rows):
        self.rows = {row[0]: (row[1], row[2]) for row in rows}
        self.requested_paths = None
        self.requested_since = None

    def analytics_responses(self, paths, since=None):
        self.requested_paths = tuple(paths)
        self.requested_since = since
        wanted = set(paths)
        return {
            key: value for key, value in self.rows.items()
            if value[0].get('path') in wanted
            and 200 <= value[0].get('http_status', 0) < 300
            and (since is None or value[0].get('fetched_at') >= since)
        }


def archived(response_id, path, body, fetched_at='2026-10-09T10:00:00+00:00', params=None):
    raw = body if isinstance(body, bytes) else json.dumps(body).encode()
    fetched = datetime.fromisoformat(fetched_at)
    if fetched.tzinfo is None:
        fetched = fetched.replace(tzinfo=timezone.utc)
    return response_id, {
        'path': path,
        'http_status': 200,
        'fetched_at': fetched,
        'run_id': response_id,
        'params': params or {},
    }, raw


def point(result, key, day):
    series = next(item for item in result['series'] if item['key'] == key)
    return series, next(item for item in series['points'] if item['date'] == day)


def feedback(result, key, day):
    series = next(item for item in result['series'] if item['key'] == key)
    return next(item for item in series['feedback'] if item['date'] == day)


def hr_row(day, value, *, modified=None, device=None, offset=0):
    row = {
        'date': day,
        'deviceRef': device or {'deviceId': 'loop'},
        'samples': [{'heartRate': value, 'offsetMillis': offset}],
    }
    if modified:
        row['modified'] = modified
    return row


def test_window_uses_zurich_calendar_dates_across_dst():
    archive = Archive(archived(
        'dst', '/continuous-samples', {
            'heartRateSamplesPerDay': [hr_row('2026-03-28T23:30:00+00:00', 72)],
        }, '2026-03-29T00:00:00+00:00'))

    result = analytics(archive, 7, datetime(2026, 3, 29, 0, 30, tzinfo=timezone.utc))

    assert (result['from'], result['to'], result['timezone']) == ('2026-03-23', '2026-03-29', 'Europe/Zurich')
    assert len(result['series']) == 5
    series, today = point(result, 'heart', '2026-03-29')
    assert today['value'] == 72
    assert today['response_ids'] == ['dst']
    assert series['coverage'] == {'valid_days': 1, 'total_days': 7}
    assert all(len(item['points']) == 7 for item in result['series'])


def test_feedback_compares_against_median_of_seven_distinct_prior_dates():
    rows = []
    for index, day in enumerate(('2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07')):
        rows.append(archived(f'h{index}', '/continuous-samples', {
            'heartRateSamplesPerDay': [hr_row(day, 60 + index)],
        }))
    rows.append(archived('target', '/continuous-samples', {
        'heartRateSamplesPerDay': [hr_row('2026-10-08', 90)],
    }))

    result = analytics(Archive(*rows), 7, NOW)
    comparison = feedback(result, 'heart', '2026-10-08')

    assert comparison['status'] == 'comparison'
    assert comparison['value'] == 90
    assert comparison['baseline'] == 63
    assert comparison['delta'] == 27
    assert (comparison['comparison_days'], comparison['required_days']) == (7, 7)
    assert (comparison['from'], comparison['to']) == ('2026-09-10', '2026-10-07')
    assert comparison['text'] == 'Deine Herzfrequenz liegt 27 bpm über deinem bisherigen Median (63 bpm).'


def test_feedback_is_insufficient_with_only_six_prior_measurement_dates():
    rows = [archived(f'h{day}', '/continuous-samples', {
        'heartRateSamplesPerDay': [hr_row(f'2026-10-{day:02d}', 60 + day)],
    }) for day in range(1, 7)]
    rows.append(archived('target', '/continuous-samples', {
        'heartRateSamplesPerDay': [hr_row('2026-10-08', 90)],
    }))

    result = analytics(Archive(*rows), 7, NOW)
    comparison = feedback(result, 'heart', '2026-10-08')

    assert comparison['status'] == 'insufficient'
    assert comparison['baseline'] is None
    assert comparison['delta'] is None
    assert comparison['comparison_days'] == 6


def test_latest_corrected_daily_record_wins_and_discovery_cannot_replace_detail():
    archive = Archive(
        archived('old-detail', '/continuous-samples', {
            'heartRateSamplesPerDay': [hr_row('2026-10-09', 60, modified='2026-10-09T10:00:00+02:00')],
        }, '2026-10-09T08:01:00+00:00'),
        archived('corrected-detail', '/continuous-samples', {
            'heartRateSamplesPerDay': [hr_row('2026-10-09', 80, modified='2026-10-09T10:00:00+02:00')],
        }, '2026-10-09T09:01:00+00:00'),
        archived('newer-discovery', '/continuous-samples', {
            'heartRateSamplesPerDay': [{'date': '2026-10-09', 'modified': '2026-10-09T12:00:00+02:00'}],
        }, '2026-10-09T10:01:00+00:00'),
    )

    result = analytics(archive, 7, NOW)
    _, today = point(result, 'heart', '2026-10-09')

    assert today['value'] == 80
    assert today['response_ids'] == ['corrected-detail']


def test_modified_timestamp_precedes_archive_fetch_order_when_selecting_corrections():
    archive = Archive(
        archived('fetched-later', '/continuous-samples', {
            'heartRateSamplesPerDay': [hr_row('2026-10-09', 60, modified='2026-10-09T10:00:00+02:00')],
        }, '2026-10-09T10:30:00+00:00'),
        archived('modified-later', '/continuous-samples', {
            'heartRateSamplesPerDay': [hr_row('2026-10-09', 80, modified='2026-10-09T11:00:00+02:00')],
        }, '2026-10-09T09:00:00+00:00'),
    )

    result = analytics(archive, 7, datetime(2026, 10, 9, 14, tzinfo=ZURICH))

    _, today = point(result, 'heart', '2026-10-09')
    assert today['value'] == 80
    assert today['response_ids'] == ['modified-later']


def test_newer_discovery_record_cannot_replace_feature_enriched_metric():
    archive = Archive(
        archived('feature-result', '/nightly-recharge-results', {
            'nightlyRechargeResults': [{'sleepResultDate': '2026-10-09', 'modified': '2026-10-09T10:00:00+02:00', 'ansStatus': -7, 'recoveryIndicator': 4}],
        }, '2026-10-09T08:00:00+00:00', {'from': '2026-10-02', 'features': ['samples']}),
        archived('discovery-result', '/nightly-recharge-results', {
            'nightlyRechargeResults': [{'sleepResultDate': '2026-10-09', 'modified': '2026-10-09T12:00:00+02:00', 'ansStatus': 12}],
        }, '2026-10-09T10:00:00+00:00'),
    )

    result = analytics(archive, 7, NOW)

    _, today = point(result, 'recharge', '2026-10-09')
    assert today['value'] == -7
    assert today['response_ids'] == ['feature-result']
    assert recovery_point(result, '2026-10-09')['value'] == 4
    assert recovery_point(result, '2026-10-09')['response_ids'] == ['feature-result']


def nightly_row(day, recovery=Ellipsis, *, ans=-7, modified=None):
    row = {'sleepResultDate': day, 'ansStatus': ans}
    if recovery is not Ellipsis:
        row['recoveryIndicator'] = recovery
    if modified:
        row['modified'] = modified
    return row


def recovery_point(result, day):
    return next(item for item in result['daily_recovery'] if item['date'] == day)


def test_daily_recovery_preserves_polar_values_and_archive_provenance():
    rows = [archived(f'recovery-{value}', '/nightly-recharge-results', {
        'nightlyRechargeResults': [nightly_row(f'2026-10-{value + 2:02d}', value)],
    }) for value in range(1, 7)]

    result = analytics(Archive(*rows), 7, NOW)

    expected = [
        {'date': f'2026-10-{value + 2:02d}', 'value': value, 'reason': 'available',
         'source_path': '/nightly-recharge-results', 'response_ids': [f'recovery-{value}']}
        for value in range(1, 7)
    ] + [{'date': '2026-10-09', 'value': None, 'reason': 'missing',
          'source_path': '/nightly-recharge-results', 'response_ids': []}]
    assert result['daily_recovery'] == expected


@pytest.mark.parametrize(('raw', 'reason', 'value'), [
    (Ellipsis, 'missing', None),
    (None, 'missing', None),
    (0, 'invalid', None),
    (7, 'invalid', None),
    (True, 'invalid', None),
    (3.0, 'invalid', None),
    ('3', 'invalid', None),
])
def test_daily_recovery_distinguishes_missing_from_invalid(raw, reason, value):
    row = nightly_row('2026-10-09', raw)
    result = analytics(Archive(archived('recovery', '/nightly-recharge-results', {
        'nightlyRechargeResults': [row],
    })), 7, NOW)

    entry = recovery_point(result, '2026-10-09')
    assert entry == {
        'date': '2026-10-09', 'value': value, 'reason': reason,
        'source_path': '/nightly-recharge-results', 'response_ids': ['recovery'],
    }


def test_daily_recovery_uses_zurich_day_and_same_corrected_nightly_row_as_ans():
    archive = Archive(
        archived('old-nightly', '/nightly-recharge-results', {
            'nightlyRechargeResults': [nightly_row(
                '2026-10-08T23:30:00+00:00', 2, modified='2026-10-09T08:00:00+02:00')],
        }, '2026-10-09T07:00:00+00:00'),
        archived('corrected-nightly', '/nightly-recharge-results', {
            'nightlyRechargeResults': [nightly_row(
                '2026-10-09T00:30:00+02:00', 5, ans=-4, modified='2026-10-09T09:00:00+02:00')],
        }, '2026-10-09T08:00:00+00:00'),
    )

    result = analytics(archive, 7, NOW)

    recovery = recovery_point(result, '2026-10-09')
    _, ans = point(result, 'recharge', '2026-10-09')
    assert recovery == {
        'date': '2026-10-09', 'value': 5, 'reason': 'available',
        'source_path': '/nightly-recharge-results', 'response_ids': ['corrected-nightly'],
    }
    assert ans['value'] == -4
    assert ans['response_ids'] == recovery['response_ids']


@pytest.mark.parametrize(('raw', 'reason'), [(None, 'missing'), (0, 'invalid')])
def test_latest_unusable_nightly_correction_clears_previous_measurements(raw, reason):
    archive = Archive(
        archived('valid-nightly', '/nightly-recharge-results', {
            'nightlyRechargeResults': [nightly_row(
                '2026-10-09', 5, modified='2026-10-09T08:00:00+02:00')],
        }, '2026-10-09T06:00:00+00:00'),
        archived('cleared-nightly', '/nightly-recharge-results', {
            'nightlyRechargeResults': [nightly_row(
                '2026-10-09', raw, ans=None, modified='2026-10-09T09:00:00+02:00')],
        }, '2026-10-09T07:00:00+00:00'),
    )

    result = analytics(archive, 7, NOW)

    recovery = recovery_point(result, '2026-10-09')
    _, ans = point(result, 'recharge', '2026-10-09')
    assert recovery == {
        'date': '2026-10-09', 'value': None, 'reason': reason,
        'source_path': '/nightly-recharge-results', 'response_ids': ['cleared-nightly'],
    }
    assert ans['value'] is None
    assert ans['response_ids'] == []


def test_recovery_only_nightly_row_beats_newer_discovery_record():
    rows = [
        archived('recovery-only', '/nightly-recharge-results', {
            'nightlyRechargeResults': [{'sleepResultDate': '2026-10-09', 'recoveryIndicator': 4}],
        }, '2026-10-09T08:00:00+00:00'),
        archived('newer-discovery', '/nightly-recharge-results', {
            'nightlyRechargeResults': [{'sleepResultDate': '2026-10-09', 'modified': '2026-10-09T12:00:00+02:00'}],
        }, '2026-10-09T10:00:00+00:00'),
    ]

    result = analytics(Archive(*rows), 7, NOW)

    recovery = recovery_point(result, '2026-10-09')
    _, ans = point(result, 'recharge', '2026-10-09')
    assert recovery['value'] == 4
    assert recovery['response_ids'] == ['recovery-only']
    assert ans['value'] is None
    assert ans['response_ids'] == []


def test_historical_same_day_heart_snapshot_is_provisional_and_excluded_from_baseline():
    rows = [archived(f'h{day}', '/continuous-samples', {
        'heartRateSamplesPerDay': [hr_row(f'2026-10-{day:02d}', 60 + day)],
    }, '2026-10-09T10:00:00+00:00') for day in range(1, 8)]
    rows.extend([
        archived('partial', '/continuous-samples', {
            'heartRateSamplesPerDay': [hr_row('2026-10-08', 80)],
        }, '2026-10-08T10:00:00+00:00'),
        archived('today', '/continuous-samples', {
            'heartRateSamplesPerDay': [hr_row('2026-10-09', 90)],
        }, '2026-10-09T10:00:00+00:00'),
    ])

    result = analytics(Archive(*rows), 7, NOW)

    _, partial = point(result, 'heart', '2026-10-08')
    assert partial['value'] == 80
    assert partial['provisional'] is True
    assert feedback(result, 'heart', '2026-10-08')['status'] == 'provisional'
    today_feedback = feedback(result, 'heart', '2026-10-09')
    assert today_feedback['status'] == 'provisional'
    assert today_feedback['comparison_days'] == 7


def test_heart_samples_are_deduplicated_by_device_offset():
    archive = Archive(archived('heart', '/continuous-samples', {
        'heartRateSamplesPerDay': [{
            'date': '2026-10-09',
            'deviceRef': {'deviceId': 'loop'},
            'samples': [
                {'heartRate': 60, 'offsetMillis': 0},
                {'heartRate': 80, 'offsetMillis': 0},
                {'heartRate': 70, 'offsetMillis': 1000},
            ],
        }],
    }))

    result = analytics(archive, 7, NOW)
    _, today = point(result, 'heart', '2026-10-09')

    assert today['value'] == 75
    assert today['sample_count'] == 2


def test_activity_uses_latest_whole_device_day_and_deduplicates_overlapping_buckets():
    old = {'activityDays': [{'date': '2026-10-08', 'modified': '2026-10-08T18:00:00+02:00',
        'activitiesPerDevice': [{'deviceReference': {'deviceId': 'loop'}, 'activitySamples': [
            {'stepSamples': {'startTime': '00:00:00', 'interval': 60000, 'steps': [10, 20, 30]}},
        ]}]}]}
    latest = {'activityDays': [
        {'date': '2026-10-08', 'modified': '2026-10-08T20:00:00+02:00',
         'activitiesPerDevice': [{'deviceReference': {'deviceId': 'loop'}, 'activitySamples': [
             {'stepSamples': {'startTime': '00:00:00', 'interval': 60000, 'steps': [10, 20]}},
             {'stepSamples': {'startTime': '00:01:00', 'interval': 60000, 'steps': [20]}},
         ]}]},
        {'date': '2026-10-09', 'activitiesPerDevice': [{'deviceReference': {'deviceId': 'loop'}, 'activitySamples': [
            {'stepSamples': {'startTime': '00:00:00', 'interval': 60000, 'steps': [4]}},
        ]}]},
    ]}
    archive = Archive(
        archived('old-steps', '/activity/list', old, '2026-10-08T20:00:00+00:00'),
        archived('latest-steps', '/activity/list', latest, '2026-10-09T08:00:00+00:00'),
    )

    result = analytics(archive, 7, NOW)
    series, yesterday = point(result, 'activity', '2026-10-08')
    _, today = point(result, 'activity', '2026-10-09')

    assert yesterday['value'] == 30
    assert yesterday['sample_count'] == 2
    assert yesterday['response_ids'] == ['latest-steps']
    assert today['value'] == 4
    assert today['provisional'] is True
    assert today['response_ids'] == ['latest-steps']
    assert series['feedback'][-1]['status'] == 'provisional'


def test_activity_accepts_documented_nested_activitydays_wrapper():
    archive = Archive(archived('wrapped', '/activity/list', {
        'activities': {'activityDays': [{'date': '2026-10-09', 'activitiesPerDevice': [{
            'deviceReference': {'deviceId': 'loop'},
            'activitySamples': [{'stepSamples': {'startTime': '00:00:00', 'interval': 60000, 'steps': [10, 20]}}],
        }]}]},
    }))

    result = analytics(archive, 7, NOW)
    _, today = point(result, 'activity', '2026-10-09')

    assert today['value'] == 30
    assert today['response_ids'] == ['wrapped']


def test_activity_bucket_dedup_uses_elapsed_time_on_fall_back_day():
    values = [0] * 241
    values[240] = 10
    archive = Archive(archived('fall-back', '/activity/list', {
        'activityDays': [{'date': '2026-10-25', 'activitiesPerDevice': [{
            'deviceReference': {'deviceId': 'loop'},
            'activitySamples': [
                {'stepSamples': {'startTime': '00:00:00', 'interval': 60000, 'steps': values}},
                {'stepSamples': {'startTime': '03:00:00', 'interval': 60000, 'steps': [20]}},
            ],
        }]}],
    }, '2026-10-25T10:00:00+00:00'))

    result = analytics(archive, 7, datetime(2026, 10, 25, 12, tzinfo=ZURICH))
    _, target = point(result, 'activity', '2026-10-25')

    assert target['value'] == 20
    assert target['sample_count'] == 241


def test_same_day_partial_historical_activity_and_training_remain_visible_provisional():
    archive = Archive(
        archived('partial', '/activity/list', {'activityDays': [{'date': '2026-10-08', 'activitiesPerDevice': [
            {'deviceReference': {'deviceId': 'loop'}, 'activitySamples': [{'stepSamples': {'startTime': '00:00:00', 'interval': 60000, 'steps': [900]}}]},
        ]}]}, '2026-10-08T10:00:00+00:00'),
        archived('partial-training', '/training-sessions/list', {'trainingSessions': [
            {'identifier': {'id': 'partial'}, 'startTime': '2026-10-08T10:00:00+02:00', 'durationMillis': 900000},
        ]}, '2026-10-08T11:00:00+00:00'),
    )

    result = analytics(archive, 7, NOW)
    _, steps = point(result, 'activity', '2026-10-08')
    _, training = point(result, 'training', '2026-10-08')

    assert steps['value'] == 900
    assert training['value'] == 15
    assert steps['provisional'] is True
    assert training['provisional'] is True
    assert feedback(result, 'activity', '2026-10-08')['status'] == 'provisional'
    assert feedback(result, 'activity', '2026-10-08')['text'] == 'Unvollständiger Tagesstand; ein Vergleich ist nicht möglich.'
    assert feedback(result, 'training', '2026-10-08')['status'] == 'provisional'


def test_complete_next_day_snapshots_supersede_historical_partial_activity_and_training():
    archive = Archive(
        archived('partial-steps', '/activity/list', {'activityDays': [{'date': '2026-10-08', 'modified': '2026-10-08T10:00:00+02:00', 'activitiesPerDevice': [
            {'deviceReference': {'deviceId': 'loop'}, 'activitySamples': [{'stepSamples': {'startTime': '00:00:00', 'interval': 60000, 'steps': [900]}}]},
        ]}]}, '2026-10-08T10:30:00+00:00'),
        archived('complete-steps', '/activity/list', {'activityDays': [{'date': '2026-10-08', 'modified': '2026-10-08T10:00:00+02:00', 'activitiesPerDevice': [
            {'deviceReference': {'deviceId': 'loop'}, 'activitySamples': [{'stepSamples': {'startTime': '00:00:00', 'interval': 60000, 'steps': [10, 20]}}]},
        ]}]}, '2026-10-09T06:00:00+00:00'),
        archived('partial-training', '/training-sessions/list', {'trainingSessions': [
            {'identifier': {'id': 'same'}, 'modified': '2026-10-08T10:00:00+02:00', 'startTime': '2026-10-08T10:00:00+02:00', 'durationMillis': 900000},
        ]}, '2026-10-08T10:30:00+00:00'),
        archived('complete-training', '/training-sessions/list', {'trainingSessions': [
            {'identifier': {'id': 'same'}, 'modified': '2026-10-08T10:00:00+02:00', 'startTime': '2026-10-08T10:00:00+02:00', 'durationMillis': 1200000},
        ]}, '2026-10-09T06:00:00+00:00'),
    )

    result = analytics(archive, 7, NOW)

    _, steps = point(result, 'activity', '2026-10-08')
    _, training = point(result, 'training', '2026-10-08')
    assert steps['value'] == 30
    assert steps['provisional'] is False
    assert steps['response_ids'] == ['complete-steps']
    assert training['value'] == 20
    assert training['provisional'] is False
    assert training['response_ids'] == ['complete-training']


def test_provisional_historical_activity_values_are_excluded_from_baseline():
    rows = []
    for day in range(2, 10):
        date_string = f'2026-10-{day:02d}'
        rows.append(archived(f'steps-{day}', '/activity/list', {
            'activityDays': [{'date': date_string, 'activitiesPerDevice': [{
                'deviceReference': {'deviceId': 'loop'},
                'activitySamples': [{'stepSamples': {'startTime': '00:00:00', 'interval': 60000, 'steps': [day]}}],
            }]}],
        }, f'{date_string}T10:00:00+00:00'))

    result = analytics(Archive(*rows), 7, NOW)
    comparison = feedback(result, 'activity', '2026-10-09')

    assert comparison['status'] == 'provisional'
    assert comparison['comparison_days'] == 0
    assert comparison['baseline'] is None
    assert comparison['text'] == 'Der heutige Wert ist vorläufig; der Tag ist noch nicht abgeschlossen.'


def test_training_sums_unique_sessions_and_keeps_same_time_different_sports():
    sessions = [
        {'identifier': {'id': 'corrected'}, 'created': '2026-10-09T08:00:00+02:00', 'modified': '2026-10-09T10:00:00+02:00', 'startTime': '2026-10-09T09:00:00+02:00', 'durationMillis': 600000, 'sport': {'id': 'RUNNING'}},
        {'identifier': {'id': 'corrected'}, 'created': '2026-10-09T08:00:00+02:00', 'modified': '2026-10-09T11:00:00+02:00', 'startTime': '2026-10-09T09:00:00+02:00', 'durationMillis': 900000, 'sport': {'id': 'RUNNING'}},
        {'created': '2026-10-09T08:00:00+02:00', 'modified': '2026-10-09T10:00:00+02:00', 'startTime': '2026-10-09T10:00:00+02:00', 'durationMillis': 300000, 'sport': {'id': 'RUNNING'}},
        {'created': '2026-10-09T08:00:00+02:00', 'modified': '2026-10-09T11:00:00+02:00', 'startTime': '2026-10-09T10:00:00+02:00', 'durationMillis': 300000, 'sport': {'id': 'RUNNING'}},
        {'created': '2026-10-09T08:00:00+02:00', 'modified': '2026-10-09T10:00:00+02:00', 'startTime': '2026-10-09T10:00:00+02:00', 'durationMillis': 420000, 'sport': {'id': 'CYCLING'}},
        {'identifier': {'id': 'historic'}, 'startTime': '2026-10-08T10:00:00+02:00', 'durationMillis': 1200000, 'sport': {'id': 'RUNNING'}},
    ]
    archive = Archive(archived('sessions', '/training-sessions/list', {
        'trainingSessions': sessions,
    }, '2026-10-09T10:00:00+00:00'))

    result = analytics(archive, 7, NOW)
    series, today = point(result, 'training', '2026-10-09')

    assert today['value'] == 27
    assert today['provisional'] is True
    assert series['unit'] == 'min'
    assert series['kind'] == 'bar'
    assert series['feedback'][-1]['status'] == 'provisional'
    assert point(result, 'training', '2026-10-08')[1]['value'] == 20


def test_metric_fields_use_actual_sleep_duration_and_signed_ans_status():
    archive = Archive(
        archived('sleep', '/sleeps', {'nightSleeps': [{
            'sleepDate': '2026-10-09',
            'sleepEvaluation': {'asleepDuration': '25200s', 'sleepSpan': '28800s'},
        }]}),
        archived('ans', '/nightly-recharge-results', {'nightlyRechargeResults': [{
            'sleepResultDate': '2026-10-09', 'ansStatus': -7.25,
        }]}),
    )

    result = analytics(archive, 7, NOW)

    assert point(result, 'moon', '2026-10-09')[1]['value'] == 420
    assert point(result, 'recharge', '2026-10-09')[1]['value'] == -7.25
    assert feedback(result, 'moon', '2026-10-09')['status'] == 'insufficient'
    assert feedback(result, 'recharge', '2026-10-09')['status'] == 'insufficient'


def test_current_sleep_and_recharge_can_compare_when_seven_complete_days_exist():
    rows = []
    for day in range(2, 9):
        date_string = f'2026-10-{day:02d}'
        rows.append(archived(f'sleep-{day}', '/sleeps', {'nightSleeps': [{
            'sleepDate': date_string,
            'sleepEvaluation': {'asleepDuration': f'{(420 + day - 2) * 60}s'},
        }]}))
        rows.append(archived(f'ans-{day}', '/nightly-recharge-results', {'nightlyRechargeResults': [{
            'sleepResultDate': date_string, 'ansStatus': day - 9,
        }]}))
    rows.extend([
        archived('sleep-today', '/sleeps', {'nightSleeps': [{
            'sleepDate': '2026-10-09', 'sleepEvaluation': {'asleepDuration': '27000s'},
        }]}),
        archived('ans-today', '/nightly-recharge-results', {'nightlyRechargeResults': [{
            'sleepResultDate': '2026-10-09', 'ansStatus': 0,
        }]}),
    ])

    result = analytics(Archive(*rows), 7, NOW)

    sleep_feedback = feedback(result, 'moon', '2026-10-09')
    ans_feedback = feedback(result, 'recharge', '2026-10-09')
    assert sleep_feedback['status'] == 'comparison'
    assert sleep_feedback['baseline'] == 423
    assert sleep_feedback['delta'] == 27
    assert sleep_feedback['text'] == 'Deine Schlafdauer liegt 27 Minuten über deinem bisherigen Median (423 Minuten).'
    assert ans_feedback['status'] == 'comparison'
    assert ans_feedback['baseline'] == -4
    assert ans_feedback['delta'] == 4
    assert ans_feedback['text'] == 'Dein Nightly-Recharge-Wert liegt 4 Punkte über deinem bisherigen Median (-4 ANS).'


def test_missing_days_stay_null_and_malformed_archive_payloads_do_not_crash():
    archive = Archive(
        archived('invalid-json', '/continuous-samples', b'{broken'),
        archived('null-fields', '/activity/list', {'activityDays': [None, {'date': None, 'activitiesPerDevice': None}, {
            'date': '2026-10-09', 'activitiesPerDevice': [{'activitySamples': [
                {'stepSamples': {'startTime': '00:00:00', 'interval': 1000, 'steps': None}},
                {'stepSamples': {'startTime': '00:00:00', 'interval': 1e308, 'steps': [None, 1]}},
            ]}],
        }]}),
        archived('bad-shape', '/training-sessions/list', [None, 'unexpected']),
        archived('bad-number', '/nightly-recharge-results', {'nightlyRechargeResults': [{'sleepResultDate': '2026-10-09', 'ansStatus': float('nan')}]}),
    )

    result = analytics(archive, 7, NOW)

    assert result['from'] == '2026-10-03'
    assert result['to'] == '2026-10-09'
    assert all(len(item['points']) == 7 for item in result['series'])
    assert all(point_value['value'] is None for item in result['series'] for point_value in item['points'])
    assert all(item['coverage'] == {'valid_days': 0, 'total_days': 7} for item in result['series'])
    assert all(point_value['status'] == 'missing' for item in result['series'] for point_value in item['feedback'])


@pytest.mark.parametrize('days', [7, 30, 90])
def test_supported_windows_have_one_point_per_zurich_calendar_day(days):
    result = analytics(Archive(), days, NOW)

    assert result['days'] == days
    assert all(len(item['points']) == days for item in result['series'])
    assert all(item['coverage']['total_days'] == days for item in result['series'])


def test_analytics_limits_archive_reads_to_28_days_before_selected_window():
    archive = Archive()

    analytics(archive, 7, NOW)

    assert archive.requested_since == datetime(2026, 9, 4, 22, tzinfo=timezone.utc)


def test_store_reads_successful_metric_archive_across_runs_without_recovery():
    enable_gridfs_integration()
    store = Store(mongomock.MongoClient(tz_aware=True).polar_analytics_test)
    store.recover = lambda: pytest.fail('analytics archive reads must not recover sync runs')
    store.db.raw_api_responses.insert_many([
        {'run_id': 'old-run', 'path': '/continuous-samples', 'http_status': 200,
         'fetched_at': datetime(2026, 10, 1, tzinfo=timezone.utc), 'body': Binary(b'{"old": true}')},
        {'run_id': 'new-run', 'path': '/continuous-samples', 'http_status': 204,
         'fetched_at': datetime(2026, 10, 9, tzinfo=timezone.utc), 'body': Binary(b'{"new": true}')},
        {'run_id': 'failed-run', 'path': '/continuous-samples', 'http_status': 500,
         'fetched_at': datetime(2026, 10, 10, tzinfo=timezone.utc), 'body': Binary(b'{"failed": true}')},
        {'run_id': 'other-run', 'path': '/sleep-wake-vectors', 'http_status': 200,
         'fetched_at': datetime(2026, 10, 10, tzinfo=timezone.utc), 'body': Binary(b'{"other": true}')},
    ])

    rows = store.analytics_responses(('/continuous-samples',))

    assert len(rows) == 2
    assert [json.loads(body) for _, body in rows.values()] == [{'old': True}, {'new': True}]


def test_store_filters_archive_metadata_before_fetching_bodies():
    enable_gridfs_integration()
    store = Store(mongomock.MongoClient(tz_aware=True).polar_analytics_cutoff_test)
    store.db.raw_api_responses.insert_many([
        {'run_id': 'old-run', 'path': '/continuous-samples', 'http_status': 200,
         'fetched_at': datetime(2026, 9, 30, 23, 59, tzinfo=timezone.utc), 'sha256': 'old', 'body': Binary(b'{"old": true}')},
        {'run_id': 'recent-run', 'path': '/continuous-samples', 'http_status': 200,
         'fetched_at': datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc), 'sha256': 'recent', 'body': Binary(b'{"recent": true}')},
    ])

    rows = store.analytics_responses(
        ('/continuous-samples',), datetime(2026, 10, 1, tzinfo=timezone.utc))

    assert [json.loads(body) for _, body in rows.values()] == [{'recent': True}]


def test_latest_copy_of_duplicate_body_clears_historical_hr_provisional_flag():
    enable_gridfs_integration()
    store = Store(mongomock.MongoClient(tz_aware=True).polar_analytics_duplicate_test)
    raw = json.dumps({'heartRateSamplesPerDay': [hr_row('2026-10-08', 80)]}).encode()
    digest = hashlib.sha256(raw).hexdigest()
    first = store.db.raw_api_responses.insert_one({
        'run_id': 'same-day', 'path': '/continuous-samples', 'http_status': 200,
        'fetched_at': datetime(2026, 10, 8, 10, tzinfo=timezone.utc), 'sha256': digest, 'body': Binary(raw),
    }).inserted_id
    latest = store.db.raw_api_responses.insert_one({
        'run_id': 'next-day', 'path': '/continuous-samples', 'http_status': 200,
        'fetched_at': datetime(2026, 10, 9, 10, tzinfo=timezone.utc), 'sha256': digest, 'body': Binary(raw),
    }).inserted_id

    archived_rows = store.analytics_responses(('/continuous-samples',), datetime(2026, 9, 11, tzinfo=timezone.utc))
    result = analytics(store, 7, NOW)
    _, target = point(result, 'heart', '2026-10-08')

    assert list(archived_rows) == [str(latest)]
    assert str(first) not in archived_rows
    assert target['value'] == 80
    assert target['provisional'] is False
    assert target['response_ids'] == [str(latest)]


def test_store_retains_each_successful_archive_row_without_a_hash():
    enable_gridfs_integration()
    store = Store(mongomock.MongoClient(tz_aware=True).polar_analytics_missing_hash_test)
    store.db.raw_api_responses.insert_many([
        {'run_id': 'one', 'path': '/continuous-samples', 'http_status': 200,
         'fetched_at': datetime(2026, 10, 8, 10, tzinfo=timezone.utc), 'body': Binary(b'{"row": true}')},
        {'run_id': 'two', 'path': '/continuous-samples', 'http_status': 200,
         'fetched_at': datetime(2026, 10, 9, 10, tzinfo=timezone.utc), 'body': Binary(b'{"row": true}')},
    ])

    rows = store.analytics_responses(('/continuous-samples',))

    assert len(rows) == 2


def test_store_initializes_archive_path_status_fetch_time_index():
    enable_gridfs_integration()
    store = Store(mongomock.MongoClient(tz_aware=True).polar_analytics_index_test)

    store.initialize()

    indexes = store.db.raw_api_responses.index_information()
    assert indexes['path_1_http_status_1_fetched_at_1']['key'] == [
        ('path', 1), ('http_status', 1), ('fetched_at', 1),
    ]
