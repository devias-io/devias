import { idListOf, isUuid, parseManifest } from '@devias/core';
import { manifest as crm } from '@devias/mod-crm/manifest';
import { manifest as products } from '@devias/mod-products/manifest';
import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { ids } from '../src/manifest/ids';
import inventory from '../src/server';

describe('inventory manifest', () => {
  it('parses, and every id is a unique uuid', () => {
    const parsed = parseManifest(manifest);
    const ids = [
      ...parsed.objects.map((object) => object.id),
      ...parsed.objects.flatMap((object) => object.fields.map((field) => field.id)),
      ...parsed.fields.map((field) => field.id),
      ...parsed.views.map((view) => view.id),
      ...parsed.navItems.map((item) => item.id),
      ...parsed.commandItems.map((item) => item.id),
      ...parsed.blocks.map((block) => block.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isUuid)).toBe(true);
  });

  it("relates only to its own objects, the CRM's and Products', and adds its stock fields to the product", () => {
    const known = new Set([...crm.objects, ...products.objects, ...manifest.objects].map((object) => object.id));
    const relations = manifest.objects.flatMap((object) => object.fields.filter((field) => field.type === 'relation'));

    for (const field of relations) {
      const target = (field.settings as { targetObjectId?: string }).targetObjectId ?? '';
      expect(known.has(target), `${field.name} → ${target}`).toBe(true);
    }

    const product = products.objects.find((object) => object.nameSingular === 'product')?.id;
    expect(parseManifest(manifest).fields.map((field) => [field.objectId, field.name])).toEqual([
      [product, 'tracked'],
      [product, 'reorder_point'],
    ]);
  });

  it('implements every action it declares on the server', () => {
    expect(inventory.actions.map((action) => action.id).sort()).toEqual(
      manifest.actions.map((action) => action.id).sort(),
    );
  });

  it('names its actions apart from their ids, so each stands alone as a tool', () => {
    expect(manifest.actions.map((action) => [action.id, action.name])).toEqual([
      [ids.actions.stock_on_hand, 'stock_on_hand'],
      [ids.actions.transfer, 'transfer_stock'],
      [ids.actions.count, 'count_stock'],
    ]);
  });
});

describe('inventory ids', () => {
  it('are the ones installed workspaces store', () => {
    expect(idListOf(manifest).sort()).toMatchInlineSnapshot(`
      [
        "01a17356-5c6c-76d4-aa86-184166532ca0",
        "01a17356-5c6c-76d4-aa86-1d0e8d9f8e06",
        "01a17356-5c6c-76d4-aa86-22c0ae4d5cee",
        "01a17356-5c6c-76d4-aa86-2408b5f3a7d6",
        "01a17356-5c6c-76d4-aa86-2abdb0daa9e6",
        "01a17356-5c6c-76d4-aa86-2fd728edb85a",
        "01a17356-5c6c-76d4-aa86-314cdd21fce6",
        "01a17356-5c6c-76d4-aa86-36d8c315bdda",
        "01a17356-5c6c-76d4-aa86-3b072d25f2e9",
        "01a17356-5c6c-76d4-aa86-3e3684c5fb52",
        "01a17356-5c6c-76d4-aa86-43c8f1370fcf",
        "01a17356-5c6c-76d4-aa86-44d94b9655e7",
        "01a17356-5c6c-76d4-aa86-4a02d643df47",
        "01a17356-5c6c-76d4-aa86-4f0a8a302d55",
        "01a17356-5c6c-76d4-aa86-50f6b2469f68",
        "01a17356-5c6c-76d4-aa86-5571f7eb3086",
        "01a17356-5c6c-76d4-aa86-596eac9be506",
        "01a17356-5c6c-76d4-aa86-5c3e39e7b7aa",
        "01a17356-5c6c-76d4-aa86-62b1dbefbcbd",
        "01a17356-5c6c-76d4-aa86-662252eedd05",
        "01a17356-5c6c-76d4-aa86-6ab17bfa0913",
        "01a17356-5c6c-76d4-aa86-6fdfb56492c5",
        "01a17356-5c6c-76d4-aa86-73d48c218736",
        "01a17356-5c6c-76d4-aa86-7625140fdfc8",
        "01a17356-5c6c-76d4-aa86-79b33e5c1ddc",
        "01a17356-5c6c-76d4-aa86-7fbc7895d31f",
        "01a17356-5c6c-76d4-aa86-822c4451d360",
        "01a17356-5c6c-76d4-aa86-86955aaa87c9",
        "01a17356-5c6c-76d4-aa86-8adb80d5eec8",
        "01a17356-5c6c-76d4-aa86-8c88336ac9a8",
        "01a17356-5c6c-76d4-aa86-906d79c9f1ed",
      ]
    `);
  });
});
