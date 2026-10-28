import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PatternExplorer from './PatternExplorer';
import type { PatternAnalysis } from './patterns';

const data: PatternAnalysis = {
  days: 30,
  outcome: 'sleep',
  from: '2026-09-10',
  to: '2026-10-09',
  activity_from: '2026-09-09',
  activity_to: '2026-10-08',
  timezone: 'Europe/Zurich',
  unit: 'min',
  threshold: 7000,
  status: 'available',
  minimum_group_size: 7,
  groups: {
    lower: { count: 8, median: 420, q1: 390, q3: 450 },
    upper: { count: 9, median: 460, q1: 430, q3: 490 },
  },
  pairs: [
    { activity_date: '2026-10-01', outcome_date: '2026-10-02', steps: 6200, value: 390, group: 'lower', activity_response_ids: ['activity-1'], outcome_response_ids: ['sleep-1'] },
    { activity_date: '2026-10-03', outcome_date: '2026-10-04', steps: 8100, value: 460, group: 'upper', activity_response_ids: ['activity-2'], outcome_response_ids: ['sleep-2'] },
  ],
  exclusions: { activity_unavailable: 2, activity_provisional: 1, outcome_unavailable: 3 },
};

function renderExplorer(overrides: Partial<React.ComponentProps<typeof PatternExplorer>> = {}) {
  const onDaysChange = vi.fn(), onOutcomeChange = vi.fn();
  const view = render(<PatternExplorer data={data} days={90} outcome="sleep" onDaysChange={onDaysChange} onOutcomeChange={onOutcomeChange} demo={false} {...overrides} />);
  return { ...view, onDaysChange, onOutcomeChange };
}

