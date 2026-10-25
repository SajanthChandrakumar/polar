from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from polar_api.patterns import calculate_patterns, patterns

ZURICH = ZoneInfo('Europe/Zurich')
NOW = datetime(2026, 10, 30, 12, tzinfo=ZURICH)


def point(day, value, *, provisional=False, response_ids=None):
    return {
        'date': day,
        'value': value,
        'provisional': provisional,
        'response_ids': response_ids or [],
    }


def test_pairs_join_preceding_calendar_day_across_zurich_dst_and_threshold_ignores_outcomes():
    activity = [
        point('2026-02-27', 100, response_ids=['first-activity']),
        point('2026-03-01', 200),
        point('2026-03-27', 300),
        point('2026-03-28', 400, response_ids=['dst-activity']),
    ]
    outcomes = [
        point('2026-02-28', 360, response_ids=['first-sleep']),
        point('2026-03-29', 420, response_ids=['dst-sleep']),
    ]

    result = calculate_patterns(
        activity, outcomes, days=30, outcome='sleep',
        now=datetime(2026, 3, 28, 23, 30, tzinfo=ZoneInfo('UTC')),
    )

    assert (result['from'], result['to'], result['timezone']) == ('2026-02-28', '2026-03-29', 'Europe/Zurich')
    assert (result['activity_from'], result['activity_to']) == ('2026-02-27', '2026-03-28')
    assert result['threshold'] == 250
    assert result['pairs'] == [
        {'activity_date': '2026-02-27', 'outcome_date': '2026-02-28', 'steps': 100,
         'value': 360, 'group': 'lower', 'activity_response_ids': ['first-activity'],
         'outcome_response_ids': ['first-sleep']},
        {'activity_date': '2026-03-28', 'outcome_date': '2026-03-29', 'steps': 400,
         'value': 420, 'group': 'upper', 'activity_response_ids': ['dst-activity'],
         'outcome_response_ids': ['dst-sleep']},
    ]
    assert result['groups']['lower']['count'] == result['groups']['upper']['count'] == 1
    assert result['groups']['lower']['median'] is None


def test_zero_steps_and_equal_threshold_are_valid_and_in_upper_group():
    activity = [point('2026-09-30', 0), point('2026-10-01', 0)]
    outcomes = [point('2026-10-01', 0), point('2026-10-02', 60)]

    result = calculate_patterns(activity, outcomes, days=30, outcome='sleep', now=NOW)

    assert result['threshold'] == 0
    assert [pair['group'] for pair in result['pairs']] == ['upper', 'upper']
    assert [pair['value'] for pair in result['pairs']] == [0, 60]
    assert result['exclusions']['activity_unavailable'] == 28


def test_bool_nonfinite_and_negative_steps_are_unavailable():
    activity = [
        point('2026-09-30', 0), point('2026-10-01', True),
        point('2026-10-02', float('nan')), point('2026-10-03', float('inf')),
        point('2026-10-04', -1),
    ]
    outcomes = [point(f'2026-10-{day:02d}', 60) for day in range(1, 6)]

    result = calculate_patterns(activity, outcomes, days=30, outcome='sleep', now=NOW)

    assert result['threshold'] == 0
    assert len(result['pairs']) == 1
    assert result['pairs'][0]['steps'] == 0
    assert result['exclusions']['activity_unavailable'] == 29


def test_bool_nonfinite_and_negative_sleep_values_are_unavailable():
    activity = [point('2026-09-30', 10)] + [point(f'2026-10-{day:02d}', 10) for day in range(1, 5)]
    outcomes = [
        point('2026-10-01', 0), point('2026-10-02', True),
        point('2026-10-03', float('nan')), point('2026-10-04', float('inf')),
        point('2026-10-05', -1),
    ]

    result = calculate_patterns(activity, outcomes, days=30, outcome='sleep', now=NOW)

    assert [pair['value'] for pair in result['pairs']] == [0]
    assert result['exclusions']['outcome_unavailable'] == 4


def test_negative_ans_is_valid():
    activity = [point('2026-09-30', 0), point('2026-10-01', 10)]
    outcomes = [point('2026-10-01', -12), point('2026-10-02', -4)]

    result = calculate_patterns(activity, outcomes, days=30, outcome='ans', now=NOW)

    assert result['unit'] == 'ANS'
    assert [pair['value'] for pair in result['pairs']] == [-12, -4]


