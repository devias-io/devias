import { coreIds, idListOf, layoutCells, parseManifest } from '@devias/core';
import { manifest as crm } from '@devias/mod-crm/manifest';
import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { invoicing } from '../src/server';

const relationFields = manifest.objects.flatMap((object) =>
  object.fields.filter((field) => field.type === 'relation').map((field) => ({ object: object.nameSingular, field })),
);

describe('invoicing manifest', () => {
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

  it('puts Overview, Invoices and Payments under one Billing section in the sidebar', () => {
    const parsed = parseManifest(manifest);
    const group = parsed.navItems.find((item) => item.label === 'Billing');
    const rows = parsed.navItems.filter((item) => item.parentId === group?.id);
    expect(rows.map((item) => item.label)).toEqual(['Overview', 'Invoices', 'Payments']);
    expect(rows.find((item) => item.label === 'Payments')?.target).toEqual({
      kind: 'object',
      objectId: 'invoicing.payment',
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
      coreIds.blocks.notes,
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
});

describe('invoicing ids', () => {
  it('are the ones installed workspaces store', () => {
    expect(idListOf(manifest).sort()).toMatchInlineSnapshot(`
      [
        "invoicing.add_payment",
        "invoicing.billing",
        "invoicing.billing_group",
        "invoicing.billing_new",
        "invoicing.collected",
        "invoicing.confirm_payment",
        "invoicing.go_to_billing",
        "invoicing.invoice",
        "invoicing.invoice.all",
        "invoicing.invoice.board",
        "invoicing.invoice.company",
        "invoicing.invoice.contact",
        "invoicing.invoice.currency",
        "invoicing.invoice.deal",
        "invoicing.invoice.default",
        "invoicing.invoice.discount_amount",
        "invoicing.invoice.discount_type",
        "invoicing.invoice.discount_value",
        "invoicing.invoice.due_date",
        "invoicing.invoice.issue_date",
        "invoicing.invoice.issuer_address",
        "invoicing.invoice.issuer_name",
        "invoicing.invoice.issuer_tax_id",
        "invoicing.invoice.notes",
        "invoicing.invoice.number",
        "invoicing.invoice.outstanding",
        "invoicing.invoice.payment_methods",
        "invoicing.invoice.payment_url",
        "invoicing.invoice.status",
        "invoicing.invoice.subtotal",
        "invoicing.invoice.tax",
        "invoicing.invoice.tax_rate",
        "invoicing.invoice.total",
        "invoicing.invoice_details",
        "invoicing.invoice_figures",
        "invoicing.invoice_header",
        "invoicing.invoice_line",
        "invoicing.invoice_line.all",
        "invoicing.invoice_line.description",
        "invoicing.invoice_line.invoice",
        "invoicing.invoice_line.quantity",
        "invoicing.invoice_line.tax_rate",
        "invoicing.invoice_line.unit_price",
        "invoicing.invoice_lines",
        "invoicing.invoice_payments",
        "invoicing.invoices",
        "invoicing.large_invoices",
        "invoicing.new_invoice",
        "invoicing.overview",
        "invoicing.payment",
        "invoicing.payment.all",
        "invoicing.payment.amount",
        "invoicing.payment.invoice",
        "invoicing.payment.method",
        "invoicing.payment.paid_on",
        "invoicing.payment.reference",
        "invoicing.payments",
        "invoicing.payments",
        "invoicing.recalculate_invoice",
        "invoicing.receivables",
      ]
    `);
  });
});