describe('PatternExplorer', () => {
  it('shows the observed group summaries and only summarizes the difference when both groups are large enough', () => {
    renderExplorer();
    const lower = screen.getByRole('article', { name: 'Weniger Bewegung' });
    const upper = screen.getByRole('article', { name: 'Mehr Bewegung' });
    expect(within(lower).getByText('8 Nächte')).toBeVisible();
    expect(within(lower).getByText('7 h')).toBeVisible();
    expect(within(lower).getByText(/Q1 6\.5 h.*Q3 7\.5 h/)).toBeVisible();
    expect(within(upper).getByText('9 Nächte')).toBeVisible();
    expect(within(upper).getByText('7.7 h')).toBeVisible();
    expect(screen.getByText('+0.7 h')).toBeVisible();
    expect(screen.getByText('Schlafdauer (h)')).toBeVisible();
    expect(screen.getByText('7.1')).toBeVisible();
    expect(screen.getByText(/Beobachteter Medianunterschied/)).toBeVisible();
  });

  it.each([[-30, '-0.5 h'], [-15, '-0.3 h'], [15, '+0.3 h'], [-3, '-0.1 h'], [3, '+0.1 h'], [-1, '0 h'], [0, '0 h']])('formats a sleep difference of %s minutes in hours', (difference, expected) => {
    renderExplorer({ data: { ...data, groups: { ...data.groups, upper: { ...data.groups.upper, median: 420 + difference } } } });
    expect(within(screen.getByText(/Beobachteter Medianunterschied/)).getByText(expected)).toBeVisible();
  });

  it('lets people change the time range and outcome through the shared controls', () => {
    const { onDaysChange, onOutcomeChange } = renderExplorer();
    fireEvent.change(screen.getByRole('combobox', { name: 'Zeitraum' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Ergebnis' }), { target: { value: 'ans' } });
    expect(onDaysChange).toHaveBeenCalledWith(30);
    expect(onOutcomeChange).toHaveBeenCalledWith('ans');
  });

  it('keeps points and group counts visible while suppressing summaries for insufficient groups', () => {
    const insufficient: PatternAnalysis = {
      ...data,
      status: 'insufficient',
      groups: { lower: { count: 6, median: null, q1: null, q3: null }, upper: { count: 8, median: null, q1: null, q3: null } },
      pairs: [{ ...data.pairs[0], value: -0.4 }],
      outcome: 'ans',
      unit: 'ANS',
    };
    renderExplorer({ data: insufficient, outcome: 'ans' });
    expect(screen.getByText('6 Nächte')).toBeVisible();
    expect(screen.getByText('Mindestens 7 gültige Nächte pro Gruppe sind nötig, bevor ein Unterschied beschrieben wird. Punkte und Gruppengrößen bleiben sichtbar.')).toBeVisible();
    expect(screen.queryByText(/Medianunterschied/)).not.toBeInTheDocument();
    const chart = screen.getByRole('region', { name: 'Bewegung und nächste Nacht' });
    expect(within(chart).getByRole('button', { name: /-0\.4 ANS/ })).toBeVisible();
  });

  it('shows numeric labels along the step axis', () => {
    renderExplorer();
    const chart = screen.getByRole('region', { name: 'Bewegung und nächste Nacht' });
    const scale = within(chart).getByRole('group', { name: 'Schritte-Skala' });
    expect(within(scale).getByText(/7.?000/)).toBeVisible();
    expect(within(scale).getByText(/8.?000/)).toBeVisible();
  });

  it('exposes point controls inside an accessible graph group', () => {
    renderExplorer();
    const graph = screen.getByRole('group', { name: 'Auswählbares Punktdiagramm' });
    expect(within(graph).getAllByRole('button')).toHaveLength(2);
  });

  it('selects points with pointer, touch, and keyboard and opens only available source records', () => {
    const onInspect = vi.fn();
    renderExplorer({ onInspect });
    const chart = screen.getByRole('region', { name: 'Bewegung und nächste Nacht' });
    const firstPoint = within(chart).getByRole('button', { name: /02\.10\.2026.*6.?200 Schritte.*6\.5 h/ });
    fireEvent.keyDown(firstPoint, { key: 'Enter' });
    expect(screen.getByRole('heading', { name: 'Ausgewählter Punkt' })).toBeVisible();
    expect(screen.getByText('01.10.2026')).toBeVisible();
    expect(screen.getByText('02.10.2026')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Aktivitätsquelle ansehen' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Aktivitätsquelle ansehen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ergebnisquelle ansehen' }));
    expect(onInspect).toHaveBeenNthCalledWith(1, '/activity/list', ['activity-1']);
    expect(onInspect).toHaveBeenNthCalledWith(2, '/sleeps', ['sleep-1']);

    const secondPoint = within(chart).getByRole('button', { name: /04\.10\.2026.*8.?100 Schritte.*7\.7 h/ });
    fireEvent.pointerUp(secondPoint, { pointerType: 'touch' });
    const selected = screen.getByRole('article', { name: 'Ausgewählter Punkt' });
    expect(within(selected).getByText('03.10.2026')).toBeVisible();
    expect(within(selected).getByText('7.7 h')).toBeVisible();
    expect(onInspect).toHaveBeenCalledTimes(2);
  });

  it('shows synthetic labeling without exposing private source actions and tolerates a missing threshold', () => {
    const synthetic = { ...data, threshold: null, pairs: [{ ...data.pairs[0], activity_response_ids: [], outcome_response_ids: [] }] };
    renderExplorer({ data: synthetic, demo: true, onInspect: vi.fn() });
    expect(screen.getByText(/Beispielanalyse · synthetische Daten/)).toBeVisible();
    expect(screen.queryByText(/Schritte-Grenze/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /02\.10\.2026.*6\.5 h/ }));
    expect(screen.queryByRole('button', { name: 'Aktivitätsquelle ansehen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ergebnisquelle ansehen' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('So ist der Vergleich zu lesen'));
    expect(screen.getByText(/Für diesen Zeitraum ist keine Schritt-Grenze verfügbar; es wird keine Grenzlinie eingezeichnet/)).toBeVisible();
  });
});
