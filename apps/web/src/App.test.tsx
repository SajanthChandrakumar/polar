import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({authenticated:false}),{status:200}))));
afterEach(() => {vi.useRealTimers();vi.unstubAllGlobals();});
const optIn = () => fireEvent.click(screen.getByRole('button', { name: 'Beispieldaten ansehen' }));
const showSources = () => fireEvent.click(screen.getByRole('link', { name: 'Details ansehen' }));

describe('Dashboard behavior', () => {
  it('orders the day, six rings and history, then opens the source archive from the header', async () => {
    render(<App />);
    const day = screen.getByRole('region', { name: 'Dein Tag' });
    const rings = screen.getByLabelText('Datenübersicht');
    const history = await screen.findByRole('heading', { name: 'Dein Verlauf' });
    expect(day.compareDocumentPosition(rings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rings.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aktualisieren' })).toBeDisabled();
    const sourceDetails = screen.getByText('Details & Originaldaten').closest('details')!;
    expect(sourceDetails).not.toHaveAttribute('open');
    expect(screen.getByRole('link', { name: 'Details ansehen' })).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Details ansehen' }));
    expect(sourceDetails).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Details zu Pulsintervalle' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Anmelden' })).toBeVisible();
    fireEvent.click(document.querySelector('.account-disclosure > summary')!);
    expect(screen.getByRole('button', { name: 'Mit Polar verbinden' })).toBeVisible();
  });

  it('starts unconnected and shows metrics only after explicit demo opt-in; leaving clears them', () => {
    render(<App />);
    expect(screen.getByText('Nicht verbunden')).toBeVisible();
    expect(screen.queryByText('58')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktualisieren' })).toBeDisabled();
    optIn();
    expect(screen.getByText('58')).toBeVisible();
    expect(screen.getByRole('status', { name: 'Datenmodus' })).toHaveTextContent('synthetisch');
    fireEvent.click(screen.getByRole('button', { name: 'Beispieldaten verlassen' }));
    expect(screen.queryByText('58')).not.toBeInTheDocument();
    expect(screen.getByText('Nicht verbunden')).toBeVisible();
  });

  it('filters the 19 sources and inspects a successful empty response without calling it unsupported', () => {
    render(<App />);
    optIn();
    showSources();
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
  });

  it('keeps route IDs absent and omits the removed profile endpoints', () => {
    render(<App />);
    optIn();
    showSources();
    fireEvent.click(screen.getByRole('button', { name: 'Details zu Routen' }));
    expect(within(screen.getByRole('dialog')).getByText(/Keine Route-ID/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Details schließen' }));
    expect(screen.queryByRole('button', { name: 'Details zu Profilbild' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Details zu Profilreihenfolge' })).not.toBeInTheDocument();
  });

  it('simulates one loading run and exposes isolated partial failure and denied permission', () => {
    vi.useFakeTimers();
    render(<App />);
    optIn();
    showSources();
    const refresh = screen.getByRole('button', { name: 'Demo-Abruf' });
    fireEvent.click(refresh);
    expect(screen.getByRole('button', { name: /Demo-Abruf läuft/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Demo-Abruf läuft/ }));
    act(() => vi.advanceTimersByTime(1800));
    expect(screen.getByText(/Demo-Abruf beendet: 16 von 19/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Demo-Abruf' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Details zu Hauttemperatur' }));
    expect(within(screen.getByRole('dialog')).getByText('503 Service Unavailable')).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByText(/Simulierter Serverfehler/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Details schließen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Details zu Abonnements' }));
    expect(within(screen.getByRole('dialog')).getByText('403 Forbidden')).toBeVisible();
  });

    it('shows the private pattern lab entry without requesting patterns before sign-in', async () => {
    render(<App />);
    expect(screen.getByRole('link', { name: 'Bewegungsmuster' })).toHaveAttribute('href', '#pattern-explorer');
    expect(screen.getByRole('link', { name: 'Öffentliche Demo' })).toHaveAttribute('href', '/demo');
    expect(await screen.findByRole('heading', { name: 'Wie hängt Bewegung mit der nächsten Nacht zusammen?' })).toBeVisible();
    expect(screen.getByText(/Melde dich an, um deine privaten Bewegungsmuster zu sehen/)).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).startsWith('/api/patterns'))).toBe(false);
  });
it('cancels a pending demo run when leaving demo and explains the connection step', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mit Polar verbinden' })).toBeEnabled());
    vi.useFakeTimers();
    fireEvent.click(document.querySelector('.account-disclosure > summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Mit Polar verbinden' }));
    expect(within(screen.getByRole('dialog')).getByText(/OAuth/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    optIn();
    fireEvent.click(screen.getByRole('button', { name: 'Demo-Abruf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Beispieldaten verlassen' }));
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByText(/Demo-Abruf beendet/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktualisieren' })).toBeDisabled();
    expect(screen.queryByText('58')).not.toBeInTheDocument();
  });
});
