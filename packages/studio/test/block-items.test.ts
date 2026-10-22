import { describe, expect, it } from 'vitest';
import { BLOCK_ITEMS, matchBlockItems } from '../src/editor/block-items';

const keys = (query: string) => matchBlockItems(query).map((item) => item.key);

describe('block menu', () => {
  it('lists every block for an empty query', () => {
    expect(keys('')).toEqual(BLOCK_ITEMS.map((item) => item.key));
  });

  it('matches titles anywhere and keywords by prefix, case-insensitively', () => {
    expect(keys('head')).toEqual(['h1', 'h2', 'h3']);
    expect(keys('TODO')).toEqual([]);
    expect(keys('to-do')).toEqual(['todo']);
    expect(keys('task')).toEqual(['todo']);
    expect(keys('list')).toEqual(['bullets', 'numbers', 'todo']);
    expect(keys('hr')).toEqual(['divider']);
    expect(keys('zzz')).toEqual([]);
  });
});
