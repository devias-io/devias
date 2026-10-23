import { coreIds, idListOf, layoutCells, parseManifest } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';

describe('products manifest', () => {
  it('parses, and every id is unique and owned by the module', () => {
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
    expect(ids.every((id) => id.startsWith(`${manifest.id}.`))).toBe(true);
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
        "products.new_product",
        "products.price",
        "products.price.active",
        "products.price.all",
        "products.price.amount",
        "products.price.currency",
        "products.price.interval",
        "products.price.interval_count",
        "products.price.lookup_key",
        "products.price.nickname",
        "products.price.product",
        "products.price.tax_behavior",
        "products.price.type",
        "products.product",
        "products.product.active",
        "products.product.all",
        "products.product.default",
        "products.product.default_price",
        "products.product.description",
        "products.product.goods",
        "products.product.images",
        "products.product.kind",
        "products.product.name",
        "products.product.services",
        "products.product.sku",
        "products.product.unit",
        "products.product_description",
        "products.product_images",
        "products.product_prices",
        "products.products",
      ]
    `);
  });
});
