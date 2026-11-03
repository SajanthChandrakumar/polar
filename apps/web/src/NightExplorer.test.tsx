import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import NightExplorer, { type Night } from './NightExplorer';

const nights: Night[] = [
  {
    date: '2026-10-02', start: '2026-10-01T23:00:00+02:00', end: '2026-10-02T07:00:00+02:00', sleep_minutes: 480,
    sleep_score: 84, steps_previous_day: 8452, ans: 1.2, hrv_ms: 56,
    phases: [
      { start: '2026-10-01T23:00:00+02:00', end: '2026-10-02T00:00:00+02:00', stage: 'light' },
      { start: '2026-10-02T00:30:00+02:00', end: '2026-10-02T02:00:00+02:00', stage: 'deep' },
      { start: '2026-10-02T02:00:00+02:00', end: '2026-10-02T03:00:00+02:00', stage: 'rem' },
    ], pulse: [],
  },
  {
    date: '2026-10-01', start: '2026-09-30T22:45:00+02:00', end: '2026-10-01T06:45:00+02:00', sleep_minutes: 450,
    sleep_score: null, steps_previous_day: 6120, ans: null, hrv_ms: null,
    phases: [], pulse: [
      { time: '2026-09-30T23:00:00+02:00', bpm: 59 },
      { time: '2026-09-30T23:10:00+02:00', bpm: 57 },
      { time: '2026-10-01T05:55:00+02:00', bpm: 62 },
    ],
  },
];
function metric(label: string) {
  const metrics = document.querySelector('#nachtansicht .night-metrics')!;
  return Array.from(metrics.querySelectorAll('.night-metric')).find(item => item.querySelector('dt')?.textContent === label)! as HTMLElement;
}

describe('NightExplorer', () => {
  it('uses actual phase boundaries and leaves unsampled gaps visible', () => {
    render(<NightExplorer nights={nights} demo />);
    const timeline = screen.getByRole('group', { name: 'Phasenverlauf nach Uhrzeit' });
    expect(within(timeline).getByText(/Keine Phasendaten/)).toBeVisible();
    const gap = timeline.querySelector('.night-timeline-gap');
    expect(gap).toHaveStyle({ left: '12.5%', width: '6.25%' });
    expect(metric('Schlafdauer')).toHaveTextContent('8 h');
    expect(metric('Schritte am Vortag')).toHaveTextContent(/8.?452 Schritte/);
    expect(metric('ANS-Status in dieser Nacht')).toHaveTextContent('1.2 ANS');
    expect(metric('HRV · Polar Nightly Recharge')).toHaveTextContent('56 ms');
    expect(timeline.querySelector('.night-timeline-phase.deep')).toBeInTheDocument();
  });

  it('selects nights with a keyboard-friendly control and only shows the pulse chart when values are present', () => {
    render(<NightExplorer nights={nights} demo />);
    expect(screen.queryByRole('region', { name: /Pulswerte/ })).not.toBeInTheDocument();
    const picker = screen.getByRole('combobox', { name: 'Nacht auswählen' });
    fireEvent.change(picker, { target: { value: '2026-10-01' } });
    const pulse = screen.getByRole('region', { name: /Pulswerte/ });
    expect(within(pulse).getByText(/Lücken entsprechen fehlenden Zeitabschnitten/)).toBeVisible();
    expect(pulse.querySelectorAll('circle')).toHaveLength(3);
    expect(pulse.querySelector('polyline, path')).not.toBeInTheDocument();
    fireEvent.click(within(pulse).getByText('Pulswerte als Liste'));
    expect(within(pulse).getByRole('list', { name: 'Gespeicherte Pulswerte' })).toBeVisible();
    const firstPulse = within(within(pulse).getByRole('list', { name: 'Gespeicherte Pulswerte' })).getByText(/59 bpm/).closest('li')!;
    expect(firstPulse).toHaveTextContent(/23:00.*59 bpm/);
    expect(document.querySelectorAll('#nachtansicht .night-metric dd')).toHaveLength(5);
    expect(metric('Schlafscore')).toHaveTextContent('Nicht verfügbar');
    expect(metric('ANS-Status in dieser Nacht')).toHaveTextContent('Nicht verfügbar');
    expect(metric('HRV · Polar Nightly Recharge')).toHaveTextContent('Nicht verfügbar');
  });

  it('offers phase labels and times in a keyboard-openable text list', () => {
    render(<NightExplorer nights={nights.slice(0, 1)} demo />);
    fireEvent.click(screen.getByText('Schlafphasen als Liste'));
    const phaseList = screen.getByRole('list', { name: 'Schlafphasen mit Uhrzeiten' });
    expect(within(phaseList).getByText(/Leicht/)).toBeVisible();
    const firstPhase = within(phaseList).getByText('Leicht').closest('li')!;
    expect(firstPhase).toHaveTextContent(/23:00.*00:00/);
    expect(within(phaseList).getByText(/Tief/)).toBeVisible();
    expect(within(phaseList).getByText(/REM/)).toBeVisible();
  });
});
