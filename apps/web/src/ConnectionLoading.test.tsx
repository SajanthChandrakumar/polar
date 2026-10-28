import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

function deferred() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function connection() {
  const session = deferred(), dashboard = deferred();
  vi.stubGlobal('fetch', vi.fn((path: string) => {
    if (path === '/api/session') return session.promise;
    if (path === '/api/dashboard') return dashboard.promise;
    if (path.startsWith('/api/analytics?')) return Promise.resolve(response({ days: 30, from: '2026-09-29', to: '2026-10-28', timezone: 'Europe/Zurich', series: [] }));
    if (path.startsWith('/api/patterns?')) return Promise.resolve(response({ days: 90, outcome: 'sleep', from: '2026-07-31', to: '2026-10-28', activity_from: '2026-07-30', activity_to: '2026-10-27', timezone: 'Europe/Zurich', unit: 'min', threshold: null, status: 'insufficient', minimum_group_size: 7, groups: { lower: { count: 0, median: null, q1: null, q3: null }, upper: { count: 0, median: null, q1: null, q3: null } }, pairs: [], exclusions: { activity_unavailable: 0, activity_provisional: 0, outcome_unavailable: 0 } }));
    throw new Error(`Unexpected request: ${path}`);
  }));
  return { session, dashboard };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('initial connection', () => {
  it('shows indeterminate progress and elapsed time until the server returns the session', async () => {
    vi.useFakeTimers();
    const { session } = connection();
    render(<App />);
    expect(screen.getByRole('progressbar', { name: 'Verbindung wird hergestellt' })).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('Serververbindung wird aufgebaut …')).toBeVisible();
    expect(screen.getByText('Wartezeit 00:00')).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(65000); });
    expect(screen.getByText('Wartezeit 01:05')).toBeVisible();
    expect(screen.getByText(/Die Antwort lässt noch auf sich warten/)).toBeVisible();
    await act(async () => { session.resolve(response({ authenticated: false })); });
    expect(screen.queryByRole('progressbar', { name: 'Verbindung wird hergestellt' })).not.toBeInTheDocument();
  });

  it('continues counting through the dashboard request and stops once the overview is ready', async () => {
    vi.useFakeTimers();
    const { session, dashboard } = connection();
    render(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); session.resolve(response({ authenticated: true })); });
    expect(screen.getByText('Verbindung steht. Deine Übersicht wird geladen …')).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('Wartezeit 00:07')).toBeVisible();
    await act(async () => { dashboard.resolve(response({ connected: false, last_sync: null, sources: [] })); });
    expect(screen.queryByRole('progressbar', { name: 'Verbindung wird hergestellt' })).not.toBeInTheDocument();
  });

  it('ends the loading state and shows the actual error when the server request fails', async () => {
    const { session } = connection();
    render(<App />);
    expect(screen.getByRole('progressbar', { name: 'Verbindung wird hergestellt' })).toBeVisible();
    await act(async () => { session.reject(new Error('Verbindung unterbrochen')); });
    expect(screen.getByRole('alert')).toHaveTextContent('Verbindung unterbrochen');
    expect(screen.queryByRole('progressbar', { name: 'Verbindung wird hergestellt' })).not.toBeInTheDocument();
  });
});
