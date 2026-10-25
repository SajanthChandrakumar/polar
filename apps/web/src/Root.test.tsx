import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Root from './Root';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe.each(['/demo', '/demo/'])('public route %s', path => {
  it('renders the real synthetic explorer without making private API requests', async () => {
    window.history.replaceState({}, '', path);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<Root />);

    expect(screen.getByRole('heading', { name: 'Ein Blick auf die nächste Nacht' })).toBeVisible();
    expect(screen.getByText(/synthetische Daten/i)).toBeVisible();
    expect(screen.getByText(/03\.07\.2026 bis 30\.09\.2026/)).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

it('switches the real demo between its bundled period and outcome fixtures', async () => {
  window.history.replaceState({}, '', '/demo');
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  render(<Root />);

  expect(screen.getByText(/Ergebnisnächte 03\.07\.2026–30\.09\.2026/)).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Zeitraum' }), { target: { value: '30' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Ergebnis' }), { target: { value: 'ans' } });

  expect(screen.getByText(/Ergebnisnächte 01\.09\.2026–30\.09\.2026/)).toBeVisible();
  expect(screen.getAllByRole('button', { name: /ANS/ }).length).toBeGreaterThan(0);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('keeps the private dashboard as the default outside the demo route', async () => {
  window.history.replaceState({}, '', '/');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 })));
  render(<Root />);

  expect(screen.getByRole('heading', { name: 'Dein Körper. Deine Daten.' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Öffentliche Demo' })).toHaveAttribute('href', '/demo');
});
