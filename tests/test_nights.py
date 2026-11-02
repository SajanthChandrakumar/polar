import json
from datetime import datetime
from zoneinfo import ZoneInfo

from test_api import build_client, login
from polar_api.nights import nights

ZURICH = ZoneInfo('Europe/Zurich')
NOW = datetime(2026, 10, 26, 12, tzinfo=ZURICH)


class Archive:
    def __init__(self, *rows):
        self.rows = rows
        self.requested_since = None
        self.requested_paths = None

    def analytics_responses(self, paths, since=None):
        self.requested_since = since
        self.requested_paths = tuple(paths)
        wanted = set(paths)
        return {
            key: (document, body if isinstance(body, bytes) else json.dumps(body).encode())
            for key, document, body in self.rows
            if document['path'] in wanted and document['http_status'] == 200
            and (since is None or document['fetched_at'] >= since)
        }


def archived(key, path, body, fetched='2026-10-26T10:00:00+01:00'):
    return key, {
        'path': path,
        'http_status': 200,
        'fetched_at': datetime.fromisoformat(fetched),
        'params': {},
    }, body


def test_route_requires_auth_and_does_not_write():
    client, store = build_client()
    assert client.get('/api/nights').status_code == 401
    assert login(client).status_code == 200
    before = {
        name: store.db[name].count_documents({})
        for name in store.db.list_collection_names()
    }

    response = client.get('/api/nights')

    assert response.status_code == 200
    assert response.json() == {'nights': []}
    assert {
        name: store.db[name].count_documents({})
        for name in store.db.list_collection_names()
    } == before


def test_nights_use_corrected_sleep_data_and_align_adjacent_samples_across_dst():
    archive = Archive(
        archived('future-fetch', '/sleeps', {'nightSleeps': [{
            'sleepDate': '2026-10-26', 'sleepEvaluation': {'asleepDuration': '3600s'},
        }]}, fetched='2026-10-27T10:00:00+01:00'),
        archived('sleep-old', '/sleeps', {'nightSleeps': [{
            'sleepDate': '2026-10-25',
            'modified': '2026-10-25T09:00:00+01:00',
            'sleepEvaluation': {'asleepDuration': '18000s'},
            'sleepResult': {
                'hypnogram': {
                    'sleepStart': '2026-10-24T23:30:00+02:00',
                    'sleepEnd': '2026-10-25T03:30:00+01:00',
                    'sleepStateChanges': [{'offsetFromStart': '0s', 'newState': 'SLEEP_STATE_WAKE'}],
                },
            },
            'sleepScore': {'sleepScore': 70},
        }]}),
        archived('sleep-fixed', '/sleeps', {'nightSleeps': [{
            'sleepDate': '2026-10-25',
            'modified': '2026-10-25T10:00:00+01:00',
            'sleepEvaluation': {'asleepDuration': '14400s'},
            'sleepResult': {
                'hypnogram': {
                    'sleepStart': '2026-10-24T23:30:00+02:00',
                    'sleepEnd': '2026-10-25T03:30:00+01:00',
                    'sleepStateChanges': [
                        {'offsetFromStart': '0s', 'newState': 'SLEEP_STATE_NON_REM2'},
                        {'offsetFromStart': '3600s', 'newState': 'SLEEP_STATE_REM'},
                        {'offsetFromStart': '14400s', 'newState': 'SLEEP_STATE_NON_REM3'},
                        {'offsetFromStart': '16200s', 'newState': 'SLEEP_STATE_WAKE'},
                    ],
                },
            },
            'sleepScore': {'sleepScore': 86.5},
        }]}),
        archived('steps', '/activity/list', {'activityDays': [{
            'date': '2026-10-24',
            'activitiesPerDevice': [{
                'deviceReference': {'deviceId': 'loop'},
                'activitySamples': [{'stepSamples': {
                    'startTime': '00:00:00', 'interval': 60000, 'steps': [10, 20],
                }}],
            }],
        }]}),
        archived('recharge', '/nightly-recharge-results', {'nightlyRechargeResults': [{
            'sleepResultDate': '2026-10-25',
            'ansStatus': -7.25,
            'meanNightlyRecoveryRmssd': 42,
        }]}),
        archived('pulse-before', '/continuous-samples', {'heartRateSamplesPerDay': [{
            'date': '2026-10-24', 'deviceRef': {'deviceId': 'loop'},
            'samples': [
                {'heartRate': 50, 'offsetMillis': 84600000},
                {'heartRate': 70, 'offsetMillis': 84720000},
                {'heartRate': 90, 'offsetMillis': 84720000},
            ],
        }]}),
        archived('pulse-after', '/continuous-samples', {'heartRateSamplesPerDay': [{
            'date': '2026-10-25', 'deviceRef': {'deviceId': 'loop'},
            'samples': [
                {'heartRate': 60, 'offsetMillis': 9000000},
                {'heartRate': 80, 'offsetMillis': 12600000},
                {'heartRate': 0, 'offsetMillis': 15000000},
                {'heartRate': 90},
            ],
        }]}),
    )

    result = nights(archive, NOW)
    night = result['nights'][0]

    assert result.keys() == {'nights'}
    assert archive.requested_since == datetime(2026, 7, 27, 22, tzinfo=ZoneInfo('UTC'))
    assert '/training-sessions/list' not in archive.requested_paths
    assert night['date'] == '2026-10-25'
    assert (night['start'], night['end']) == (
        '2026-10-24T23:30:00+02:00', '2026-10-25T03:30:00+01:00',
    )
    assert (
        night['sleep_minutes'], night['sleep_score'], night['steps_previous_day'],
        night['ans'], night['hrv_ms'],
    ) == (240, 86.5, 30, -7.25, 42)
    assert night['phases'] == [
        {'start': '2026-10-24T23:30:00+02:00', 'end': '2026-10-25T00:30:00+02:00', 'stage': 'light'},
        {'start': '2026-10-25T00:30:00+02:00', 'end': '2026-10-25T02:30:00+01:00', 'stage': 'rem'},
        {'start': '2026-10-25T02:30:00+01:00', 'end': '2026-10-25T03:00:00+01:00', 'stage': 'deep'},
        {'start': '2026-10-25T03:00:00+01:00', 'end': '2026-10-25T03:30:00+01:00', 'stage': 'awake'},
    ]
    assert night['pulse'] == [
        {'time': '2026-10-24T23:30:00+02:00', 'bpm': 70},
        {'time': '2026-10-25T02:30:00+02:00', 'bpm': 60},
        {'time': '2026-10-25T02:30:00+01:00', 'bpm': 80},
    ]


