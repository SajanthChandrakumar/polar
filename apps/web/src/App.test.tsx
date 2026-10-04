import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

afterEach(() => vi.useRealTimers());
const optIn = () => fireEvent.click(screen.getByRole('button', { name: 'Beispieldaten ansehen' }));

describe('Dashboard behavior', () => {
  it('starts unconnected and shows metrics only after explicit demo opt-in; leaving clears them', () => {
    render(<App />);
    expect(screen.getByText('Nicht verbunden')).toBeVisible();
    expect(screen.queryByText('58')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Demo-Abruf' })).toBeDisabled();
    optIn();
    expect(screen.getByText('58')).toBeVisible();
    expect(screen.getByRole('status', { name: 'Datenmodus' })).toHaveTextContent('synthetisch');
    fireEvent.click(screen.getByRole('button', { name: 'Beispieldaten verlassen' }));
    expect(screen.queryByText('58')).not.toBeInTheDocument();
    expect(screen.getByText('Nicht verbunden')).toBeVisible();
  });

  it('filters the 21 sources and inspects a successful empty response without calling it unsupported', () => {
    render(<App />);
    optIn();
    expect(screen.getAllByRole('button', { name: /^Details zu/ })).toHaveLength(21);
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

  it('keeps route IDs absent without a reference and shows binary metadata rather than JSON', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Details zu Routen' }));
    expect(within(screen.getByRole('dialog')).getByText(/Keine Route-ID/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Details schließen' }));
    optIn();
    fireEvent.click(screen.getByRole('button', { name: 'Details zu Profilbild' }));
    expect(within(screen.getByRole('dialog')).getByText('image/png')).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByText(/2.048 Bytes/)).toBeVisible();
    expect(within(screen.getByRole('dialog')).queryByText('[]')).not.toBeInTheDocument();
  });

  it('simulates one loading run and exposes isolated partial failure and denied permission', () => {
    vi.useFakeTimers();
    render(<App />);
    optIn();
    const refresh = screen.getByRole('button', { name: 'Demo-Abruf' });
    fireEvent.click(refresh);
    expect(screen.getByRole('button', { name: /Demo-Abruf läuft/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Demo-Abruf läuft/ }));
    act(() => vi.advanceTimersByTime(1800));
    expect(screen.getByText(/Demo-Abruf beendet: 18 von 21/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Demo-Abruf' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Details zu Hauttemperatur' }));
    expect(within(screen.getByRole('dialog')).getByText('503 Service Unavailable')).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByText(/Simulierter Serverfehler/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Details schließen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Details zu Abonnements' }));
    expect(within(screen.getByRole('dialog')).getByText('403 Forbidden')).toBeVisible();
  });

  it('cancels a pending demo run when leaving demo and explains the connection step', () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Mit Polar verbinden' }));
    expect(within(screen.getByRole('dialog')).getByText(/OAuth/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    optIn();
    fireEvent.click(screen.getByRole('button', { name: 'Demo-Abruf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Beispieldaten verlassen' }));
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByText(/Demo-Abruf beendet/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Demo-Abruf' })).toBeDisabled();
    expect(screen.queryByText('58')).not.toBeInTheDocument();
  });
});
