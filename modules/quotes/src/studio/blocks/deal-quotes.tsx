import { defineBlockComponent, num, str } from '@devias/core';
import { ids as crm } from '@devias/mod-crm/manifest';
import {
  links,
  OptionBadge,
  useCreateRecord,
  useNavigation,
  useRecordPage,
  useRecords,
  useWorkspace,
} from '@devias/studio';
import { Button, Icon, Skeleton } from '@devias/ui';
import { useMemo } from 'react';
import { QUOTE_STATUSES } from '../../manifest';
import { ids } from '../../manifest/ids';
import { useQuoteMoney } from '../shared';

/**
 * The quotes made for the deal, newest first, and a button that starts the next: an empty draft for the deal and its
 * company, opened so its items can be added.
 */
export const dealQuotesBlock = defineBlockComponent({
  id: ids.blocks.deal_quotes,
  label: 'Quotes',
  icon: 'file-text',
  // The CRM's deal page does not know this block: it places itself in the main column, right after the deal's stage.
  surfaces: {
    record: { objectIds: [crm.objects.deal], frame: false, placement: 'main', after: crm.blocks.deal_stage },
  },
  component: function DealQuotes() {
    const { record, readOnly } = useRecordPage();
    const { slug } = useWorkspace();
    const navigation = useNavigation();
    const { Link } = navigation;
    const create = useCreateRecord('quote');
    const money = useQuoteMoney();
    const query = useMemo(
      () => ({
        object: 'quote',
        filter: { field: 'deal', op: 'eq' as const, value: record.id },
        sort: [{ field: 'created_at', direction: 'desc' as const }],
        limit: 20,
      }),
      [record.id],
    );
    const quotes = useRecords(query);
    const items = quotes.data?.items ?? [];

    return (
      <div className="flex flex-col gap-3" data-slot="deal-quotes">
        {quotes.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No quote yet.</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((quote) => {
              const status = QUOTE_STATUSES.find((option) => option.value === quote.status);

              return (
                <li
                  key={quote.id}
                  className="flex items-center gap-3 border-b border-border py-2 text-xs last:border-b-0"
                >
                  <Link
                    href={links.record(slug, 'quote', quote.id)}
                    className="min-w-0 flex-1 truncate font-medium text-foreground hover:underline hover:underline-offset-4"
                  >
                    {str(quote.title) || 'Quote'}
                  </Link>
                  {status ? <OptionBadge option={status} /> : null}
                  <span className="w-24 text-right tabular-nums">{money(num(quote.total))}</span>
                </li>
              );
            })}
          </ul>
        )}
        {readOnly ? null : (
          <div>
            <Button
              size="sm"
              variant="outline"
              data-action="new-quote"
              disabled={create.isPending}
              onClick={async () => {
                const quote = await create.mutateAsync({
                  title: str(record.name) || 'Quote',
                  status: 'draft',
                  deal: record.id,
                  ...(record.company ? { company: record.company } : {}),
                });
                navigation.navigate(links.record(slug, 'quote', quote.id));
              }}
            >
              <Icon name="plus" />
              New quote
            </Button>
          </div>
        )}
      </div>
    );
  },
});
