import { coreIds, idListOf, isUuid, layoutCells, parseManifest } from '@devias/core';
import { manifest as crm } from '@devias/mod-crm/manifest';
import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { ids } from '../src/manifest/ids';
import quotes from '../src/server';

describe('quotes manifest', () => {
  it('parses, and every id is a unique uuid', () => {
    const parsed = parseManifest(manifest);
    const ids = [
      ...parsed.objects.map((object) => object.id),
      ...parsed.objects.flatMap((object) => object.fields.map((field) => field.id)),
      ...parsed.views.map((view) => view.id),
      ...parsed.layouts.map((layout) => layout.id),
      ...parsed.navItems.map((item) => item.id),
      ...parsed.commandItems.map((item) => item.id),
      ...parsed.blocks.map((block) => block.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isUuid)).toBe(true);
  });

  it('relates only to its own objects and the CRM’s deals and companies', () => {
    const known = new Set([
      ...manifest.objects.map((object) => object.id),
      ...crm.objects.filter((object) => ['deal', 'company'].includes(object.nameSingular)).map((o) => o.id),
    ]);

    for (const object of manifest.objects) {
      for (const field of object.fields.filter((candidate) => candidate.type === 'relation')) {
        const target = (field.settings as { targetObjectId?: string }).targetObjectId ?? '';
        expect(known.has(target), `${object.nameSingular}.${field.name} → ${target}`).toBe(true);
      }
    }
  });

  it('places only blocks it declares or the studio ships, and has a row of its own in the sidebar', () => {
    const blocks = new Set([
      coreIds.blocks.fields,
      coreIds.blocks.title,
      coreIds.blocks.comments,
      coreIds.blocks.activity,
      ...manifest.blocks.map((block) => block.id),
    ]);

    for (const layout of manifest.layouts) {
      for (const { cell } of layoutCells(layout)) {
        expect(blocks.has(cell.blockId), cell.blockId).toBe(true);
      }
    }

    expect(manifest.navItems.map((item) => [item.label, item.parentId])).toEqual([['Quotes', undefined]]);
  });

  it('takes a quote on its record page for its one action, which the server implements', () => {
    const action = manifest.actions.find((candidate) => candidate.name === 'recalculate_quote');
    const quote = manifest.objects.find((object) => object.nameSingular === 'quote')?.id;
    expect(action?.input[0]).toMatchObject({ name: 'quote_id', type: 'record', objectId: quote });
    expect(manifest.actions).toHaveLength(1);
    expect(quotes.actions.map((handler) => handler.id)).toEqual([ids.actions.recalculate_quote]);
  });

  it('names its action apart from its id', () => {
    expect(manifest.actions.map((action) => [action.id, action.name])).toEqual([
      [ids.actions.recalculate_quote, 'recalculate_quote'],
    ]);
  });
});

describe('quotes ids', () => {
  it('are the ones installed workspaces store', () => {
    expect(idListOf(manifest).sort()).toMatchInlineSnapshot(`
      [
        "01a17356-5c6d-765a-82b2-067efe9f82a4",
        "01a17356-5c6d-765a-82b2-090990f2ee1c",
        "01a17356-5c6d-765a-82b2-0d6dec623df1",
        "01a17356-5c6d-765a-82b2-12f0382cc4f1",
        "01a17356-5c6d-765a-82b2-178b431c1cbb",
        "01a17356-5c6d-765a-82b2-18ee42b9d88e",
        "01a17356-5c6d-765a-82b2-1f68a249656f",
        "01a17356-5c6d-765a-82b2-2040d8993903",
        "01a17356-5c6d-765a-82b2-256670a22c46",
        "01a17356-5c6d-765a-82b2-29d1748c8748",
        "01a17356-5c6d-765a-82b2-2c3e344f80d0",
        "01a17356-5c6d-765a-82b2-329f1ad7f64b",
        "01a17356-5c6d-765a-82b2-357605cadb34",
        "01a17356-5c6d-765a-82b2-3ad226c6a8ff",
        "01a17356-5c6d-765a-82b2-3e09c1420a6c",
        "01a17356-5c6d-765a-82b2-405c56da9796",
        "01a17356-5c6d-765a-82b2-441413149dee",
        "01a17356-5c6d-765a-82b2-4831306b6dc7",
        "01a17356-5c6d-765a-82b2-4c27fa2dc89b",
        "01a17356-5c6d-765a-82b2-53c107100dcb",
        "01a17356-5c6d-765a-82b2-554bb0ddabcd",
        "01a17356-5c6d-765a-82b2-5b8f8f2768a7",
        "01a17356-5c6d-765a-82b2-5c9e186de6db",
      ]
    `);
  });
});
