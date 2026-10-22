import type { RecordData } from '@devias/core';
import { localDate } from '@devias/core';
import {
  errorMessage,
  links,
  useCreateRecord,
  useDeleteRecords,
  useNavigation,
  useRecord,
  useRecords,
  useRelatedLabels,
  useUpdateRecord,
  useWorkspace,
} from '@devias/studio';
import { BrandMark, Button, Icon, Input, OptionSelect, Skeleton, Switch, Textarea } from '@devias/ui';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CURRENCIES, DISCOUNT_TYPES, PAYMENT_METHODS } from '../../manifest';
import { buildInvoiceDocument, type InvoiceDocumentData } from '../pdf/invoice-data';
import { InvoicePaper } from '../pdf/invoice-paper';
import { renderInvoicePdf, saveBlob } from '../pdf/invoice-pdf';
import { linesQuery, money, text } from '../shared';
import {
  addDays,
  type ComposerForm,
  type ComposerLine,
  type ComposerParty,
  emptyLine,
  formFromInvoice,
  formTotals,
  invoiceRecord,
  lineRecords,
  newForm,
  parseNumber,
  sendProblems,
  TERMS,
} from './composer-state';
import { RecordPicker } from './record-picker';

/**
 * The invoice composer, in the manner of Wise's: a full-screen form on the left (customer, items, discount,
 * payment terms, issuer details) and the invoice as it will print on the right, updating as you type. Drafts can be
 * saved and reopened; sending makes the invoice final.
 */

const sectionTitle = 'text-sm font-semibold';
const fieldLabel = 'text-xs font-medium text-muted-foreground';

function Toggle({
  title,
  description,
  checked,
  onChange,
  children,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
      </div>
      {checked && children ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">{children}</div>
      ) : null}
    </div>
  );
}

function ItemCard({
  line,
  index,
  currency,
  canRemove,
  onChange,
  onRemove,
}: {
  line: ComposerLine;
  index: number;
  currency: string;
  canRemove: boolean;
  onChange: (patch: Partial<ComposerLine>) => void;
  onRemove: () => void;
}) {
  const amount = parseNumber(line.quantity) * parseNumber(line.unit_price);
  const taxed = line.tax_rate !== '';

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-line-card={index}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Item {index + 1}</span>
        {canRemove ? (
          <Button variant="ghost" size="icon-xs" aria-label={`Remove item ${index + 1}`} onClick={onRemove}>
            <Icon name="x" />
          </Button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        <label className={fieldLabel} htmlFor={`desc-${line.key}`}>
          Product or service
        </label>
        <Input
          id={`desc-${line.key}`}
          value={line.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </div>
      <div className="mt-3 grid grid-cols-[5rem_auto_1fr_auto_auto] items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel} htmlFor={`qty-${line.key}`}>
            Quantity
          </label>
          <Input
            id={`qty-${line.key}`}
            inputMode="decimal"
            value={line.quantity}
            onChange={(event) => onChange({ quantity: event.target.value })}
          />
        </div>
        <span className="pb-2 text-muted-foreground">×</span>
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel} htmlFor={`price-${line.key}`}>
            Price ({currency})
          </label>
          <Input
            id={`price-${line.key}`}
            inputMode="decimal"
            value={line.unit_price}
            placeholder="0"
            onChange={(event) => onChange({ unit_price: event.target.value })}
          />
        </div>
        <span className="pb-2 text-muted-foreground">=</span>
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Total</span>
          <span className="pb-2 text-xs tabular-nums">{money(amount, currency)}</span>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        <div>
          <div className="text-xs font-medium">Tax</div>
          <div className="text-xs text-muted-foreground">
            {taxed ? 'Rate for this item, as a percentage.' : 'Set the tax rate for this item'}
          </div>
        </div>
        {taxed ? (
          <span className="flex items-center gap-1.5">
            <Input
              aria-label={`Tax rate for item ${index + 1}`}
              inputMode="decimal"
              className="w-20 text-right"
              value={line.tax_rate}
              onChange={(event) => onChange({ tax_rate: event.target.value })}
            />
            <span className="text-xs text-muted-foreground">%</span>
            <Button variant="ghost" size="icon-xs" aria-label="Remove tax" onClick={() => onChange({ tax_rate: '' })}>
              <Icon name="x" />
            </Button>
          </span>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => onChange({ tax_rate: '0' })}>
            Add
          </Button>
        )}
      </div>
    </div>
  );
}

