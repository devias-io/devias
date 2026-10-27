import { coreIds, idListOf, isUuid, layoutCells, parseManifest } from '@devias/core';
import { manifest as crm } from '@devias/mod-crm/manifest';
import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { ids } from '../src/manifest/ids';
import invoicing from '../src/server';

const relationFields = manifest.objects.flatMap((object) =>
  object.fields.filter((field) => field.type === 'relation').map((field) => ({ object: object.nameSingular, field })),
);

describe('invoicing manifest', () => {
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

  it('puts Overview, Invoices and Payments under one Billing section in the sidebar', () => {
    const parsed = parseManifest(manifest);
    const group = parsed.navItems.find((item) => item.label === 'Billing');
    const rows = parsed.navItems.filter((item) => item.parentId === group?.id);
    expect(rows.map((item) => item.label)).toEqual(['Overview', 'Invoices', 'Payments']);
    expect(rows.find((item) => item.label === 'Payments')?.target).toEqual({
      kind: 'object',
      objectId: ids.objects.payment,
    });
  });

  it('relates only to its own objects and the CRM', () => {
    const known = new Set([...crm.objects, ...manifest.objects].map((object) => object.id));
    expect(relationFields.length).toBeGreaterThan(0);

    for (const { field } of relationFields) {
      const target = (field.settings as { targetObjectId?: string }).targetObjectId;
      expect(known.has(target ?? ''), `${field.name} → ${target}`).toBe(true);
    }
  });

  it('places only blocks it declares or the studio ships, on fields its objects have', () => {
    const blocks = new Set([
      coreIds.blocks.fields,
      coreIds.blocks.related_records,
      coreIds.blocks.activity,
      coreIds.blocks.comments,
      ...manifest.blocks.map((b) => b.id),
    ]);
    const fieldIdsOf = new Map(manifest.objects.map((object) => [object.id, object.fields.map((f) => f.id)]));

    for (const layout of manifest.layouts) {
      const fieldIds = fieldIdsOf.get(layout.objectId) ?? [];

      for (const { cell } of layoutCells(layout)) {
        expect(blocks.has(cell.blockId), cell.blockId).toBe(true);

        if (cell.blockId === coreIds.blocks.fields) {
          for (const id of (cell.config as { fieldIds: string[] }).fieldIds) {
            expect(fieldIds).toContain(id);
          }
        }
      }
    }

    for (const view of manifest.views) {
      const fieldIds = fieldIdsOf.get(view.objectId) ?? [];

      for (const column of view.fields ?? []) {
        expect(fieldIds, `${view.label}.${column.fieldId}`).toContain(column.fieldId);
      }
    }
  });

  it('implements every action it declares on the server', () => {
    expect(invoicing.actions.map((action) => action.id).sort()).toEqual(
      manifest.actions.map((action) => action.id).sort(),
    );
    expect(manifest.actions.every((action) => action.external === false)).toBe(true);
  });

  it('names its actions apart from their ids', () => {
    expect(manifest.actions.map((action) => [action.id, action.name])).toEqual([
      [ids.actions.recalculate_invoice, 'recalculate_invoice'],
      [ids.actions.add_payment, 'add_payment'],
    ]);
  });
});

