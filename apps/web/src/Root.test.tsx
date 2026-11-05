import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Root from './Root';
import { afterEach, describe, expect, it, vi } from 'vitest';

const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe.each(['/demo', '/demo/'])('shared public route %s', path => {
  it('renders the Overview in persistent synthetic mode without API requests', () => {
    window.history.replaceState({}, '', path);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<Root />);

    expect(screen.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
    expect(screen.getByText('Künstlich erzeugte Beispieldaten · Juli–September 2026')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Privaten Zugang öffnen' })).toHaveAttribute('href', '/');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

it('opens the direct /demo#nachtansicht link in Sleep', () => {
  window.history.replaceState({}, '', '/demo#nachtansicht');
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  render(<Root />);

  expect(screen.getByRole('heading', { name: 'Schlaf' })).toBeVisible();
  expect(screen.getByLabelText('Nacht auswählen')).toBeVisible();
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('opens the pattern alias in Trends and keeps bundled period/outcome controls local', () => {
  window.history.replaceState({}, '', '/demo#pattern-explorer');
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  render(<Root />);

  expect(screen.getByRole('heading', { name: 'Trends' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Bewegung und nächste Nacht' })).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Zeitraum' }), { target: { value: '30' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Ergebnis' }), { target: { value: 'ans' } });
  expect(screen.getByText(/Ergebnisnächte 01\.09\.2026–30\.09\.2026/)).toBeVisible();
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('shows the private Overview login gate outside the demo route', async () => {
  window.history.replaceState({}, '', '/');
  vi.stubGlobal('fetch', vi.fn(async () => response({ authenticated: false })));
  render(<Root />);

  expect(screen.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
  expect(await screen.findByRole('heading', { name: 'Privater Zugang' })).toBeVisible();
  expect(screen.getByLabelText('Besitzerpasswort')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Öffentliche Demo ansehen' })).toHaveAttribute('href', '/demo');
});
