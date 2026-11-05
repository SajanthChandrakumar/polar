import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PatternDemo from './PatternDemo';

function metric(label: string) {
  const metrics = document.querySelector('#nachtansicht .night-metrics')!;
  return Array.from(metrics.querySelectorAll('.night-metric')).find(item => item.querySelector('dt')?.textContent === label)! as HTMLElement;
}
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
const originalPath = window.location.pathname + window.location.search + window.location.hash;
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', originalPath);
});

describe('public Night Explorer demo', () => {
  it('opens bundled nights from the published deep link without network requests', () => {
    window.history.replaceState(null, '', '/demo#nachtansicht');
    render(<PatternDemo />);
    expect(screen.getByRole('heading', { name: 'Schlaf' })).toBeVisible();
    expect(screen.getByText('Synthetische Daten')).toBeVisible();
    const picker = screen.getByRole('combobox', { name: 'Nacht auswählen' });
    expect(picker.querySelectorAll('option')).toHaveLength(4);
    fireEvent.change(picker, { target: { value: '2026-09-27' } });
    expect(metric('Schritte am Vortag')).toHaveTextContent(/4.?394 Schritte/);
    expect(metric('Schlafdauer')).toHaveTextContent('7 h');
    expect(metric('ANS-Status in dieser Nacht')).toHaveTextContent('-0.3 ANS');
    expect(fetch).not.toHaveBeenCalled();
  });
});
