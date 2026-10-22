import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ColumnChart, type ColumnSeries, SignalCard } from '../src';

afterEach(cleanup);

const series: ColumnSeries[] = [
  { label: 'Succeeded', tone: 'brand' },
  { label: 'Failed', tone: 'negative' },
];
const data = [
  { label: 'Mon 5 Oct', tick: 'Mon', values: [10, 0] },
  { label: 'Tue 6 Oct', tick: 'Tue', values: [0, 0] },
  { label: 'Wed 7 Oct', tick: 'Wed', values: [18, 2] },
];
const readout = (datum: { values: number[] }) => `${datum.values[0]} ok · ${datum.values[1]} failed`;

describe('ColumnChart', () => {
  it('stacks the series, reads out the latest column, and moves along with the arrow keys', () => {
    render(<ColumnChart data={data} series={series} format={readout} aria-label="Runs per day" />);
    const chart = screen.getByRole('img', { name: 'Runs per day' });
    const columns = document.querySelectorAll('[data-slot="column"]');
    expect(columns).toHaveLength(3);
    // Only the segments with a value are drawn; the top one is rounded and the tallest column fills the height.
    const wednesday = columns[2]?.querySelectorAll(':scope > div > div') ?? [];
    expect(wednesday).toHaveLength(2);
    expect((wednesday[0] as HTMLElement).style.height).toBe('90%');
    expect((wednesday[1] as HTMLElement).className).toContain('rounded-t-[4px]');
    expect((wednesday[1] as HTMLElement).className).toContain('bg-destructive');
    // An empty day keeps a stub on the baseline.
    expect(columns[1]?.querySelector('.h-\\[2px\\]')).toBeTruthy();

    const value = () => document.querySelector('[data-slot="column-value"]')?.textContent;
    expect(value()).toBe('18 ok · 2 failedWed 7 Oct');
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(value()).toBe('10 ok · 0 failedMon 5 Oct');
    expect(columns[0]?.getAttribute('data-active')).toBe('true');
    expect((columns[2] as HTMLElement).className).toContain('opacity-35');
  });

  it('names the series in a legend and lists the values in a table for screen readers', () => {
    render(<ColumnChart data={data} series={series} aria-label="Runs per day" />);
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(legend.textContent).toBe('SucceededFailed');
    const rows = screen.getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'PeriodSucceededFailed',
      'Mon 5 Oct100',
      'Tue 6 Oct00',
      'Wed 7 Oct182',
    ]);
    cleanup();
    render(<ColumnChart data={data} series={series} legend={false} />);
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
  });

  it('ticks every column when there are few, and only the ends when there are many', () => {
    render(<ColumnChart data={data} series={series} />);
    expect(screen.getByText('Tue')).toBeTruthy();
    cleanup();
    const month = Array.from({ length: 30 }, (_, i) => ({
      label: `Day ${i + 1}`,
      tick: `${i + 1} Sep`,
      values: [i, 0],
    }));
    render(<ColumnChart data={month} series={series} />);
    expect(screen.getByText('1 Sep')).toBeTruthy();
    expect(screen.getByText('30 Sep')).toBeTruthy();
    expect(screen.queryByText('15 Sep')).toBeNull();
  });
});

describe('SignalCard aside', () => {
  it('puts the aside where the tiles go', () => {
    render(<SignalCard title="Runs" value="183" aside={<p>By workflow</p>} />);
    expect(screen.getByText('By workflow')).toBeTruthy();
  });
});