describe('invoicing ids', () => {
  it('are the ones installed workspaces store', () => {
    expect(idListOf(manifest).sort()).toMatchInlineSnapshot(`
      [
        "01a17356-5c6c-76d4-aa86-978b865606c1",
        "01a17356-5c6c-76d4-aa86-9b883fa26f0d",
        "01a17356-5c6c-76d4-aa86-9ed6e20902ff",
        "01a17356-5c6c-76d4-aa86-a3cd3149c450",
        "01a17356-5c6c-76d4-aa86-a6c2e32ad42d",
        "01a17356-5c6c-76d4-aa86-a8ada77bd9b4",
        "01a17356-5c6c-76d4-aa86-ae5635119d6c",
        "01a17356-5c6c-76d4-aa86-b1b48af2638e",
        "01a17356-5c6c-76d4-aa86-b41d20d34ede",
        "01a17356-5c6c-76d4-aa86-b8db0db32253",
        "01a17356-5c6c-76d4-aa86-bd4b9d44ddb1",
        "01a17356-5c6c-76d4-aa86-c1d93cf2f2e7",
        "01a17356-5c6c-76d4-aa86-c59066b59374",
        "01a17356-5c6c-76d4-aa86-c80b50d2c4d8",
        "01a17356-5c6c-76d4-aa86-cc1a9046986d",
        "01a17356-5c6c-76d4-aa86-d22afc6d856d",
        "01a17356-5c6c-76d4-aa86-d535e3951299",
        "01a17356-5c6c-76d4-aa86-d8b798067adc",
        "01a17356-5c6c-76d4-aa86-dfbb2a48a56e",
        "01a17356-5c6c-76d4-aa86-e2f7b6c058f5",
        "01a17356-5c6c-76d4-aa86-e7aec2ae1a39",
        "01a17356-5c6c-76d4-aa86-ea34da9ba72c",
        "01a17356-5c6c-76d4-aa86-eff9aa9d9c25",
        "01a17356-5c6c-76d4-aa86-f2ae4cd95396",
        "01a17356-5c6c-76d4-aa86-f49125fa29b4",
        "01a17356-5c6c-76d4-aa86-fa78614813bc",
        "01a17356-5c6c-76d4-aa86-fdc3e5eed686",
        "01a17356-5c6c-76d4-aa87-0178e83ed86c",
        "01a17356-5c6c-76d4-aa87-071b2363b727",
        "01a17356-5c6c-76d4-aa87-0bc40070e83b",
        "01a17356-5c6c-76d4-aa87-0cd64cecba19",
        "01a17356-5c6c-76d4-aa87-10661300be8d",
        "01a17356-5c6c-76d4-aa87-1471400f3f68",
        "01a17356-5c6c-76d4-aa87-198c82565045",
        "01a17356-5c6c-76d4-aa87-1f65a6633f69",
        "01a17356-5c6c-76d4-aa87-23cfd35db538",
        "01a17356-5c6c-76d4-aa87-262a78fe720a",
        "01a17356-5c6c-76d4-aa87-285b5e72d9fb",
        "01a17356-5c6c-76d4-aa87-2d1f9481d980",
        "01a17356-5c6c-76d4-aa87-30b9d69bec79",
        "01a17356-5c6c-76d4-aa87-364c243b8271",
        "01a17356-5c6c-76d4-aa87-39dbf8604ca9",
        "01a17356-5c6c-76d4-aa87-3dbfbdc737d2",
        "01a17356-5c6c-76d4-aa87-423afe8844e8",
        "01a17356-5c6c-76d4-aa87-450f64284f63",
        "01a17356-5c6c-76d4-aa87-49b384bb8655",
        "01a17356-5c6d-765a-82b1-35f5c0ccdb29",
        "01a17356-5c6d-765a-82b1-3af809181930",
        "01a17356-5c6d-765a-82b1-3c7d63ff30a5",
        "01a17356-5c6d-765a-82b1-43f66510518c",
        "01a17356-5c6d-765a-82b1-46b6d53d8606",
        "01a17356-5c6d-765a-82b1-4a1875c62d83",
        "01a17356-5c6d-765a-82b1-4d91015f78ac",
        "01a17356-5c6d-765a-82b1-52d512323df9",
        "01a17356-5c6d-765a-82b1-5723c123a586",
        "01a17356-5c6d-765a-82b1-5be4ceb7855f",
        "01a17356-5c6d-765a-82b1-5ff40b1e82e6",
        "01a17356-5c6d-765a-82b1-606f8cc2a83d",
        "01a17356-5c6d-765a-82b1-64572df8ef82",
        "01a17356-5c6d-765a-82b1-6b8808d560ca",
      ]
    `);
  });
});
