import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Analytics, { type AnalyticsData } from './Analytics';

const data: AnalyticsData = {
  days: 30,
  from: '2026-09-10',
  to: '2026-10-09',
  timezone: 'Europe/Zurich',
  daily_recovery: [
    { date: '2026-10-07', value: 0, reason: 'invalid', source_path: '/nightly-recharge-results', response_ids: ['ans-7'] },
    { date: '2026-10-08', value: 3, reason: 'available', source_path: '/nightly-recharge-results', response_ids: ['ans-8'] },
    { date: '2026-10-09', value: 2, reason: 'available', source_path: '/nightly-recharge-results', response_ids: ['ans-9'] },
  ],
  series: [
    { key: 'heart', label: 'Herzfrequenz', unit: 'bpm', kind: 'line', source_path: '/continuous-samples', points: [{ date: '2026-10-07', value: 70, provisional: false, response_ids: ['heart-7'], sample_count: 4 }, { date: '2026-10-08', value: null, provisional: false, response_ids: [] }, { date: '2026-10-09', value: 74, provisional: true, response_ids: ['heart-9-a', 'heart-9-b'], sample_count: 3 }], coverage: { valid_days: 2, total_days: 30 }, feedback: [{ date: '2026-10-09', status: 'comparison', value: 74, baseline: 68, delta: 6, comparison_days: 9, required_days: 7, from: '2026-09-30', to: '2026-10-08', text: 'Heute liegt deine Herzfrequenz über deinem Vergleich.' }] },
    { key: 'moon', label: 'Schlafdauer', unit: 'min', kind: 'line', source_path: '/sleeps', points: [{ date: '2026-10-07', value: 420, provisional: false, response_ids: ['sleep-7'] }, { date: '2026-10-08', value: 450, provisional: false, response_ids: ['sleep-8'] }, { date: '2026-10-09', value: 430, provisional: true, response_ids: ['sleep-9'] }], coverage: { valid_days: 3, total_days: 30 }, feedback: [{ date: '2026-10-09', status: 'comparison', value: 430, baseline: 420, delta: 10, comparison_days: 8, required_days: 7, from: '2026-10-01', to: '2026-10-08', text: 'Dein Schlaf lag nahe deinem Vergleich.' }] },
    { key: 'recharge', label: 'ANS-Status', unit: 'ANS', kind: 'line', source_path: '/nightly-recharge-results', points: [{ date: '2026-10-07', value: -1, provisional: false, response_ids: ['ans-7'] }, { date: '2026-10-08', value: null, provisional: false, response_ids: [] }, { date: '2026-10-09', value: 0.5, provisional: true, response_ids: ['ans-9'] }], coverage: { valid_days: 2, total_days: 30 }, feedback: [{ date: '2026-10-09', status: 'insufficient', value: 0.5, baseline: null, delta: null, comparison_days: 2, required_days: 7, from: '2026-10-02', to: '2026-10-08', text: 'Für den Vergleich fehlen noch gültige Nächte.' }] },
    { key: 'activity', label: 'Schritte', unit: 'Schritte', kind: 'bar', source_path: '/activity/list', points: [{ date: '2026-10-07', value: 4000, provisional: false, response_ids: ['steps-7'] }, { date: '2026-10-08', value: null, provisional: false, response_ids: [] }, { date: '2026-10-09', value: 9000, provisional: true, response_ids: ['steps-9'] }], coverage: { valid_days: 2, total_days: 30 }, feedback: [{ date: '2026-10-09', status: 'comparison', value: 9000, baseline: 6000, delta: 3000, comparison_days: 10, required_days: 7, from: '2026-10-01', to: '2026-10-08', text: 'Heute bist du mehr gegangen als im Vergleich.' }] },
    { key: 'training', label: 'Trainingsdauer', unit: 'min', kind: 'bar', source_path: '/training-sessions/list', points: [{ date: '2026-10-07', value: 0, provisional: false, response_ids: [] }, { date: '2026-10-08', value: 45, provisional: false, response_ids: ['training-8'] }, { date: '2026-10-09', value: 30, provisional: true, response_ids: ['training-9'] }], coverage: { valid_days: 3, total_days: 30 }, feedback: [{ date: '2026-10-09', status: 'missing', value: 30, baseline: null, delta: null, comparison_days: 0, required_days: 7, from: '2026-10-02', to: '2026-10-08', text: 'Für heute gibt es noch keinen Vergleich.' }] },
  ],
};

function response(body: AnalyticsData) { return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); }

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => response(data))));
afterEach(() => vi.unstubAllGlobals());

