import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SignalCard, TrendChart } from '../src';

beforeAll(() => {
  // jsdom has no layout: give the chart a size and an observer that never fires.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
});
afterEach(cleanup);

const points = [
  { label: 'Mon', value: 10 },
  { label: 'Tue', value: 30 },
  { label: 'Wed', value: 20 },
];

describe('TrendChart', () => {
  it('shows the latest point, and moves along the points with the arrow keys', () => {
    render(<TrendChart points={points} format={(value) => `€${value}`} aria-label="Payments" />);
    const chart = screen.getByRole('img', { name: 'Payments' });
    expect(chart.querySelector('path[stroke="currentColor"]')?.getAttribute('d')).toMatch(/^M10\.0,/);
    expect(screen.getByText('€20')).toBeTruthy();
    expect(screen.getByText('Wed')).toBeTruthy();
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(screen.getByText('€30')).toBeTruthy();
    // It stops at the first point.
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(screen.getByText('€10')).toBeTruthy();
    expect(screen.getByText('Mon')).toBeTruthy();
  });
});

describe('SignalCard', () => {
  it('shows the figure and its tiles, and changes the period from its pills', () => {
    const changes: string[] = [];
    render(
      <SignalCard
        title="Money in"
        value="€60"
        meta="Last 7 days"
        ranges={[
          { id: '7d', label: '7D' },
          { id: '1m', label: '1M' },
        ]}
        range="7d"
        onRangeChange={(id) => changes.push(id)}
        tiles={[{ label: 'Today', value: '€20' }]}
      />,
    );
    expect(screen.getByText('€60')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '7D' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: '1M' }));
    fireEvent.click(screen.getByRole('tab', { name: '7D' }));
    expect(changes).toEqual(['1m']);
    expect(screen.getByText('Today').nextSibling?.textContent).toBe('€20');
  });
});
