import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { window.history.replaceState({}, '', '/'); vi.stubGlobal('fetch', vi.fn(async () => response({ authenticated: false }))); });
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

async function openData() {
  fireEvent.click(screen.getByRole('link', { name: 'Daten' }));
  await screen.findByRole('heading', { name: 'Daten' });
}

describe('workspace shell', () => {
  it('shows the four persistent destinations and the private login gate', async () => {
    render(<App />);
    expect(screen.getByRole('navigation', { name: 'Arbeitsbereiche' }).querySelectorAll('a')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Übersicht' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { name: 'Privater Zugang' })).toBeVisible();
    expect(screen.getByLabelText('Besitzerpasswort')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Öffentliche Demo ansehen' })).toHaveAttribute('href', '/demo');
  });

  it('does not mount private trends or sleep fetches before authentication', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Privater Zugang' });
    const fetchMock = vi.mocked(fetch);

    fireEvent.click(screen.getByRole('link', { name: 'Trends' }));
    await screen.findByRole('heading', { name: 'Trends' });
    fireEvent.click(screen.getByRole('link', { name: 'Schlaf' }));
    await screen.findByRole('heading', { name: 'Schlaf' });
    expect(await screen.findByRole('heading', { name: 'Privater Zugang' })).toBeVisible();
    expect(fetchMock.mock.calls.some(([path]) => String(path).startsWith('/api/patterns') || String(path) === '/api/nights' || String(path).startsWith('/api/analytics'))).toBe(false);
  });

  it('keeps the source inventory filter and accessible inspector in the Data destination', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<App demo />);
    await openData();

    expect(screen.getAllByRole('button', { name: /^Details zu/ })).toHaveLength(19);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Datenquellen durchsuchen' }), { target: { value: 'ppi' } });
    expect(screen.getAllByRole('button', { name: /^Details zu/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Details zu Pulsintervalle' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('/ppi-samples')).toBeVisible();
    expect(within(dialog).getByText('200 OK')).toBeVisible();
    expect(within(dialog).getByText('[]')).toBeVisible();
    expect(within(dialog).getByText(/keine Aussage zur Geräteunterstützung/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Details schließen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps route IDs absent and omits removed profile endpoints from the inventory', async () => {
    render(<App demo />);
    await openData();
    fireEvent.click(screen.getByRole('button', { name: 'Details zu Routen' }));
    expect(within(screen.getByRole('dialog')).getByText(/Keine Route-ID/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Details schließen' }));
    expect(screen.queryByRole('button', { name: 'Details zu Profilbild' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Details zu Profilreihenfolge' })).not.toBeInTheDocument();
  });

  it('shows the Polar connection step after a successful private login', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/session') return response({ authenticated: false });
      if (path === '/api/dashboard') return response({ connected: false, last_sync: null, sources: [], metrics: {} });
      if (path.startsWith('/api/analytics')) return response({ days: 30, from: '2026-09-10', to: '2026-10-09', timezone: 'Europe/Zurich', series: [] });
      return response({});
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('heading', { name: 'Privater Zugang' });
    fireEvent.change(screen.getByLabelText('Besitzerpasswort'), { target: { value: 'private' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('heading', { name: 'Polar verbinden' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Mit Polar verbinden' })).toHaveAttribute('href', '/api/polar/authorize');
    expect(screen.getByRole('button', { name: 'Aktualisieren' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith('/api/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ password: 'private' }) }));
  });
});
