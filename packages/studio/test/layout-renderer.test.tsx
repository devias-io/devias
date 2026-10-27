import { defineBlockComponent } from '@devias/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LayoutRenderer, placementStyle } from '../src/record/layout-renderer';
import { createFakeClient, recordsFixture, resolvedFixture, schemaFixture, TestProviders } from '../src/testing';

afterEach(cleanup);

describe('LayoutRenderer', () => {
  it('computes 12-column placement variables', () => {
    expect(placementStyle({ column: 5, columnSpan: 8, row: 2 })).toEqual({ '--col': '5 / span 8', '--row': '2' });
    expect(placementStyle({ columnSpan: 6 })).toEqual({ '--col': 'span 6', '--row': 'auto' });
    expect(placementStyle({})).toEqual({ '--col': 'span 12', '--row': 'auto' });
  });

  it('renders blocks in place with their checked config, and placeholders for unknown or misconfigured ones', () => {
    const echo = defineBlockComponent({
      id: '01a1751f-5f08-717d-a428-6fcd88614065',
      label: 'Echo',
      icon: 'text',
      config: z.object({ text: z.string() }),
      surfaces: { record: {} },
      component: ({ config, record }) => (
        <span>
          {config.text}:{String(record.first_name)}
        </span>
      ),
    });
    const config = resolvedFixture({ blocks: [echo] });
    const object = schemaFixture().objects[0] as NonNullable<ReturnType<typeof schemaFixture>['objects'][0]>;
    const record = { id: 'p1', created_at: '', updated_at: '', first_name: 'Ada' };
    const { container } = render(
      <TestProviders
        client={createFakeClient(schemaFixture(), recordsFixture())}
        schema={schemaFixture()}
        config={config}
      >
        <LayoutRenderer
          object={object}
          record={record}
          blocks={[
            {
              name: 'a',
              blockId: '01a1751f-5f08-717d-a428-6fcd88614065',
              label: 'Hello',
              config: { text: 'hi' },
              column: 1,
              columnSpan: 4,
              row: 1,
            },
            { name: 'b', blockId: '01a1751f-5f08-717d-a428-71c7198d6723', config: {}, columnSpan: 8 },
            { name: 'c', blockId: '01a1751f-5f08-717d-a428-6fcd88614065', config: { text: 42 } },
          ]}
        />
      </TestProviders>,
    );
    expect(screen.getByText('hi:Ada')).toBeTruthy();
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.getByText('Unknown block "01a1751f-5f08-717d-a428-71c7198d6723"')).toBeTruthy();
    expect(screen.getByText('Invalid block config')).toBeTruthy();
    const a = container.querySelector('[data-cell="a"]') as HTMLElement;
    const b = container.querySelector('[data-cell="b"]') as HTMLElement;
    expect(a.getAttribute('data-block')).toBe('01a1751f-5f08-717d-a428-6fcd88614065');
    expect(a.style.getPropertyValue('--col')).toBe('1 / span 4');
    expect(a.style.getPropertyValue('--row')).toBe('1');
    expect(b.style.getPropertyValue('--col')).toBe('span 8');
    expect(b.style.getPropertyValue('--row')).toBe('auto');
  });

  it('stacks cells that name a column but no row in a lane of their own, so one lane never stretches another', () => {
    const note = defineBlockComponent({
      id: '01a1751f-5f08-717d-a428-75ccbcee1747',
      label: 'Note',
      icon: 'text',
      surfaces: { record: { frame: false } },
      component: () => <span>note</span>,
    });
    const config = resolvedFixture({ blocks: [note] });
    const object = schemaFixture().objects[0] as NonNullable<ReturnType<typeof schemaFixture>['objects'][0]>;
    const record = { id: 'p1', created_at: '', updated_at: '' };
    const { container } = render(
      <TestProviders
        client={createFakeClient(schemaFixture(), recordsFixture())}
        schema={schemaFixture()}
        config={config}
      >
        <LayoutRenderer
          object={object}
          record={record}
          blocks={[
            { name: 'a', blockId: '01a1751f-5f08-717d-a428-75ccbcee1747', config: {}, column: 1, columnSpan: 7 },
            { name: 'b', blockId: '01a1751f-5f08-717d-a428-75ccbcee1747', config: {}, column: 8, columnSpan: 5 },
            { name: 'c', blockId: '01a1751f-5f08-717d-a428-75ccbcee1747', config: {}, column: 1, columnSpan: 7 },
            { name: 'd', blockId: '01a1751f-5f08-717d-a428-75ccbcee1747', config: {}, columnSpan: 12 },
            {
              name: 'e',
              blockId: '01a1751f-5f08-717d-a428-75ccbcee1747',
              config: {},
              column: 2,
              columnSpan: 3,
              row: 4,
            },
          ]}
        />
      </TestProviders>,
    );
    const lanes = [...container.querySelectorAll('[data-lane]')];
    expect(lanes.map((lane) => lane.getAttribute('data-lane'))).toEqual(['1', '8']);
    // The left lane holds its two cells in order, with the first one's width; the right one holds its own.
    expect(
      [...(lanes[0] as HTMLElement).querySelectorAll('[data-cell]')].map((cell) => cell.getAttribute('data-cell')),
    ).toEqual(['a', 'c']);
    expect((lanes[0] as HTMLElement).style.getPropertyValue('--col')).toBe('1 / span 7');
    expect((lanes[1] as HTMLElement).querySelectorAll('[data-cell]')).toHaveLength(1);
    // A cell without a column, and one with an explicit row, are placed as before.
    expect((container.querySelector('[data-cell="d"]') as HTMLElement).closest('[data-lane]')).toBeNull();
    expect((container.querySelector('[data-cell="e"]') as HTMLElement).style.getPropertyValue('--row')).toBe('4');
  });
});
