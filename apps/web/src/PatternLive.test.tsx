import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PatternLive from './PatternLive';
import type { PatternAnalysis } from './patterns';

const data: PatternAnalysis = {
  days: 90, outcome: 'sleep', from: '2026-07-12', to: '2026-10-09', activity_from: '2026-07-11', activity_to: '2026-10-08', timezone: 'Europe/Zurich', unit: 'min', threshold: 7000, status: 'available', minimum_group_size: 7,
  groups: { lower: { count: 8, median: 420, q1: 390, q3: 450 }, upper: { count: 9, median: 460, q1: 430, q3: 490 } },
  pairs: [{ activity_date: '2026-10-01', outcome_date: '2026-10-02', steps: 6200, value: 390, group: 'lower', activity_response_ids: ['activity-1'], outcome_response_ids: ['sleep-1'] }],
  exclusions: { activity_unavailable: 2, activity_provisional: 1, outcome_unavailable: 3 },
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('PatternLive', () => {
  it('loads private patterns with the selected range and outcome', async () => {
    vi.mocked(fetch).mockResolvedValue(response(data));
    render(<PatternLive enabled revision="sync-1" />);
    await screen.findByRole('button', { name: /02\.10\.2026.*390 min/ });
    expect(fetch).toHaveBeenCalledWith('/api/patterns?days=90&outcome=sleep', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Zeitraum' }), { target: { value: '30' } });
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/patterns?days=30&outcome=sleep', expect.objectContaining({ signal: expect.any(AbortSignal) })));
    fireEvent.change(screen.getByRole('combobox', { name: 'Ergebnis' }), { target: { value: 'ans' } });
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/patterns?days=30&outcome=ans', expect.objectContaining({ signal: expect.any(AbortSignal) })));
  });

  it('never requests private analysis while disabled and clears it immediately when disabled', async () => {
    vi.mocked(fetch).mockResolvedValue(response(data));
    const view = render(<PatternLive enabled={false} revision="sync-1" />);
    expect(screen.getByText(/Melde dich an, um deine privaten Bewegungsmuster zu sehen/)).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    view.rerender(<PatternLive enabled revision="sync-1" />);
    await screen.findByRole('button', { name: /02\.10\.2026.*390 min/ });
    view.rerender(<PatternLive enabled={false} revision="sync-1" />);
    expect(screen.queryByRole('button', { name: /02\.10\.2026.*390 min/ })).not.toBeInTheDocument();
  });

  it('aborts the prior request on revision changes and ignores its late response', async () => {
    const first = deferred<Response>(), second = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<PatternLive enabled revision="sync-1" />);
    const firstSignal = vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal;
    view.rerender(<PatternLive enabled revision="sync-2" />);
    expect(firstSignal.aborted).toBe(true);
    const newer = { ...data, pairs: [{ ...data.pairs[0], value: 460 }] };
    second.resolve(response(newer));
    await screen.findByRole('button', { name: /460 min/ });
    first.resolve(response(data));
    await waitFor(() => expect(screen.getByRole('button', { name: /460 min/ })).toBeVisible());
    expect(screen.queryByRole('button', { name: /390 min/ })).not.toBeInTheDocument();
  });

  it('clears private data and notifies the app when the API says the session expired', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response({ detail: 'Anmeldung erforderlich' }, 401));
    const onUnauthorized = vi.fn();
    const view = render(<PatternLive enabled revision="sync-1" onUnauthorized={onUnauthorized} />);
    await screen.findByRole('button', { name: /02\.10\.2026.*390 min/ });
    view.rerender(<PatternLive enabled revision="sync-2" onUnauthorized={onUnauthorized} />);
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /02\.10\.2026.*390 min/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Sitzung abgelaufen/)).toBeVisible();
  });

  it('shows request errors and retries without substituting demo values', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ detail: 'Archiv nicht erreichbar' }, 503)).mockResolvedValueOnce(response(data));
    render(<PatternLive enabled revision="sync-1" />);
    expect(await screen.findByText('Archiv nicht erreichbar')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
    await screen.findByRole('button', { name: /02\.10\.2026.*390 min/ });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
