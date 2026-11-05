import patterns from './pattern-demo.json';
import nights from './night-demo.json';
import type { AnalyticsData, AnalyticsPoint, AnalyticsSeries } from './Analytics';
import type { PatternAnalysis } from './patterns';
import type { Night } from './NightExplorer';

type FixtureKey = '30_sleep' | '30_ans' | '90_sleep' | '90_ans';
const fixtures = patterns as Record<FixtureKey, PatternAnalysis>;
const demoNights = nights as Night[];

function series(key: string, label: string, unit: string, kind: 'line' | 'bar', source_path: string, pointsByDate: Map<string, number>, from: string, to: string, days: number): AnalyticsSeries {
  const points: AnalyticsPoint[] = [...pointsByDate]
    .filter(([date, value]) => date >= from && date <= to && Number.isFinite(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, value, provisional: false, response_ids: [] }));
  return { key, label, unit, kind, source_path, points, coverage: { valid_days: points.length, total_days: days }, feedback: [] };
}

export function bundledAnalytics(days: number): AnalyticsData {
  const source = fixtures['90_sleep'];
  const end = new Date(`${source.to}T00:00:00Z`);
  const fromDate = new Date(end);
  fromDate.setUTCDate(end.getUTCDate() - days + 1);
  const from = fromDate.toISOString().slice(0, 10);
  const to = source.to;
  const sleep = new Map(source.pairs.map(pair => [pair.outcome_date, pair.value]));
  const steps = new Map(source.pairs.map(pair => [pair.activity_date, pair.steps]));
  const ans = new Map(fixtures['90_ans'].pairs.map(pair => [pair.outcome_date, pair.value]));

  for (const night of demoNights) {
    if (night.sleep_minutes !== null) sleep.set(night.date, night.sleep_minutes);
    const activityDate = new Date(`${night.date}T00:00:00Z`);
    activityDate.setUTCDate(activityDate.getUTCDate() - 1);
    if (night.steps_previous_day !== null) steps.set(activityDate.toISOString().slice(0, 10), night.steps_previous_day);
  }

  return {
    days,
    from,
    to,
    timezone: source.timezone,
    series: [
      series('moon', 'Schlafdauer', 'min', 'line', '/sleeps', sleep, from, to, days),
      series('recharge', 'ANS-Status', 'ANS', 'line', '/nightly-recharge-results', ans, from, to, days),
      series('activity', 'Schritte', 'Schritte', 'bar', '/activity/list', steps, from, to, days),
    ],
  };
}
