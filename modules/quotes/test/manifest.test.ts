import { coreIds, idListOf, keyOfId, layoutCells, parseManifest } from '@devias/core';
import { manifest as crm } from '@devias/mod-crm/manifest';
import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { quotes } from '../src/server';

describe('quotes manifest', () => {
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
    const action = manifest.actions.find((candidate) => keyOfId(candidate.id) === 'recalculate_quote');
    const quote = manifest.objects.find((object) => object.nameSingular === 'quote')?.id;
    expect(action?.input[0]).toMatchObject({ name: 'quote_id', type: 'record', objectId: quote });
    expect(manifest.actions).toHaveLength(1);
    expect(quotes.actions.map((handler) => handler.id)).toEqual(['quotes.recalculate_quote']);
  });
});

describe('quotes ids', () => {
  it('are the ones installed workspaces store', () => {
    expect(idListOf(manifest).sort()).toMatchInlineSnapshot(`
      [
        "quotes.deal_quotes",
        "quotes.new_quote",
        "quotes.quote",
        "quotes.quote.all",
        "quotes.quote.awaiting_answer",
        "quotes.quote.company",
        "quotes.quote.deal",
        "quotes.quote.default",
        "quotes.quote.notes",
        "quotes.quote.number",
        "quotes.quote.status",
        "quotes.quote.title",
        "quotes.quote.total",
        "quotes.quote.valid_until",
        "quotes.quote_item",
        "quotes.quote_item.all",
        "quotes.quote_item.description",
        "quotes.quote_item.quantity",
        "quotes.quote_item.quote",
        "quotes.quote_item.unit_price",
        "quotes.quote_items",
        "quotes.quotes",
        "quotes.recalculate_quote",
      ]
    `);
  });
});
