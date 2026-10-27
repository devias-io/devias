import { coreIds, idListOf, isUuid, layoutCells, parseManifest } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';

describe('products manifest', () => {
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

  it('depends on no other module: its relations point only at its own objects', () => {
    const known = new Set(manifest.objects.map((object) => object.id));

    for (const object of manifest.objects) {
      for (const field of object.fields.filter((candidate) => candidate.type === 'relation')) {
        const target = (field.settings as { targetObjectId?: string }).targetObjectId ?? '';
        expect(known.has(target), `${object.nameSingular}.${field.name} → ${target}`).toBe(true);
      }
    }
  });

  it('removes a product’s prices with it, and keeps a price’s lookup key unique', () => {
    const price = manifest.objects.find((object) => object.nameSingular === 'price');
    const product = price?.fields.find((field) => field.name === 'product');
    expect(product?.settings).toMatchObject({ onDelete: 'cascade' });
    expect(price?.fields.find((field) => field.name === 'lookup_key')?.isUnique).toBe(true);
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

    expect(manifest.navItems.map((item) => [item.label, item.parentId])).toEqual([['Products', undefined]]);
  });
});

describe('products ids', () => {
  it('are the ones installed workspaces store', () => {
    expect(idListOf(manifest).sort()).toMatchInlineSnapshot(`
      [
        "01a17356-5c6d-765a-82b1-8c25f7a727c2",
        "01a17356-5c6d-765a-82b1-9365f2abe679",
        "01a17356-5c6d-765a-82b1-95e006171d3a",
        "01a17356-5c6d-765a-82b1-9a0e51db328f",
        "01a17356-5c6d-765a-82b1-9e0e63227d97",
        "01a17356-5c6d-765a-82b1-a3450d888269",
        "01a17356-5c6d-765a-82b1-a473c1ef8875",
        "01a17356-5c6d-765a-82b1-a942feabdd47",
        "01a17356-5c6d-765a-82b1-afc945bb50c9",
        "01a17356-5c6d-765a-82b1-b019e7050eac",
        "01a17356-5c6d-765a-82b1-b47404f0ebc9",
        "01a17356-5c6d-765a-82b1-b91ea183c4fd",
        "01a17356-5c6d-765a-82b1-bdc0ccc432ef",
        "01a17356-5c6d-765a-82b1-c063adb14ba3",
        "01a17356-5c6d-765a-82b1-c428bbbf96e2",
        "01a17356-5c6d-765a-82b1-c8aca5cd79c8",
        "01a17356-5c6d-765a-82b1-cdbd56266012",
        "01a17356-5c6d-765a-82b1-d347c39d1d9d",
        "01a17356-5c6d-765a-82b1-d5065ea56622",
        "01a17356-5c6d-765a-82b1-d9b3c5b5d220",
        "01a17356-5c6d-765a-82b1-ddcf6e122f0e",
        "01a17356-5c6d-765a-82b1-e37069c5da2d",
        "01a17356-5c6d-765a-82b1-e435b1cc1269",
        "01a17356-5c6d-765a-82b1-e80f41664405",
        "01a17356-5c6d-765a-82b1-ed45210619b1",
        "01a17356-5c6d-765a-82b1-f2358ce1e467",
        "01a17356-5c6d-765a-82b1-f412c4cccb13",
        "01a17356-5c6d-765a-82b1-f8598e42f1bd",
        "01a17356-5c6d-765a-82b1-fcc4e0e2567c",
        "01a17356-5c6d-765a-82b2-02e88298df69",
      ]
    `);
  });
});
