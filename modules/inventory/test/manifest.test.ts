import { idListOf, parseManifest } from '@devias/core';
import { manifest as crm } from '@devias/mod-crm/manifest';
import { manifest as products } from '@devias/mod-products/manifest';
import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { inventory } from '../src/server';

describe('inventory manifest', () => {
  it('parses, and every id is unique and owned by the module', () => {
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
    expect(ids.every((id) => id.startsWith(`${manifest.id}.`))).toBe(true);
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
});

describe('inventory ids', () => {
  it('are the ones installed workspaces store', () => {
    expect(idListOf(manifest).sort()).toMatchInlineSnapshot(`
      [
        "inventory.count",
        "inventory.counts",
        "inventory.go_to_inventory",
        "inventory.inventory",
        "inventory.location",
        "inventory.location.address",
        "inventory.location.all",
        "inventory.location.kind",
        "inventory.location.name",
        "inventory.location.notes",
        "inventory.locations",
        "inventory.low_stock",
        "inventory.new_stock_move",
        "inventory.product.reorder_point",
        "inventory.product.tracked",
        "inventory.product_stock",
        "inventory.stock_move",
        "inventory.stock_move.all",
        "inventory.stock_move.deal",
        "inventory.stock_move.direction",
        "inventory.stock_move.location",
        "inventory.stock_move.moved_on",
        "inventory.stock_move.product",
        "inventory.stock_move.quantity",
        "inventory.stock_move.reason",
        "inventory.stock_move.reference",
        "inventory.stock_move.supplier",
        "inventory.stock_move.unit_cost",
        "inventory.stock_moves",
        "inventory.stock_on_hand",
        "inventory.transfer",
      ]
    `);
  });
});
