import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PatternDemo from './PatternDemo';

function metric(label: string) {
  const metrics = document.querySelector('#nachtansicht .night-metrics')!;
  return Array.from(metrics.querySelectorAll('.night-metric')).find(item => item.querySelector('dt')?.textContent === label)! as HTMLElement;
}
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
const originalPath = window.location.pathname + window.location.search + window.location.hash;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', originalPath);
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: originalScrollIntoView });
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

describe('public Night Explorer demo', () => {
  it('scrolls to the Night Explorer after mounting from a direct fragment URL', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    window.history.replaceState(null, '', '/demo#nachtansicht');
    render(<PatternDemo />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('uses synthetic nights aligned to the published example pairs and makes no network requests', () => {
    render(<PatternDemo />);
    expect(screen.getByRole('heading', { name: 'Dein Nachtverlauf' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Nacht Explorer ansehen/ })).toHaveAttribute('href', '#nachtansicht');
    expect(document.getElementById('nachtansicht')).toBeInTheDocument();
    expect(screen.getByText(/Nur synthetische Beispielwerte/)).toBeVisible();
    expect(screen.getByText('4 Beispielnächte · 27.–30. September 2026')).toBeVisible();
    const picker = screen.getByRole('combobox', { name: 'Nacht auswählen' });
    expect(picker.querySelectorAll('option')).toHaveLength(4);
    fireEvent.change(picker, { target: { value: '2026-09-27' } });
    expect(metric('Schritte am Vortag')).toHaveTextContent(/4.?394 Schritte/);
    expect(metric('Schlafdauer')).toHaveTextContent('7 h');
    expect(metric('ANS-Status in dieser Nacht')).toHaveTextContent('-0.3 ANS');
    expect(fetch).not.toHaveBeenCalled();
  });
});
