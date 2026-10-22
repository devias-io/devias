import { defineBlockComponent, keyOfId } from '@devias/core';
import { useFields, useRecordPage, useRunModuleAction, useSchema } from '@devias/studio';
import { Button, Icon, Section } from '@devias/ui';
import { toast } from 'sonner';
import { ids, PAYMENT_LINK_ACTION } from '../../manifest';
import { text } from '../shared';
import { useInvoice, usePatchInvoice } from './use-invoice';
import { Value } from './value';

const DETAIL_GROUPS: { title: string; names: string[] }[] = [
  { title: 'Customer', names: ['company', 'contact', 'deal'] },
  { title: 'Invoice', names: ['number', 'issue_date', 'due_date'] },
  { title: 'Terms', names: ['tax_rate', 'notes'] },
];

const lockedNote = (status: unknown): string =>
  status === 'paid'
    ? 'A paid invoice is final.'
    : status === 'void'
      ? 'A void invoice is final.'
      : 'A sent invoice can’t be changed. Void it and create a new one if something is wrong.';

/**
 * Taking the payment online: the invoice's payment link, and a way to make one through each installed payment provider
 * (a module declaring `PAYMENT_LINK_ACTION`, such as Stripe). What the customer pays there is recorded here by itself.
 */
function OnlinePayment({
  recordId,
  url,
  status,
  balance,
}: {
  recordId: string;
  url: string | null;
  status: unknown;
  balance: number;
}) {
  const { schema } = useSchema();
  const run = useRunModuleAction();
  const providers = schema.modules.filter((module) =>
    module.actions.some((action) => keyOfId(action.id) === PAYMENT_LINK_ACTION),
  );

  if (status !== 'sent' || (!url && providers.length === 0)) {
    return null;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url ?? '');
      toast.success('Payment link copied');
    } catch {
      toast.error('Could not copy; select the link instead');
    }
  };

  return (
    <Section variant="plain" title="Online payment">
      <p className="-mt-2 mb-3 text-xs text-muted-foreground">
        {url ? 'Share the link: what the customer pays there is recorded here.' : 'Let the customer pay by card.'}
      </p>
      <div className="flex flex-col gap-2" data-slot="online-payment">
        {url ? (
          <div className="flex items-center gap-1.5">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-xs text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              {url}
            </a>
            <Button size="icon-xs" variant="outline" aria-label="Copy payment link" onClick={() => void copy()}>
              <Icon name="copy" />
            </Button>
          </div>
        ) : null}
        {balance > 0
          ? providers.map((provider) => (
              <Button
                key={provider.moduleId}
                size="sm"
                variant="outline"
                className="self-start"
                data-action="payment-link"
                disabled={run.isPending}
                onClick={() =>
                  run.mutate({
                    module: provider.moduleId,
                    action: PAYMENT_LINK_ACTION,
                    input: { invoice_id: recordId },
                  })
                }
              >
                <Icon name="link" />
                {url ? 'Update link' : 'Create payment link'}
                {providers.length > 1 ? ` · ${provider.name}` : ''}
              </Button>
            ))
          : null}
      </div>
    </Section>
  );
}

/**
 * The invoice's details in groups (customer, invoice, terms), edited in place on a draft, with what a locked invoice
 * says about itself and, once sent, the online payment link. The aside of the invoice layout.
 */
export const invoiceDetailsBlock = defineBlockComponent({
  id: ids.blocks.invoice_details,
  label: 'Invoice details',
  icon: 'list-details',
  surfaces: { record: { objectIds: [ids.objects.invoice], frame: false } },
  component: function InvoiceDetails() {
    const { object, record } = useRecordPage();
    const fields = useFields(object.id);
    const { balance, status, editable } = useInvoice(record);
    const { patch } = usePatchInvoice(record);

    return (
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-9" data-slot="invoice-details">
          {DETAIL_GROUPS.map((group) => (
            <Section key={group.title} variant="plain" title={group.title}>
              <dl className="flex flex-col">
                {group.names.map((name) => {
                  const field = fields.find((candidate) => candidate.name === name);

                  if (!field) {
                    return null;
                  }

                  return (
                    <div key={name} className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-2">
                      <dt className="flex min-h-8 items-center text-xs text-muted-foreground">{field.label}</dt>
                      <dd className="min-w-0">
                        <Value
                          name={name}
                          fields={fields}
                          record={record}
                          object={object}
                          editable={editable}
                          onCommit={(key, value) => void patch({ [key]: value })}
                        />
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </Section>
          ))}
          {!editable ? (
            <p className="-mt-3 flex items-start gap-1.5 text-xs text-muted-foreground" data-slot="locked">
              <Icon name="lock" className="mt-0.5 size-3.5 shrink-0" />
              {lockedNote(status)}
            </p>
          ) : null}
        </div>
        <OnlinePayment recordId={record.id} url={text(record.payment_url)} status={status} balance={balance} />
      </div>
    );
  },
});
