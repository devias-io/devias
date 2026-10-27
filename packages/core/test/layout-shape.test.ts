import { describe, expect, it } from 'vitest';
import {
  availableBlocks,
  blockRefProblem,
  layoutCells,
  layoutContentOf,
  layoutShapeProblem,
  makeLayout,
  mergeLayoutPatch,
  parseLayoutContent,
  parseManifest,
  type RecordShell,
} from '../src';
import { coreIds } from '../src/core-ids';

const cell = (name: string) => ({ name, blockId: coreIds.blocks.fields, config: {} });
const tab = (name: string, ...names: string[]) => ({ name, label: name, blocks: names.map(cell) });

describe('layoutShapeProblem', () => {
  it('accepts each shape with exactly its own keys', () => {
    expect(layoutShapeProblem({ shell: 'tabs', tabs: [] })).toBeUndefined();
    expect(layoutShapeProblem({ shell: 'tabs', header: cell('h'), tabs: [tab('a')] })).toBeUndefined();
    expect(layoutShapeProblem({ shell: 'column', blocks: [] })).toBeUndefined();
    expect(layoutShapeProblem({ shell: 'split', main: [] })).toBeUndefined();
    expect(layoutShapeProblem({ shell: 'split', main: [], aside: [cell('x')] })).toBeUndefined();
  });

  it('names what a shape needs', () => {
    expect(layoutShapeProblem({ shell: 'tabs' })).toBe('A "tabs" layout is a `header` and `tabs`: it needs `tabs`');
    expect(layoutShapeProblem({ shell: 'column' })).toBe(
      'A "column" layout is one list of `blocks`: it needs `blocks`',
    );
    expect(layoutShapeProblem({ shell: 'split', aside: [] })).toContain('it needs `main`');
  });

  it('refuses the keys of another shape, and says whose they are', () => {
    expect(layoutShapeProblem({ shell: 'column', blocks: [], tabs: [] })).toBe(
      'A "column" layout is one list of `blocks`, so it has no `tabs` (that is the "tabs" shape)',
    );
    expect(layoutShapeProblem({ shell: 'split', main: [], blocks: [], header: cell('h') })).toContain(
      'no `header`, `blocks`',
    );
    expect(layoutShapeProblem({ shell: 'tabs', tabs: [], aside: [] })).toContain('(that is the "split" shape)');
  });

  it('refuses two cells with one name, whatever blocks they hold', () => {
    expect(layoutShapeProblem({ shell: 'column', blocks: [cell('a'), cell('a')] })).toBe(
      'Two cells of this layout are called "a": give each cell a `name` of its own',
    );
    expect(layoutShapeProblem({ shell: 'tabs', tabs: [tab('x', 'a'), tab('y', 'a')] })).toContain('called "a"');
    expect(layoutShapeProblem({ shell: 'column', blocks: [cell('a'), cell('b')] })).toBeUndefined();
  });
});

describe('layout content', () => {
  it('keeps only what the shape takes, with defaults', () => {
    expect(layoutContentOf({ shell: 'split', main: [cell('m')] })).toEqual({ main: [cell('m')], aside: [] });
    expect(layoutContentOf({ shell: 'tabs', tabs: [tab('a')] })).toEqual({ tabs: [tab('a')] });
    expect(layoutContentOf({ shell: 'column', blocks: [cell('b')], tabs: [tab('x')] })).toEqual({
      blocks: [cell('b')],
    });
  });

  it('builds a layout of a shape from what is stored for it', () => {
    const base = {
      workspaceId: 'w',
      objectId: 'o',
      id: 'workspace.x',
      label: 'X',
      kind: 'record' as const,
      isDefault: true,
      actions: [],
      moduleId: null,
    };
    const split = makeLayout(base, 'split', { main: [cell('m')] });
    expect(split.shell === 'split' ? split.aside : null).toEqual([]);
    expect(makeLayout(base, 'column', { blocks: [] })).not.toHaveProperty('tabs');
    expect(() => makeLayout(base, 'tabs', { blocks: [] })).toThrow();
  });

  it('needs every cell to have a name, platform blocks included, and does not make one up', () => {
    const nameless = { blockId: coreIds.blocks.comments };
    expect(() => parseLayoutContent('split', { main: [nameless] })).toThrow(/name/);
    expect(() => parseLayoutContent('column', { blocks: [nameless] })).toThrow(/name/);
    expect(() => parseLayoutContent('tabs', { header: nameless, tabs: [] })).toThrow(/name/);
    expect(() =>
      parseLayoutContent('tabs', { tabs: [tab('a'), { name: 'b', label: 'b', blocks: [nameless] }] }),
    ).toThrow(/name/);
    // A label stays optional: a cell without one has no heading.
    expect(parseLayoutContent('column', { blocks: [{ name: 'comments', blockId: coreIds.blocks.comments }] })).toEqual({
      blocks: [{ name: 'comments', blockId: coreIds.blocks.comments }],
    });
  });

  it('lists every cell in the order the page draws them, with where it sits', () => {
    const where = (layout: Parameters<typeof layoutCells>[0]) =>
      layoutCells(layout).map((at) => `${at.where}: ${at.cell.name}`);
    expect(where({ shell: 'tabs', header: cell('h'), tabs: [tab('a', 'x'), tab('b', 'y')] })).toEqual([
      'Header: h',
      'Tab "a": x',
      'Tab "b": y',
    ]);
    expect(where({ shell: 'column', blocks: [cell('c')] })).toEqual(['Blocks: c']);
    expect(where({ shell: 'split', main: [cell('m')], aside: [cell('a')] })).toEqual(['Main: m', 'Aside: a']);
  });
});