function Composer({
  initial,
  existing,
  suggestions,
}: {
  initial: ComposerForm;
  existing?: { id: string; lines: RecordData[] };
  suggestions: ComposerParty[];
}) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const createInvoice = useCreateRecord('invoice');
  const updateInvoice = useUpdateRecord('invoice');
  const createLine = useCreateRecord('invoice_line');
  const updateLine = useUpdateRecord('invoice_line');
  const removeLines = useDeleteRecords('invoice_line');
  const [form, setForm] = useState<ComposerForm>(initial);
  const [saving, setSaving] = useState<'draft' | 'sent' | null>(null);
  const [downloading, setDownloading] = useState(false);
  const set = (patch: Partial<ComposerForm>) => setForm((current) => ({ ...current, ...patch }));
  const setLine = (key: string, patch: Partial<ComposerLine>) =>
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));

  const exitHref = existing ? links.record(slug, 'invoice', existing.id) : links.page(slug, 'billing');
  const totals = formTotals(form);

  const document = useMemo<InvoiceDocumentData>(() => {
    const stamp = { created_at: '', updated_at: '' };

    return buildInvoiceDocument({
      issuer: form.issuer_name,
      invoice: { id: 'draft', ...stamp, ...invoiceRecord(form, 'draft') },
      lines: lineRecords(form).map((line, index) => ({ ...stamp, ...line, id: line.id ?? `new-${index}` })),
      payments: [],
      names: { company: form.company?.label ?? null, contact: form.contact?.label ?? null },
    });
  }, [form]);

  const save = async (status: 'draft' | 'sent') => {
    if (status === 'sent') {
      const problems = sendProblems(form);

      if (problems.length > 0) {
        toast.error(problems[0]);

        return;
      }
    } else if (!form.number.trim()) {
      toast.error('Give the invoice a number.');

      return;
    }

    setSaving(status);

    try {
      const fields = invoiceRecord(form, status);
      const lines = lineRecords(form);
      let id: string;

      if (existing) {
        id = existing.id;
        await updateInvoice.mutateAsync({ id, patch: fields });
        const kept = new Set(lines.flatMap((line) => (line.id ? [line.id] : [])));
        const removed = existing.lines.filter((line) => !kept.has(line.id)).map((line) => line.id);

        if (removed.length > 0) {
          await removeLines.mutateAsync(removed);
        }

        await Promise.all(
          lines.map(({ id: lineId, ...data }) =>
            lineId
              ? updateLine.mutateAsync({ id: lineId, patch: data })
              : createLine.mutateAsync({ ...data, invoice: id }),
          ),
        );
      } else {
        const created = await createInvoice.mutateAsync(fields);
        id = created.id;
        await Promise.all(lines.map(({ id: _id, ...data }) => createLine.mutateAsync({ ...data, invoice: id })));
      }

      toast.success(status === 'sent' ? `Sent ${form.number}` : 'Draft saved');
      navigation.navigate(links.record(slug, 'invoice', id));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  const download = async () => {
    setDownloading(true);

    try {
      saveBlob(await renderInvoicePdf(document), `Invoice-${form.number || 'draft'}.pdf`);
    } catch {
      toast.error('The PDF could not be generated.');
    } finally {
      setDownloading(false);
    }
  };

  const termsValue = form.termsDays === null ? 'custom' : String(form.termsDays);
  const termsOptions = [
    ...TERMS.map((term) => ({ value: String(term.days), label: term.label })),
    { value: 'custom', label: 'Custom date' },
  ];
  const setIssue = (issueDate: string) =>
    set({
      issue_date: issueDate,
      ...(form.termsDays !== null && issueDate ? { due_date: addDays(issueDate, form.termsDays) } : {}),
    });
  const toggleMethod = (value: string) =>
    set({
      payment_methods: form.payment_methods.includes(value)
        ? form.payment_methods.filter((method) => method !== value)
        : [...form.payment_methods, value],
    });

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-background" data-slot="invoice-composer">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <BrandMark />
          <span className="text-xs font-medium">{existing ? 'Edit invoice' : 'New invoice'}</span>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={() => navigation.navigate(exitHref)}>
          <Icon name="x" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-10 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-10">
            <div className="flex items-center justify-between gap-4">
              <div className="group relative flex items-center gap-2">
                <Input
                  aria-label="Invoice number"
                  value={form.number}
                  onChange={(event) => set({ number: event.target.value })}
                  size={Math.max(form.number.length, 6)}
                  className="h-auto min-w-0 rounded-lg border-transparent bg-transparent px-2 py-1 text-2xl font-semibold tracking-tight shadow-none hover:bg-muted/50 focus-visible:bg-transparent md:text-2xl dark:bg-transparent dark:hover:bg-muted/50 dark:focus-visible:bg-transparent"
                />
                <Icon
                  name="pencil"
                  className="size-4 shrink-0 text-muted-foreground transition-opacity group-focus-within:opacity-0"
                />
              </div>
              <OptionSelect
                aria-label="Currency"
                value={form.currency}
                onValueChange={(currency) => set({ currency })}
                options={CURRENCIES}
                className="w-44"
              />
            </div>

            <section className="flex flex-col gap-4">
              <h2 className={sectionTitle}>Customer</h2>
              <RecordPicker
                object="company"
                value={form.company}
                onChange={(company) => set({ company })}
                placeholder="Find a customer"
                suggestions={suggestions}
                suggestionsTitle="Recents"
              />
              {form.company ? (
                <div className="flex flex-col gap-1.5">
                  <span className={fieldLabel}>Contact (optional)</span>
                  <RecordPicker
                    object="person"
                    value={form.contact}
                    onChange={(contact) => set({ contact })}
                    placeholder="Find a contact"
                  />
                </div>
              ) : null}
            </section>

            <section className="flex flex-col gap-4">
              <h2 className={sectionTitle}>Items</h2>
              {form.lines.map((line, index) => (
                <ItemCard
                  key={line.key}
                  line={line}
                  index={index}
                  currency={form.currency}
                  canRemove={form.lines.length > 1}
                  onChange={(patch) => setLine(line.key, patch)}
                  onRemove={() => set({ lines: form.lines.filter((candidate) => candidate.key !== line.key) })}
                />
              ))}
              <button
                type="button"
                className="flex h-16 items-center gap-3 rounded-lg border border-dashed border-border px-4 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                onClick={() => set({ lines: [...form.lines, emptyLine()] })}
              >
                <Icon name="plus" className="size-4" /> Add item
              </button>
            </section>

            <section className="flex flex-col gap-4">
              <h2 className={sectionTitle}>Discount</h2>
              {form.discountOn ? (
                <div className="flex items-end gap-3 rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <span className={fieldLabel}>Type</span>
                    <OptionSelect
                      aria-label="Discount type"
                      value={form.discount_type}
                      onValueChange={(discountType) => set({ discount_type: discountType })}
                      options={DISCOUNT_TYPES}
                      className="w-full"
                    />
                  </div>
                  <div className="flex w-32 flex-col gap-1.5">
                    <label className={fieldLabel} htmlFor="discount-value">
                      {form.discount_type === 'percent' ? 'Percent' : `Amount (${form.currency})`}
                    </label>
                    <Input
                      id="discount-value"
                      inputMode="decimal"
                      value={form.discount_value}
                      onChange={(event) => set({ discount_value: event.target.value })}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label="Remove discount"
                    onClick={() => set({ discountOn: false, discount_value: '' })}
                  >
                    <Icon name="x" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  className="flex h-16 items-center gap-3 rounded-lg border border-dashed border-border px-4 text-left text-xs font-medium transition-colors hover:bg-muted/40"
                  onClick={() => set({ discountOn: true })}
                >
                  <Icon name="percent" className="size-4" /> Add a discount
                </button>
              )}
            </section>

            <section className="flex flex-col gap-4">
              <h2 className={sectionTitle}>Payment</h2>
              <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
                <div className="flex flex-col gap-2">
                  <span className={fieldLabel}>Ways to pay</span>
                  <div className="flex flex-wrap gap-2">
                    {PAYMENT_METHODS.map((method) => {
                      const on = form.payment_methods.includes(method.value);

                      return (
                        <Button
                          key={method.value}
                          type="button"
                          size="sm"
                          variant={on ? 'secondary' : 'outline'}
                          aria-pressed={on}
                          onClick={() => toggleMethod(method.value)}
                        >
                          {on ? <Icon name="check" className="size-3.5" /> : null}
                          {method.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className={fieldLabel} htmlFor="issue-date">
                      Issued
                    </label>
                    <Input
                      id="issue-date"
                      type="date"
                      value={form.issue_date}
                      onChange={(event) => setIssue(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className={fieldLabel}>Due</span>
                    <OptionSelect
                      aria-label="Due"
                      value={termsValue}
                      onValueChange={(value) =>
                        value === 'custom'
                          ? set({ termsDays: null })
                          : set({ termsDays: Number(value), due_date: addDays(form.issue_date, Number(value)) })
                      }
                      options={termsOptions}
                      className="w-full"
                    />
                  </div>
                </div>
                {form.termsDays === null ? (
                  <div className="flex flex-col gap-1.5">
                    <label className={fieldLabel} htmlFor="due-date">
                      Due date
                    </label>
                    <Input
                      id="due-date"
                      type="date"
                      value={form.due_date}
                      onChange={(event) => set({ due_date: event.target.value })}
                    />
                  </div>
                ) : null}
              </div>
            </section>

            <section className="flex flex-col gap-4">
              <h2 className={sectionTitle}>Additional information</h2>
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                <div className="flex flex-col gap-1.5">
                  <label className={fieldLabel} htmlFor="issuer-name">
                    Issued by
                  </label>
                  <Input
                    id="issuer-name"
                    value={form.issuer_name}
                    onChange={(event) => set({ issuer_name: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={fieldLabel} htmlFor="issuer-address">
                    Address
                  </label>
                  <Textarea
                    id="issuer-address"
                    rows={3}
                    value={form.issuer_address}
                    onChange={(event) => set({ issuer_address: event.target.value })}
                  />
                </div>
              </div>
              <Toggle
                title="Your tax ID"
                description="Print your tax ID on the invoice"
                checked={form.taxIdOn}
                onChange={(taxIdOn) => set({ taxIdOn })}
              >
                <Input
                  aria-label="Tax ID"
                  value={form.issuer_tax_id}
                  placeholder="e.g. RO 12345678"
                  onChange={(event) => set({ issuer_tax_id: event.target.value })}
                />
              </Toggle>
              <Toggle
                title="Include note"
                description="Extra information or a message"
                checked={form.noteOn}
                onChange={(noteOn) => set({ noteOn })}
              >
                <Textarea
                  aria-label="Note"
                  rows={3}
                  value={form.notes}
                  onChange={(event) => set({ notes: event.target.value })}
                />
              </Toggle>
              <p className="text-xs text-muted-foreground">
                It’s your responsibility to invoice your customer in line with their local laws and regulations.
              </p>
            </section>
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-0 lg:self-start" data-slot="composer-preview">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" size="sm" disabled={downloading} onClick={() => void download()}>
                <Icon name="download" /> Download draft
              </Button>
              <Button variant="outline" size="sm" disabled={saving !== null} onClick={() => void save('draft')}>
                Save draft
              </Button>
              <Button size="sm" disabled={saving !== null} onClick={() => void save('sent')}>
                <Icon name="mail" /> Send invoice
              </Button>
            </div>
            <InvoicePaper data={document} />
            <p className="text-right text-xs text-muted-foreground tabular-nums">
              {totals.total > 0 ? `Total ${money(totals.total, form.currency)}` : 'Add items to see the total'}
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** The newest invoice and a handful of recent customers: the composer starts from them. */
function useStarting() {
  return useRecords(
    useMemo(() => ({ object: 'invoice', sort: [{ field: 'created_at', direction: 'desc' as const }], limit: 20 }), []),
  );
}

function NewInvoice() {
  const { organization } = useWorkspace();
  const starting = useStarting();
  const recent = starting.data?.items ?? [];
  const companyIds = [
    ...new Set(recent.map((invoice) => text(invoice.company)).filter((id): id is string => !!id)),
  ].slice(0, 4);
  const labels = useRelatedLabels('company', companyIds);
  const today = useMemo(() => localDate(new Date()), []);

  if (starting.isPending) {
    return <ComposerSkeleton />;
  }

  const initial = newForm(today, recent[0], organization.name);
  const suggestions = companyIds.map((id) => ({ id, label: labels.get(id) }));

  return <Composer initial={initial} suggestions={suggestions} />;
}

function EditInvoice({ id }: { id: string }) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const invoice = useRecord('invoice', id);
  const lines = useRecords(useMemo(() => linesQuery(id), [id]));
  const company = text(invoice.data?.company);
  const contact = text(invoice.data?.contact);
  const companyLabels = useRelatedLabels('company', [company]);
  const contactLabels = useRelatedLabels('person', [contact]);
  const record = invoice.data;
  const locked = Boolean(record && record.status !== 'draft');
  useEffect(() => {
    if (locked) {
      navigation.navigate(links.record(slug, 'invoice', id), { replace: true });
    }
  }, [locked, navigation, slug, id]);

  if (invoice.isPending || lines.isPending || !record || locked) {
    return <ComposerSkeleton />;
  }

  const lineItems = lines.data?.items ?? [];
  const initial = formFromInvoice(record, lineItems, {
    company: company ? { id: company, label: companyLabels.get(company) } : null,
    contact: contact ? { id: contact, label: contactLabels.get(contact) } : null,
  });

  return <Composer key={record.id} initial={initial} existing={{ id: record.id, lines: lineItems }} suggestions={[]} />;
}

function ComposerSkeleton() {
  return (
    <div className="fixed inset-0 z-40 bg-background p-10">
      <Skeleton className="mx-auto h-64 w-full max-w-3xl" />
    </div>
  );
}

/** `/billing/new` and `/billing/:invoiceId/edit`. */
export function InvoiceComposerPage() {
  const { params } = useNavigation();

  return params.invoiceId ? <EditInvoice id={params.invoiceId} /> : <NewInvoice />;
}