def test_exclusions_are_disjoint_and_follow_activity_priority():
    activity = [
        point('2026-10-01', 20, provisional=True),
        point('2026-10-02', 30),
        point('2026-10-03', 40),
    ]
    outcomes = [point('2026-10-01', 60), point('2026-10-04', 60)]

    result = calculate_patterns(activity, outcomes, days=30, outcome='sleep', now=NOW)

    assert result['exclusions'] == {
        'activity_unavailable': 27,
        'activity_provisional': 1,
        'outcome_unavailable': 1,
    }
    assert result['pairs'] == [
        {'activity_date': '2026-10-03', 'outcome_date': '2026-10-04', 'steps': 40,
         'value': 60, 'group': 'upper', 'activity_response_ids': [], 'outcome_response_ids': []},
    ]


def test_six_in_either_group_suppresses_all_group_summaries():
    activity = [point((datetime(2026, 8, 31) + timedelta(days=index)).date().isoformat(), index + 1)
                for index in range(13)]
    outcomes = [point(f'2026-09-{day:02d}', 60) for day in range(1, 14)]

    result = calculate_patterns(activity, outcomes, days=30, outcome='sleep', now=datetime(2026, 9, 30, 12, tzinfo=ZURICH))

    assert result['groups']['lower']['count'] == 6
    assert result['groups']['upper']['count'] == 7
    assert result['status'] == 'insufficient'
    assert all(result['groups'][name][key] is None for name in ('lower', 'upper') for key in ('median', 'q1', 'q3'))


def test_seven_per_group_exposes_inclusive_quartiles():
    activity = [point((datetime(2026, 8, 31) + timedelta(days=index)).date().isoformat(), index + 1)
                for index in range(14)]
    outcomes = [point(f'2026-09-{day:02d}', day * 10) for day in range(1, 15)]

    result = calculate_patterns(activity, outcomes, days=30, outcome='sleep', now=datetime(2026, 9, 30, 12, tzinfo=ZURICH))

    assert result['status'] == 'available'
    assert result['threshold'] == 7.5
    assert result['groups']['lower'] == {'count': 7, 'median': 40, 'q1': 25, 'q3': 55}
    assert result['groups']['upper'] == {'count': 7, 'median': 110, 'q1': 95, 'q3': 125}


class Archive:
    def __init__(self, *rows):
        self.rows = {row[0]: (row[1], row[2]) for row in rows}

    def analytics_responses(self, paths, since=None):
        wanted = set(paths)
        return {
            key: value for key, value in self.rows.items()
            if value[0].get('path') in wanted
            and 200 <= value[0].get('http_status', 0) < 300
            and (since is None or value[0].get('fetched_at') >= since)
        }


def archived(response_id, path, payload, fetched_at):
    import json

    return response_id, {
        'path': path, 'http_status': 200,
        'fetched_at': datetime.fromisoformat(fetched_at), 'params': {},
    }, json.dumps(payload).encode()


def activity(day, steps, modified):
    return {
        'date': day, 'modified': modified,
        'activitiesPerDevice': [{
            'deviceReference': {'deviceId': 'loop'},
            'activitySamples': [{'stepSamples': {'interval': 60000, 'startTime': '08:00:00', 'steps': [steps]}}],
        }],
    }


def test_store_wrapper_uses_corrected_daily_values_and_their_response_ids():
    archive = Archive(
        archived('activity-old', '/activity/list', {'activityDays': [activity('2026-10-08', 100, '2026-10-08T10:00:00+02:00')]}, '2026-10-09T08:00:00+00:00'),
        archived('activity-corrected', '/activity/list', {'activityDays': [activity('2026-10-08', 250, '2026-10-08T11:00:00+02:00')]}, '2026-10-09T09:00:00+00:00'),
        archived('sleep', '/sleeps', {'nightSleeps': [{'sleepDate': '2026-10-09', 'sleepEvaluation': {'asleepDuration': '28800s'}}]}, '2026-10-09T10:00:00+00:00'),
    )

    result = patterns(archive, days=30, outcome='sleep', now=NOW)

    pair = next(item for item in result['pairs'] if item['outcome_date'] == '2026-10-09')
    assert pair == {
        'activity_date': '2026-10-08', 'outcome_date': '2026-10-09', 'steps': 250,
        'value': 480, 'group': 'upper', 'activity_response_ids': ['activity-corrected'],
        'outcome_response_ids': ['sleep'],
    }