describe('mergeLayoutPatch', () => {
  const current = {
    objectId: 'o',
    label: 'Note',
    isDefault: true,
    shell: 'split' as RecordShell,
    actions: [],
    main: [cell('m')],
    aside: [cell('a')],
  };

  it('keeps what the patch leaves out, and changes what it brings', () => {
    const merged = mergeLayoutPatch(current, { label: 'Renamed', aside: [] });
    expect(merged).toMatchObject({ label: 'Renamed', shell: 'split', main: [cell('m')], aside: [] });
    expect(layoutShapeProblem(merged)).toBeUndefined();
  });

  it('drops the old shape’s content when the shell changes, and leaves stray keys for the check to refuse', () => {
    const merged = mergeLayoutPatch(current, { shell: 'column', blocks: [cell('b')] });
    expect(merged).toMatchObject({ shell: 'column', blocks: [cell('b')] });
    expect(merged).not.toHaveProperty('main');
    expect(layoutShapeProblem(merged)).toBeUndefined();
    // Without the new content, it is the new shape's missing key that is named.
    expect(layoutShapeProblem(mergeLayoutPatch(current, { shell: 'column' }))).toContain('needs `blocks`');
    // A key of another shape is kept in the merge so the check can name it.
    expect(layoutShapeProblem(mergeLayoutPatch(current, { tabs: [] }))).toContain('no `tabs`');
  });
});

describe('a manifest’s layouts', () => {
  const layout = (extra: Record<string, unknown>) => ({
    id: '01a1751f-5f12-7042-ae38-db53b240b66d',
    objectId: '01a1751f-5f12-7042-ae38-df2b08218bc3',
    label: 'A',
    ...extra,
  });
  const parse = (extra: Record<string, unknown>) =>
    parseManifest({ id: '01a1751f-5f11-731b-b87a-359da5e6aabd', version: '1.0.0', layouts: [layout(extra)] });

  it('are one of three shapes, each with exactly its own keys', () => {
    expect(() => parse({ shell: 'tabs', tabs: [] })).not.toThrow();
    expect(() => parse({ shell: 'column', blocks: [] })).not.toThrow();
    expect(() => parse({ shell: 'split', main: [] })).not.toThrow();
    expect(() => parse({ shell: 'column', blocks: [], tabs: [] })).toThrow();
    expect(() => parse({ shell: 'split', tabs: [] })).toThrow();
    expect(() => parse({ tabs: [] })).toThrow();
    expect(() => parse({ shell: 'record', tabs: [] })).toThrow();
  });
});

describe('an optional cell', () => {
  const available = availableBlocks([]);

  it('may name a block that is not there, where a plain cell may not', () => {
    expect(blockRefProblem('01a1751f-5f12-7042-ae38-e3b8d818b5f0', available)).toContain('Unknown block');
    expect(blockRefProblem('01a1751f-5f12-7042-ae38-e3b8d818b5f0', available, null, true)).toBeUndefined();
  });

  it('is a flag of the cell, kept as written', () => {
    const manifest = parseManifest({
      id: '01a1751f-5f11-731b-b87a-359da5e6aabd',
      version: '1.0.0',
      layouts: [
        {
          id: '01a1751f-5f12-7042-ae38-db53b240b66d',
          objectId: '01a1751f-5f12-7042-ae38-df2b08218bc3',
          label: 'A',
          shell: 'column',
          blocks: [{ name: 'q', blockId: '01a1751f-5f12-7042-ae38-e3b8d818b5f0', optional: true }],
        },
      ],
    });
    expect(layoutCells(manifest.layouts[0] as never)[0]?.cell.optional).toBe(true);
  });
});
