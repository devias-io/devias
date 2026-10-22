import type { BlockDefinition, HomeBlockLayout } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { resolveLayouts } from '../src/pages/home/layout';

const block = (id: string, layout?: HomeBlockLayout): BlockDefinition => ({
  id: id,
  label: id,
  icon: 'circle',
  surfaces: { home: { layout } },
  component: () => null,
});

const positions = (layout: readonly { i: string; x: number; y: number; w: number; h: number }[] | undefined) =>
  layout?.map(({ i, x, y, w, h }) => `${i}:${x},${y} ${w}x${h}`);

describe('resolveLayouts', () => {
  it('flows the blocks in order: four across, two across, then one per row', () => {
    const layouts = resolveLayouts([block('a'), block('b'), block('c'), block('d', { w: 6, h: 4 })], undefined);
    expect(positions(layouts.lg)).toEqual(['a:0,0 3x6', 'b:3,0 3x6', 'c:6,0 3x6', 'd:0,6 6x4']);
    expect(positions(layouts.md)).toEqual(['a:0,0 3x6', 'b:3,0 3x6', 'c:0,6 3x6', 'd:0,12 6x4']);
    expect(positions(layouts.sm)).toEqual(['a:0,0 1x6', 'b:0,6 1x6', 'c:0,12 1x6', 'd:0,18 1x4']);
  });

  it('keeps saved placements, places blocks without one after them and carries the size limits', () => {
    const layouts = resolveLayouts([block('a'), block('b'), block('new', { minW: 4, maxH: 9 })], {
      layouts: {
        lg: [
          { i: 'b', x: 0, y: 0, w: 6, h: 5 },
          { i: 'a', x: 6, y: 0, w: 6, h: 8 },
          { i: 'gone', x: 0, y: 8, w: 3, h: 3 },
        ],
      },
      hidden: [],
    });
    expect(positions(layouts.lg)).toEqual(['b:0,0 6x5', 'a:6,0 6x8', 'new:0,8 3x6']);
    expect(layouts.lg?.[2]).toMatchObject({ minW: 4, minH: 4, maxH: 9 });
    // Smaller screens follow the large screen's reading order until they are arranged themselves.
    expect(positions(layouts.md)).toEqual(['b:0,0 6x5', 'a:0,5 6x8', 'new:0,13 3x6']);
    expect(layouts.sm?.[0]).toMatchObject({ w: 1, minW: 1 });
  });
});
