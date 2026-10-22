import type { BlockDefinition, LayoutBlock, LayoutTab, RecordSurface } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { withPlacedBlocks, withPlacedCells } from '../src/record/placement';

const block = (name: string, record: RecordSurface = {}): BlockDefinition => ({
  id: `test.${name}`,
  label: name[0]?.toUpperCase() + name.slice(1),
  icon: 'file',
  surfaces: { record },
  component: () => null,
});

const person = { id: 'fixture.person' };

const tabs: LayoutTab[] = [
  { name: 'overview', label: 'Overview', blocks: [{ name: 'details', blockId: 'core.fields', config: {} }] },
  { name: 'more', label: 'More', blocks: [] },
];
const deals: LayoutTab = { name: 'deals', label: 'Deals', blocks: [] };

const cells = (list: LayoutBlock[]) =>
  list.map((cell) => `${cell.blockId}${cell.label ? ` "${cell.label}"` : ''}`).join(', ');
const shape = (placed: LayoutTab[]) => placed.map((tab) => `${tab.name}: ${cells(tab.blocks)}`);

describe('withPlacedBlocks', () => {
  it('adds overview blocks to the overview tab and tab blocks after the layout', () => {
    const result = withPlacedBlocks(
      { tabs },
      [block('fields'), block('activity', { placement: 'tab' }), block('mentions', { placement: 'overview', span: 6 })],
      person,
    );
    expect(shape(result)).toEqual([
      'overview: core.fields, test.mentions "Mentions"',
      'more: ',
      'activity: test.activity',
    ]);
    expect(result[0]?.blocks[1]).toMatchObject({ name: 'test.mentions', columnSpan: 6 });
    expect(result.at(-1)).toMatchObject({ name: 'activity', label: 'Activity', icon: 'file' });
  });

  it('puts overview blocks at the end of the first tab when no tab is called overview', () => {
    expect(
      shape(
        withPlacedBlocks({ tabs: [deals, ...tabs.slice(1)] }, [block('mentions', { placement: 'overview' })], person),
      ),
    ).toEqual(['deals: test.mentions "Mentions"', 'more: ']);
  });

  it('starts an Overview tab when the layout has no tabs', () => {
    expect(shape(withPlacedBlocks({ tabs: [] }, [block('mentions', { placement: 'overview' })], person))).toEqual([
      'overview: test.mentions "Mentions"',
    ]);
  });

  it('leaves blocks the layout places, in its tabs or as its header, where the layout puts them', () => {
    const placed: LayoutTab[] = [
      ...tabs,
      { name: 'history', label: 'History', blocks: [{ name: 'log', blockId: 'test.activity', config: {} }] },
    ];
    expect(withPlacedBlocks({ tabs: placed }, [block('activity', { placement: 'tab' })], person)).toBe(placed);
    const header = { name: 'head', blockId: 'test.summary', config: {} };
    expect(withPlacedBlocks({ header, tabs }, [block('summary', { placement: 'overview' })], person)).toBe(tabs);
  });

  it("only places a block on the objects' pages it names", () => {
    const summary = block('summary', { placement: 'overview', objectIds: ['fixture.company'] });
    expect(withPlacedBlocks({ tabs }, [summary], person)).toBe(tabs);
    expect(shape(withPlacedBlocks({ tabs }, [summary], { id: 'fixture.company' }))[0]).toBe(
      'overview: core.fields, test.summary "Summary"',
    );
  });
});

describe('withPlacedCells', () => {
  const cell = (name: string, block = `test.${name}`) => ({ name, blockId: block });
  const main = [cell('title'), cell('offer'), cell('notes')];
  const blocks = [block('quotes', { placement: 'main', after: 'test.offer' })];

  it('puts a block that places itself in the main column right after the block it names', () => {
    const placed = withPlacedCells(main, 'main', main, blocks, person);
    expect(placed.map((item) => item.name)).toEqual(['title', 'offer', 'test.quotes', 'notes']);
    // A bare page names the section by its cell's label: the block's own.
    expect(placed[2]).toMatchObject({ blockId: 'test.quotes', label: 'Quotes' });
  });

  it('goes at the end when the block it follows is not on the page, or it names none', () => {
    const end = (after?: string) =>
      withPlacedCells(main, 'main', main, [block('quotes', { placement: 'main', ...(after ? { after } : {}) })], person)
        .map((item) => item.name)
        .at(-1);
    expect(end('test.gone')).toBe('test.quotes');
    expect(end()).toBe('test.quotes');
  });

  it('keeps main and aside apart, and leaves a block the layout places, or for other objects, alone', () => {
    const aside = [cell('facts')];
    const all = [...main, ...aside];
    expect(withPlacedCells(aside, 'aside', all, blocks, person)).toEqual(aside);
    expect(withPlacedCells(main, 'main', [...main, cell('quotes', 'test.quotes')], blocks, person)).toEqual(main);
    const other = [block('quotes', { placement: 'main', objectIds: ['fixture.company'] })];
    expect(withPlacedCells(main, 'main', main, other, person)).toEqual(main);
    expect(
      withPlacedCells(aside, 'aside', all, [block('card', { placement: 'aside' })], person).map((i) => i.name),
    ).toEqual(['facts', 'test.card']);
  });
});
