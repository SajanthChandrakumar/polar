import json
from pathlib import Path
from runpy import run_path

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / 'scripts' / 'generate_pattern_demo.py'
FIXTURE = ROOT / 'apps' / 'web' / 'src' / 'pattern-demo.json'


def load_generator():
    assert GENERATOR.is_file(), 'the deterministic synthetic demo generator must exist'
    return run_path(str(GENERATOR))


def test_demo_fixtures_are_deterministic_fixed_date_and_clear_provenance():
    generator = load_generator()
    first = generator['generate_fixtures']()
    assert first == generator['generate_fixtures']()
    assert list(first) == ['30_sleep', '30_ans', '90_sleep', '90_ans']
    assert all(result['timezone'] == 'Europe/Zurich' for result in first.values())
    assert all(result['to'] == '2026-09-30' for result in first.values())
    assert all(result['from'] == ('2026-09-01' if key.startswith('30_') else '2026-07-03')
               for key, result in first.items())
    assert any(pair['steps'] == 0 for result in first.values() for pair in result['pairs'])
    assert all(result['exclusions']['activity_unavailable'] > 0
               and result['exclusions']['activity_provisional'] > 0
               and result['exclusions']['outcome_unavailable'] > 0
               for result in first.values())
    assert all(pair['activity_response_ids'] == pair['outcome_response_ids'] == []
               for result in first.values() for pair in result['pairs'])


def test_bundled_fixtures_match_the_backend_pure_calculation_for_all_controls():
    generator = load_generator()
    assert FIXTURE.is_file(), 'the generated browser fixture must be checked in'
    bundled = json.loads(FIXTURE.read_text(encoding='utf-8'))
    activity, outcomes = generator['synthetic_points']()
    calculate = generator['calculate_patterns']
    clear_provenance = generator['clear_provenance']

    for key, days, outcome in (
        ('30_sleep', 30, 'sleep'), ('30_ans', 30, 'ans'),
        ('90_sleep', 90, 'sleep'), ('90_ans', 90, 'ans'),
    ):
        expected = calculate(activity, outcomes[outcome], days=days, outcome=outcome, now=generator['FIXED_NOW'])
        clear_provenance(expected)
        assert bundled[key] == expected
