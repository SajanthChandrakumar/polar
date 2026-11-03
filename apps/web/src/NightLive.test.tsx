import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PatternLive from './PatternLive';

const night = (steps: number) => ({
  date: '2026-10-02', start: '2026-10-01T23:00:00+02:00', end: '2026-10-02T07:00:00+02:00', sleep_minutes: 480,
  sleep_score: 84, steps_previous_day: steps, ans: 1.2, hrv_ms: 56,
  phases: [{ start: '2026-10-01T23:00:00+02:00', end: '2026-10-02T00:30:00+02:00', stage: 'light' }], pulse: [],
});
const patterns = {
  days: 90, outcome: 'sleep', from: '2026-07-12', to: '2026-10-09', activity_from: '2026-07-11', activity_to: '2026-10-08', timezone: 'Europe/Zurich', unit: 'min', threshold: null, status: 'insufficient', minimum_group_size: 7,
  groups: { lower: { count: 0, median: null, q1: null, q3: null }, upper: { count: 0, median: null, q1: null, q3: null } }, pairs: [], exclusions: { activity_unavailable: 0, activity_provisional: 0, outcome_unavailable: 0 },
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function metric(label: string) {
  const metrics = document.querySelector('#nachtansicht .night-metrics');
  return metrics && Array.from(metrics.querySelectorAll('.night-metric')).find(item => item.querySelector('dt')?.textContent === label) as HTMLElement | undefined;
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).startsWith('/api/patterns') ? Promise.resolve(response(patterns)) : Promise.resolve(response({ nights: [night(8452)] })) )));
afterEach(() => vi.unstubAllGlobals());

describe('PatternLive night explorer', () => {
  it('fetches nights only after the authenticated person opens the explorer', async () => {
    render(<PatternLive enabled revision="sync-1" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/patterns?days=90&outcome=sleep', expect.anything()));
    expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path) === '/api/nights')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Nachtverlauf anzeigen' }));
    await waitFor(() => expect(metric('Schlafdauer')!).toHaveTextContent('8 h'));
    expect(fetch).toHaveBeenCalledWith('/api/nights', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(metric('Schritte am Vortag')!).toHaveTextContent(/8.?452 Schritte/);
  });

  it('does not request private nights before authentication', () => {
    render(<PatternLive enabled={false} revision="sync-1" />);
    expect(screen.getByText('Melde dich an, um deine privaten Nachtverläufe zu sehen.')).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path) === '/api/nights')).toBe(false);
  });

  it('aborts a stale request on sync revision changes and shows only the newer response', async () => {
    const first = deferred<Response>(), second = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/patterns')) return Promise.resolve(response(patterns));
      return vi.mocked(fetch).mock.calls.filter(([path]) => String(path) === '/api/nights').length === 1 ? first.promise : second.promise;
    }));
    const view = render(<PatternLive enabled revision="sync-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Nachtverlauf anzeigen' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/nights', expect.anything()));
    const firstSignal = vi.mocked(fetch).mock.calls.find(([path]) => String(path) === '/api/nights')![1]?.signal as AbortSignal;
    view.rerender(<PatternLive enabled revision="sync-2" />);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([path]) => String(path) === '/api/nights')).toHaveLength(2));
    expect(firstSignal.aborted).toBe(true);
    second.resolve(response({ nights: [night(9800)] }));
    await waitFor(() => expect(metric('Schritte am Vortag')!).toHaveTextContent(/9.?800 Schritte/));
    first.resolve(response({ nights: [night(3200)] }));
    await waitFor(() => expect(metric('Schritte am Vortag')!).not.toHaveTextContent(/3.?200 Schritte/));
  });

  it('clears private nights and propagates 401 when the session expires', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => String(input).startsWith('/api/patterns') ? Promise.resolve(response(patterns)) : Promise.resolve(response({ detail: 'Anmeldung erforderlich' }, 401)));
    const onUnauthorized = vi.fn();
    render(<PatternLive enabled revision="sync-1" onUnauthorized={onUnauthorized} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nachtverlauf anzeigen' }));
    expect(await screen.findByText(/Sitzung abgelaufen/)).toBeVisible();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('8 h')).not.toBeInTheDocument();
  });

  it('clears an open private night view immediately on logout', async () => {
    const view = render(<PatternLive enabled revision="sync-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Nachtverlauf anzeigen' }));
    await waitFor(() => expect(metric('Schlafdauer')!).toHaveTextContent('8 h'));
    view.rerender(<PatternLive enabled={false} revision="sync-1" />);
    expect(screen.queryByText('8 h')).not.toBeInTheDocument();
  });
});
