import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import Root from './Root';
import Analytics from './Analytics';

const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('shared workspace', () => {
  it('shows one destination and follows native hash navigation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ authenticated: false })));
    render(<App />);

    const nav = screen.getByRole('navigation', { name: 'Arbeitsbereiche' });
    expect(nav.querySelectorAll('a')).toHaveLength(4);
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Übersicht');
    fireEvent.click(screen.getByRole('link', { name: 'Schlaf' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Schlaf' })).toBeVisible());
    expect(screen.getByRole('link', { name: 'Schlaf' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('region', { name: 'Herzfrequenz' })).not.toBeInTheDocument();
  });

  it('opens Sleep directly from the established /demo#nachtansicht link', () => {
    window.history.replaceState({}, '', '/demo#nachtansicht');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<Root />);

    expect(screen.getByRole('heading', { name: 'Schlaf' })).toBeVisible();
    expect(document.querySelector('.demo-notice')).toHaveTextContent('Künstlich erzeugte Beispieldaten · Juli–September 2026');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps every demo destination local and request-free', async () => {
    window.history.replaceState({}, '', '/demo');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<Root />);

    const nav = screen.getByRole('navigation', { name: 'Arbeitsbereiche' });
    for (const name of ['Schlaf', 'Trends', 'Daten', 'Übersicht']) {
      fireEvent.click(screen.getByRole('link', { name }));
      await waitFor(() => expect(screen.getByRole('heading', { name })).toBeVisible());
      expect(fetchSpy).not.toHaveBeenCalled();
    }
    expect(nav.querySelectorAll('a')).toHaveLength(4);
  });

  it('shows a private login gate until sign-in succeeds', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/session'
      ? response({ authenticated: false })
      : response({}));
    vi.stubGlobal('fetch', fetchSpy);
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Privater Zugang' })).toBeVisible();
    expect(screen.getByLabelText('Besitzerpasswort')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Öffentliche Demo' })).toHaveAttribute('href', '/demo');
    expect(screen.queryByRole('region', { name: 'Herzfrequenz' })).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('shared analytics date', () => {
  it('keeps the overview date and every trend selection in sync', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      days: 30, from: '2026-09-10', to: '2026-10-09', timezone: 'Europe/Zurich',
      daily_recovery: [],
      series: [
        { key: 'heart', label: 'Herzfrequenz', unit: 'bpm', kind: 'line', source_path: '/continuous-samples', points: [{ date: '2026-10-07', value: 70, provisional: false, response_ids: [] }, { date: '2026-10-09', value: 74, provisional: false, response_ids: [] }], coverage: { valid_days: 2, total_days: 30 }, feedback: [] },
        { key: 'moon', label: 'Schlafdauer', unit: 'min', kind: 'line', source_path: '/sleeps', points: [{ date: '2026-10-07', value: 420, provisional: false, response_ids: [] }, { date: '2026-10-09', value: 430, provisional: false, response_ids: [] }], coverage: { valid_days: 2, total_days: 30 }, feedback: [] },
      ],
    })));
    render(<Analytics authenticated demo={false} />);
    await screen.findByRole('region', { name: 'Herzfrequenz' });

    const dateControls = screen.getAllByRole('combobox', { name: 'Tag auswählen' });
    expect(dateControls).toHaveLength(1);
    fireEvent.change(dateControls[0], { target: { value: '2026-10-07' } });
    const heart = screen.getByRole('region', { name: 'Herzfrequenz' });
    const sleep = screen.getByRole('region', { name: 'Schlafdauer' });
    expect(heart.querySelector('.analytics-point-detail strong')).toHaveTextContent('07.10.2026 · 70 bpm');
    expect(sleep.querySelector('.analytics-point-detail strong')).toHaveTextContent('07.10.2026 · 7 h');
    fireEvent.click(screen.getByRole('button', { name: /09\.10\.2026: 74 bpm/ }));
    expect(dateControls[0]).toHaveValue('2026-10-09');
    expect(heart.querySelector('.analytics-point-detail strong')).toHaveTextContent('09.10.2026 · 74 bpm');
  });
});

describe('bundled demo analytics', () => {
  it('shows only synthetic series supported by the bundled fixtures', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<Analytics authenticated demo view="trends" />);

    expect(screen.getByRole('region', { name: 'Schlafdauer' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Schritte' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'ANS-Status' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Herzfrequenz' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Trainingsdauer' })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});


describe('analytics date defaults', () => {
  it('selects the latest finite reading when the response has no end date', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      days: 7, from: '', to: '', timezone: 'Europe/Zurich',
      series: [{ key: 'heart', label: 'Herzfrequenz', unit: 'bpm', kind: 'line', source_path: '/continuous-samples', points: [
        { date: '2026-10-06', value: 68, provisional: false, response_ids: [] },
        { date: '2026-10-08', value: 72, provisional: false, response_ids: [] },
        { date: '2026-10-09', value: null, provisional: false, response_ids: [] },
      ], coverage: { valid_days: 2, total_days: 7 }, feedback: [] }],
    })));
    render(<Analytics authenticated demo={false} view="trends" />);
    await screen.findByRole('region', { name: 'Herzfrequenz' });
    expect(screen.getByRole('combobox', { name: 'Tag auswählen' })).toHaveValue('2026-10-08');
    expect(screen.getByText(/Ausgewählter Tag: 08\.10\.2026/)).toBeVisible();
  });
});
