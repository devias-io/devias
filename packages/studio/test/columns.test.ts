import type { ViewState } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { moveShownColumn } from '../src/views/columns';

const col = (name: string, visible = true): ViewState['fields'][number] => ({ name, visible });
const names = (columns: ViewState['fields']) => columns.map((c) => c.name);

describe('moveShownColumn', () => {
  const columns = [col('a'), col('b'), col('hidden', false), col('c'), col('d')];

  it('moves a shown column to where another is, over hidden columns', () => {
    // a b [hidden] c d → c takes a's place; the others shift along the shown slots.
    expect(names(moveShownColumn(columns, 'c', 'a'))).toEqual(['c', 'a', 'hidden', 'b', 'd']);
    expect(names(moveShownColumn(columns, 'a', 'd'))).toEqual(['b', 'c', 'hidden', 'd', 'a']);
  });

  it('keeps hidden columns where they were, and leaves the order alone for a no-op', () => {
    expect(moveShownColumn(columns, 'b', 'b')).toBe(columns);
    expect(moveShownColumn(columns, 'b', 'hidden')).toBe(columns);
    expect(moveShownColumn(columns, 'nope', 'a')).toBe(columns);
    expect(moveShownColumn(columns, 'b', 'c')[2]?.name).toBe('hidden');
  });
});
