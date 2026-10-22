import { idListOf, parseManifest } from '@devias/core';
import { manifest as crm } from '@devias/mod-crm/manifest';
import { describe, expect, it } from 'vitest';
import { EXPENSE_STATUSES, manifest } from '../src/manifest';

describe('expenses manifest', () => {
  it('parses, and every id is unique and owned by the module', () => {
    const parsed = parseManifest(manifest);
    const ids = [
      ...parsed.objects.map((object) => object.id),
      ...parsed.objects.flatMap((object) => object.fields.map((field) => field.id)),
      ...parsed.views.map((view) => view.id),
      ...parsed.navItems.map((item) => item.id),
      ...parsed.commandItems.map((item) => item.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith(`${manifest.id}.`))).toBe(true);
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
        "expenses.all_expenses",
        "expenses.expense",
        "expenses.expense.all",
        "expenses.expense.amount",
        "expenses.expense.by_status",
        "expenses.expense.category",
        "expenses.expense.currency",
        "expenses.expense.deal",
        "expenses.expense.description",
        "expenses.expense.notes",
        "expenses.expense.paid_with",
        "expenses.expense.receipt_url",
        "expenses.expense.spent_on",
        "expenses.expense.status",
        "expenses.expense.supplier",
        "expenses.expense.tax",
        "expenses.expense.to_approve",
        "expenses.expense.to_reimburse",
        "expenses.expenses",
        "expenses.go_to_expenses",
        "expenses.large_expenses",
        "expenses.new_expense",
        "expenses.to_approve",
        "expenses.to_reimburse",
      ]
    `);
  });
});
