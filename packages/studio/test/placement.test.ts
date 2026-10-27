import type { BlockDefinition, LayoutBlock, LayoutTab, RecordSurface } from '@devias/core';
import { coreIds } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { withPlacedBlocks, withPlacedCells } from '../src/record/placement';

const blockIds = {
  fields: '01a17522-1eb7-7744-b55d-7c1a0e5b3d21',
  activity: '01a17522-1eb7-7744-b55d-88a55445c802',
  card: '01a17522-1eb7-7744-b55d-8203f6c91a4b',
  gone: '01a17522-1eb7-7744-b55d-85d9b2e7f0c6',
  mentions: '01a17522-1eb7-7744-b55d-8b6e4a2c91d3',
  offer: '01a17522-1eb7-7744-b55d-9a0c3d7e5f12',
  quotes: '01a17522-1eb7-7744-b55d-918918817223',
  summary: '01a17522-1eb7-7744-b55d-8e8c0da7352f',
  facts: '01a17522-1eb7-7744-b55d-a1d4c6e8f203',
  notes: '01a17522-1eb7-7744-b55d-a5f7b9d1e304',
  title: '01a17522-1eb7-7744-b55d-aa08c2e4f405',
} as const;

const block = (name: keyof typeof blockIds, record: RecordSurface = {}): BlockDefinition => ({
  id: blockIds[name],
  label: name[0]?.toUpperCase() + name.slice(1),
  icon: 'file',
  surfaces: { record },
  component: () => null,
});

const person = { id: '01a1751f-5f09-7114-9d75-bebf2c7785e8' };

const tabs: LayoutTab[] = [
  { name: 'overview', label: 'Overview', blocks: [{ name: 'details', blockId: coreIds.blocks.fields, config: {} }] },
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
      `overview: ${coreIds.blocks.fields}, ${blockIds.mentions} "Mentions"`,
      'more: ',
      `${blockIds.activity}: ${blockIds.activity}`,
    ]);
    expect(result[0]?.blocks[1]).toMatchObject({ name: blockIds.mentions, columnSpan: 6 });
    expect(result.at(-1)).toMatchObject({ name: blockIds.activity, label: 'Activity', icon: 'file' });
  });

  it('puts overview blocks at the end of the first tab when no tab is called overview', () => {
    expect(
      shape(
        withPlacedBlocks({ tabs: [deals, ...tabs.slice(1)] }, [block('mentions', { placement: 'overview' })], person),
      ),
    ).toEqual([`deals: ${blockIds.mentions} "Mentions"`, 'more: ']);
  });

  it('starts an Overview tab when the layout has no tabs', () => {
    expect(shape(withPlacedBlocks({ tabs: [] }, [block('mentions', { placement: 'overview' })], person))).toEqual([
      `overview: ${blockIds.mentions} "Mentions"`,
    ]);
  });

  it('leaves blocks the layout places, in its tabs or as its header, where the layout puts them', () => {
    const placed: LayoutTab[] = [
      ...tabs,
      { name: 'history', label: 'History', blocks: [{ name: 'log', blockId: blockIds.activity, config: {} }] },
    ];
    expect(withPlacedBlocks({ tabs: placed }, [block('activity', { placement: 'tab' })], person)).toBe(placed);
    const header = { name: 'head', blockId: blockIds.summary, config: {} };
    expect(withPlacedBlocks({ header, tabs }, [block('summary', { placement: 'overview' })], person)).toBe(tabs);
  });

  it("only places a block on the objects' pages it names", () => {
    const summary = block('summary', { placement: 'overview', objectIds: ['01a1751f-5f09-7114-9d75-c6298b7cb4b3'] });
    expect(withPlacedBlocks({ tabs }, [summary], person)).toBe(tabs);
    expect(shape(withPlacedBlocks({ tabs }, [summary], { id: '01a1751f-5f09-7114-9d75-c6298b7cb4b3' }))[0]).toBe(
      `overview: ${coreIds.blocks.fields}, ${blockIds.summary} "Summary"`,
    );
  });
});

describe('withPlacedCells', () => {
  const cell = (name: keyof typeof blockIds, block = blockIds[name]) => ({ name, blockId: block });
  const main = [cell('title'), cell('offer'), cell('notes')];
  const blocks = [block('quotes', { placement: 'main', after: blockIds.offer })];

  it('puts a block that places itself in the main column right after the block it names', () => {
    const placed = withPlacedCells(main, 'main', main, blocks, person);
    expect(placed.map((item) => item.name)).toEqual(['title', 'offer', blockIds.quotes, 'notes']);
    // A bare page names the section by its cell's label: the block's own.
    expect(placed[2]).toMatchObject({ blockId: blockIds.quotes, label: 'Quotes' });
  });

  it('goes at the end when the block it follows is not on the page, or it names none', () => {
    const end = (after?: string) =>
      withPlacedCells(main, 'main', main, [block('quotes', { placement: 'main', ...(after ? { after } : {}) })], person)
        .map((item) => item.name)
        .at(-1);
    expect(end(blockIds.gone)).toBe(blockIds.quotes);
    expect(end()).toBe(blockIds.quotes);
  });

  it('keeps main and aside apart, and leaves a block the layout places, or for other objects, alone', () => {
    const aside = [cell('facts')];
    const all = [...main, ...aside];
    expect(withPlacedCells(aside, 'aside', all, blocks, person)).toEqual(aside);
    expect(withPlacedCells(main, 'main', [...main, cell('quotes', blockIds.quotes)], blocks, person)).toEqual(main);
    const other = [block('quotes', { placement: 'main', objectIds: ['01a1751f-5f09-7114-9d75-c6298b7cb4b3'] })];
    expect(withPlacedCells(main, 'main', main, other, person)).toEqual(main);
    expect(
      withPlacedCells(aside, 'aside', all, [block('card', { placement: 'aside' })], person).map((i) => i.name),
    ).toEqual(['facts', blockIds.card]);
  });
});
