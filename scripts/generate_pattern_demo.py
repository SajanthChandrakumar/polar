#!/usr/bin/env python3
"""Build the public Recovery Lab's fixed synthetic fixtures."""
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps' / 'api'))
from polar_api.patterns import calculate_patterns  # noqa: E402

FIXED_NOW = datetime(2026, 9, 30, 12, tzinfo=ZoneInfo('Europe/Zurich'))
ACTIVITY_START = date(2026, 7, 2)
MISSING_ACTIVITY = {10, 43, 80}
PROVISIONAL_ACTIVITY = {7, 38, 76}
ZERO_ACTIVITY = {0, 67}
MISSING_SLEEP = {16, 56, 84}
MISSING_ANS = {22, 61, 88}


def synthetic_points():
    """Return deterministic, clearly synthetic points over the shifted 90-day window."""
    activity, sleep, ans = [], [], []
    for index in range(90):
        activity_day = ACTIVITY_START + timedelta(days=index)
        outcome_day = activity_day + timedelta(days=1)
        if index not in MISSING_ACTIVITY:
            steps = 0 if index in ZERO_ACTIVITY else 2800 + (index * 1379) % 9000
            activity.append({
                'date': activity_day.isoformat(),
                'value': steps,
                'provisional': index in PROVISIONAL_ACTIVITY,
                'response_ids': [f'synthetic-activity-{activity_day.isoformat()}'],
            })
        if index not in MISSING_SLEEP:
            sleep.append({
                'date': outcome_day.isoformat(),
                'value': 360 + (index * 23) % 120,
                'provisional': False,
                'response_ids': [f'synthetic-sleep-{outcome_day.isoformat()}'],
            })
        if index not in MISSING_ANS:
            ans.append({
                'date': outcome_day.isoformat(),
                'value': round(-3.5 + (index * 17) % 65 / 10, 1),
                'provisional': False,
                'response_ids': [f'synthetic-ans-{outcome_day.isoformat()}'],
            })
    return activity, {'sleep': sleep, 'ans': ans}


def clear_provenance(result):
    """Remove generator-only source references before anything is bundled."""
    for pair in result['pairs']:
        pair['activity_response_ids'] = []
        pair['outcome_response_ids'] = []
    return result


def generate_fixtures():
    activity, outcomes = synthetic_points()
    return {
        f'{days}_{outcome}': clear_provenance(calculate_patterns(
            activity, outcomes[outcome], days=days, outcome=outcome, now=FIXED_NOW
        ))
        for days in (30, 90)
        for outcome in ('sleep', 'ans')
    }


def main():
    path = ROOT / 'apps' / 'web' / 'src' / 'pattern-demo.json'
    path.write_text(json.dumps(generate_fixtures(), indent=2, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')
    print(f'Generated {path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