describe('archive analytics', () => {
  it('puts a dated recovery summary before its children and lets each chart be read by date', async () => {
    const inspect = vi.fn();
    render(<Analytics authenticated demo={false} onInspect={inspect}><div data-testid="rings">Ringe</div></Analytics>);
    const day = await screen.findByRole('region', { name: 'Dein Tag' });
    expect(screen.getByRole('combobox', { name: 'Tag auswählen' })).toHaveValue('2026-10-09');
    expect(within(day).getByText('🙁')).toBeVisible();
    expect(within(day).getByText('Schwächer erholt')).toBeVisible();
    expect(within(day).getByText('7 h 10 min')).toBeVisible();
    expect(within(day).getByText('74 bpm')).toBeVisible();
    expect(within(day).getByText(/9['’]000 Schritte/)).toBeVisible();
    expect(within(day).getAllByText(/vorläufig/i).length).toBeGreaterThan(0);
    expect(day.compareDocumentPosition(screen.getByTestId('rings')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(day).getByRole('link', { name: 'Verlauf ansehen' })).toBeVisible();

    fireEvent.change(screen.getByRole('combobox', { name: 'Tag auswählen' }), { target: { value: '2026-10-07' } });
    expect(within(day).getByText('Noch keine Erholungsbewertung verfügbar.')).toBeVisible();
    expect(within(day).queryByText('Sehr schwach')).not.toBeInTheDocument();
    expect(within(day).getByText('70 bpm')).toBeVisible();

    const heart = await screen.findByRole('region', { name: 'Herzfrequenz' });
    expect(within(heart).getByRole('combobox', { name: 'Tageswert Herzfrequenz' })).toHaveValue('2026-10-09');
    fireEvent.change(within(heart).getByRole('combobox', { name: 'Tageswert Herzfrequenz' }), { target: { value: '2026-10-07' } });
    fireEvent.click(within(heart).getByText('Messdetails ansehen'));
    fireEvent.click(within(heart).getByRole('button', { name: 'Originalantwort ansehen' }));
    expect(inspect).toHaveBeenCalledWith('/continuous-samples', ['heart-7']);
  });

  it.each([
    [1, '🙁', 'Schwächer erholt', 'Sehr schwach'],
    [2, '🙁', 'Schwächer erholt', 'Schwach'],
    [3, '🙁', 'Schwächer erholt', 'Beeinträchtigt'],
    [4, '😐', 'Erholung okay', 'Okay'],
    [5, '🙂', 'Gut erholt', 'Gut'],
    [6, '🙂', 'Gut erholt', 'Sehr gut'],
  ])('maps Polar level %i to its exact tier and original response', async (value, face, label, tier) => {
    const inspect = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...data, daily_recovery: [{ date: data.to, value: Number(value), reason: 'available', source_path: '/nightly-recharge-results', response_ids: [`recovery-${value}`] }] })));
    render(<Analytics authenticated demo={false} onInspect={inspect} />);
    const day = await screen.findByRole('region', { name: 'Dein Tag' });
    expect(within(day).getByText(face)).toBeVisible();
    expect(within(day).getByText(label)).toBeVisible();
    fireEvent.click(within(day).getByText('Warum diese Rückmeldung?'));
    expect(within(day).getByText(`Polar-Stufe ${value} von 6: ${tier}.`)).toBeVisible();
    fireEvent.click(within(day).getByRole('button', { name: 'Originalantwort ansehen' }));
    expect(inspect).toHaveBeenCalledWith('/nightly-recharge-results', [`recovery-${value}`]);
  });

  it('keeps missing and invalid recovery neutral', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...data, daily_recovery: [
      { date: '2026-10-07', value: null, reason: 'invalid', source_path: '/nightly-recharge-results', response_ids: ['invalid-zero'] },
      { date: '2026-10-08', value: null, reason: 'missing', source_path: '/nightly-recharge-results', response_ids: [] },
    ] })));
    render(<Analytics authenticated demo={false} />);
    const day = await screen.findByRole('region', { name: 'Dein Tag' });
    expect(within(day).getByText('○')).toBeVisible();
    expect(within(day).getByText('Noch keine Erholungsbewertung verfügbar.')).toBeVisible();
    fireEvent.change(within(day).getByRole('combobox', { name: 'Tag auswählen' }), { target: { value: '2026-10-07' } });
    expect(within(day).getByText('○')).toBeVisible();
    expect(within(day).queryByText('🙁')).not.toBeInTheDocument();
    fireEvent.click(within(day).getByText('Warum diese Rückmeldung?'));
    expect(within(day).getByText('Ungültige Stufe – siehe Originaldaten')).toBeVisible();
  });

  it('loads only for an authenticated private view and reloads the selected range', async () => {
    const fetchMock = vi.mocked(fetch);
    const view = render(<Analytics authenticated={false} demo={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
    view.rerender(<Analytics authenticated demo />);
    expect(fetchMock).not.toHaveBeenCalled();
    view.rerender(<Analytics authenticated demo={false} />);
    await screen.findByRole('region', { name: 'Herzfrequenz' });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/analytics?days=30', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Zeitraum' }), { target: { value: '7' } });
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/analytics?days=7', expect.objectContaining({ signal: expect.any(AbortSignal) })));
    fireEvent.change(screen.getByRole('combobox', { name: 'Zeitraum' }), { target: { value: '90' } });
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/analytics?days=90', expect.objectContaining({ signal: expect.any(AbortSignal) })));
  });

  it('shows five separate charts, leaves missing dates unplotted, and labels provisional points with provenance', async () => {
    const inspect = vi.fn();
    render(<Analytics authenticated demo={false} onInspect={inspect} />);
    const heart = await screen.findByRole('region', { name: 'Herzfrequenz' });
    expect(screen.getByRole('region', { name: 'Schlafdauer' })).toBeVisible();
    const ans = screen.getByRole('region', { name: 'ANS-Status' });
    expect(ans).toBeVisible();
    expect(within(ans).getByRole('group', { name: /y-Achse enthält Nulllinie: ja/ })).toBeInTheDocument();
    expect(within(ans).getByRole('button', { name: /07\.10\.2026.*-1 ANS/ })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Schritte' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Trainingsdauer' })).toBeVisible();
    expect(within(heart).getByRole('button', { name: /07\.10\.2026.*70 bpm/ })).toBeVisible();
    expect(within(heart).queryByRole('button', { name: /08\.10\.2026/ })).not.toBeInTheDocument();
    const provisional = within(heart).getByRole('button', { name: /09\.10\.2026.*74 bpm.*vorläufig/i });
    fireEvent.keyDown(provisional, { key: 'Enter' });
    expect(within(heart).getByText('Messdetails ansehen').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(within(heart).getByText('Messdetails ansehen'));
    expect(within(heart).getByText('/continuous-samples')).toBeVisible();
    expect(within(heart).getByText('heart-9-a')).toBeVisible();
    expect(within(heart).getByText('heart-9-b')).toBeVisible();
    fireEvent.click(within(heart).getByRole('button', { name: 'Originalantwort ansehen' }));
    expect(inspect).toHaveBeenCalledWith('/continuous-samples', ['heart-9-a', 'heart-9-b']);
  });

  it('shows backend daily feedback, its baseline requirement, and the comparison dates', async () => {
    render(<Analytics authenticated demo={false} />);
    await screen.findByRole('region', { name: 'Herzfrequenz' });
    expect(screen.getByRole('combobox', { name: 'Tag auswählen' })).toHaveValue('2026-10-09');
    expect(screen.getByText('Details zum Tagesvergleich').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Details zum Tagesvergleich'));
    const heartFeedback = screen.getByRole('article', { name: 'Herzfrequenz Tagesfeedback' });
    expect(within(heartFeedback).getByText('09.10.2026')).toBeVisible();
    expect(screen.getAllByText(/mindestens 7 gültige Tage/)).toHaveLength(5);
    expect(screen.getByText('Vergleichszeitraum: 2026-09-30–2026-10-08')).toBeVisible();
    expect(screen.getByText('Für den Vergleich fehlen noch gültige Nächte.')).toBeVisible();
  });

  it('clears private readings on logout and never fetches demo analytics', async () => {
    const view = render(<Analytics authenticated demo={false} />);
    await screen.findByRole('region', { name: 'Herzfrequenz' });
    view.rerender(<Analytics authenticated={false} demo={false} />);
    expect(screen.queryByRole('region', { name: 'Herzfrequenz' })).not.toBeInTheDocument();
    view.rerender(<Analytics authenticated demo />);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: 'Herzfrequenz' })).not.toBeInTheDocument();
  });

  it('reloads archive history when the completed-sync revision changes', async () => {
    const fetchMock = vi.mocked(fetch);
    const view = render(<Analytics authenticated demo={false} revision="before-sync" />);
    await screen.findByRole('region', { name: 'Herzfrequenz' });
    view.rerender(<Analytics authenticated demo={false} revision="2026-10-09T20:00:00Z" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/analytics?days=30', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('shows a retry action after an archive request fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Archiv nicht erreichbar'));
    render(<Analytics authenticated demo={false} />);
    expect(await screen.findByText('Archiv nicht erreichbar')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    await screen.findByRole('region', { name: 'Herzfrequenz' });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});
