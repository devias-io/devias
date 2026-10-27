import { idListOf, isUuid, parseManifest } from '@devias/core';
import { manifest as crm } from '@devias/mod-crm/manifest';
import { describe, expect, it } from 'vitest';
import { EXPENSE_STATUSES, manifest } from '../src/manifest';

describe('expenses manifest', () => {
  it('parses, and every id is a unique uuid', () => {
    const parsed = parseManifest(manifest);
    const ids = [
      ...parsed.objects.map((object) => object.id),
      ...parsed.objects.flatMap((object) => object.fields.map((field) => field.id)),
      ...parsed.views.map((view) => view.id),
      ...parsed.navItems.map((item) => item.id),
      ...parsed.commandItems.map((item) => item.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isUuid)).toBe(true);
  });

  it('relates only to the CRM, and its views name fields and statuses it has', () => {
    const [expense] = manifest.objects;

    if (!expense) {
      throw new Error('the module declares the expense object');
    }

    const crmObjects = new Set(crm.objects.map((object) => object.id));

    for (const field of expense.fields.filter((candidate) => candidate.type === 'relation')) {
      const target = (field.settings as { targetObjectId?: string }).targetObjectId ?? '';
      expect(crmObjects.has(target), `${field.name} → ${target}`).toBe(true);
    }

    const fieldIds = expense.fields.map((field) => field.id);
    const statuses: string[] = EXPENSE_STATUSES.map((status) => status.value);

    for (const view of manifest.views) {
      for (const column of view.fields ?? []) {
        expect(fieldIds, `${view.label}.${column.fieldId}`).toContain(column.fieldId);
      }

      if (view.groupById) {
        expect(fieldIds).toContain(view.groupById);
      }
    }

    const toApprove = manifest.views.find((view) => view.label === 'To approve');

    if (!toApprove) {
      throw new Error('the module declares a To approve view');
    }

    expect(statuses).toContain((toApprove.filter as { value: string }).value);
  });
});

describe('expenses ids', () => {
  it('are the ones installed workspaces store', () => {
    expect(idListOf(manifest).sort()).toMatchInlineSnapshot(`
      [
        "01a17356-5c6c-76d4-aa85-bba48cd40af2",
        "01a17356-5c6c-76d4-aa85-beb18907b62f",
        "01a17356-5c6c-76d4-aa85-c0c6564a4c76",
        "01a17356-5c6c-76d4-aa85-c40d2725706a",
        "01a17356-5c6c-76d4-aa85-cbeccfff728e",
        "01a17356-5c6c-76d4-aa85-cd729f0d11cb",
        "01a17356-5c6c-76d4-aa85-d1785f9321f9",
        "01a17356-5c6c-76d4-aa85-d493c366cc2f",
        "01a17356-5c6c-76d4-aa85-da442a60b6da",
        "01a17356-5c6c-76d4-aa85-dca11405b609",
        "01a17356-5c6c-76d4-aa85-e2bdc77519ba",
        "01a17356-5c6c-76d4-aa85-e64befa627b1",
        "01a17356-5c6c-76d4-aa85-ea83802f291a",
        "01a17356-5c6c-76d4-aa85-ecb0d7b9fb96",
        "01a17356-5c6c-76d4-aa85-f1b6552a9d6a",
        "01a17356-5c6c-76d4-aa85-f47a96324d0f",
        "01a17356-5c6c-76d4-aa85-fbb520eea693",
        "01a17356-5c6c-76d4-aa85-fd261dee494f",
        "01a17356-5c6c-76d4-aa86-02abb6289979",
        "01a17356-5c6c-76d4-aa86-05e1a97359d3",
        "01a17356-5c6c-76d4-aa86-08caa9f4279a",
        "01a17356-5c6c-76d4-aa86-0eaabde42889",
        "01a17356-5c6c-76d4-aa86-1170cc9e4f0b",
        "01a17356-5c6c-76d4-aa86-17e86cb35d8b",
      ]
    `);
  });
});