def test_missing_and_sentinel_values_stay_null_and_unknown_phase_gaps_are_explicit():
    archive = Archive(
        archived('sleep', '/sleeps', {'nightSleeps': [
            {
                'sleepDate': '2026-10-25',
                'sleepEvaluation': {'asleepDuration': '0s'},
                'sleepResult': {
                    'hypnogram': {
                        'sleepStart': '2026-10-25T01:00:00+02:00',
                        'sleepEnd': '2026-10-25T04:00:00+01:00',
                        'sleepStateChanges': [
                            {'offsetFromStart': '60s', 'newState': 'SLEEP_STATE_NON_REM1'},
                            {'offsetFromStart': 'invalid', 'newState': 'SLEEP_STATE_REM'},
                            {'offsetFromStart': '600s', 'newState': {'future': True}},
                        ],
                    },
                },
                'sleepScore': {'sleepScore': 0},
            },
            {
                'sleepDate': '2026-10-24',
                'sleepEvaluation': {'asleepDuration': 'broken'},
                'sleepResult': {'hypnogram': {'sleepStart': 'bad', 'sleepEnd': None}},
                'sleepScore': {'sleepScore': 0.5},
            },
            {'sleepDate': '2026-07-28', 'sleepEvaluation': {'asleepDuration': '10000s'}},
            {'sleepDate': 'bad-date'},
        ]}),
        archived('recharge', '/nightly-recharge-results', {'nightlyRechargeResults': [{
            'sleepResultDate': '2026-10-25', 'ansStatus': float('nan'), 'meanNightlyRecoveryRmssd': 0,
        }]}),
        archived('pulse', '/continuous-samples', {'heartRateSamplesPerDay': [{
            'date': '2026-10-25', 'deviceRef': {'deviceId': 'loop'},
            'samples': [
                {'heartRate': 70, 'offsetMillis': 7200000},
                {'heartRate': -1, 'offsetMillis': 7260000},
                {'heartRate': 80},
            ],
        }]}),
    )

    result = nights(archive, NOW)
    by_date = {item['date']: item for item in result['nights']}
    night = by_date['2026-10-25']

    assert list(by_date) == ['2026-10-25', '2026-10-24']
    assert '2026-07-28' not in by_date
    assert night['sleep_minutes'] == 0
    assert night['sleep_score'] is None
    assert night['ans'] is None
    assert night['hrv_ms'] is None
    assert night['phases'] == [
        {'start': '2026-10-25T01:00:00+02:00', 'end': '2026-10-25T01:01:00+02:00', 'stage': 'unknown'},
        {'start': '2026-10-25T01:01:00+02:00', 'end': '2026-10-25T01:10:00+02:00', 'stage': 'light'},
        {'start': '2026-10-25T01:10:00+02:00', 'end': '2026-10-25T04:00:00+01:00', 'stage': 'unknown'},
    ]
    assert night['pulse'] == [{'time': '2026-10-25T02:00:00+02:00', 'bpm': 70}]
    assert by_date['2026-10-24']['sleep_minutes'] is None
    assert by_date['2026-10-24']['sleep_score'] is None
    assert by_date['2026-10-24']['start'] is None
    assert by_date['2026-10-24']['end'] is None
    assert by_date['2026-10-24']['phases'] == []


def test_provisional_previous_day_steps_are_not_published_as_final():
    archive = Archive(
        archived('sleep', '/sleeps', {'nightSleeps': [{
            'sleepDate': '2026-10-25',
            'sleepEvaluation': {'asleepDuration': '3600s'},
        }]}),
        archived('steps', '/activity/list', {'activityDays': [{
            'date': '2026-10-24',
            'activitiesPerDevice': [{
                'deviceReference': {'deviceId': 'loop'},
                'activitySamples': [{'stepSamples': {
                    'startTime': '00:00:00', 'interval': 60000, 'steps': [22],
                }}],
            }],
        }]}, fetched='2026-10-24T18:00:00+02:00'),
    )

    night = nights(archive, NOW)['nights'][0]

    assert night['steps_previous_day'] is None
