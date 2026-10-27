import { defineBlockComponent, num, round2 } from '@devias/core';
import {
  EditableValue,
  getFieldType,
  useCreateRecord,
  useDeleteRecords,
  useFields,
  useFieldTypes,
  useObject,
  useRecordPage,
  useRecords,
  useUpdateRecord,
} from '@devias/studio';
import { Button, cn, Icon, Input, Skeleton, TABLE_CELL, TABLE_HEAD, TABLE_ROW } from '@devias/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { itemsTotal, lineTotal } from '../../lib/totals';
import { ids } from '../../manifest';
import { useQuoteMoney } from '../shared';

/** One field of an item as a click-to-edit value. */
function ItemValue({
  name,
  record,
  editable,
  onCommit,
}: {
  name: string;
  record: Record<string, unknown> & { id: string };
  editable: boolean;
  onCommit: (name: string, value: unknown) => void;
}) {
  const object = useObject('quote_item');
  const fields = useFields(object?.id);
  const fieldTypes = useFieldTypes();
  const field = fields.find((candidate) => candidate.name === name);

  if (!object || !field) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  return (
    // The value's own box (its border and padding) reaches into the cell's padding, so its text lines up with the
    // column's heading; a number sits at the right end, under its right-aligned heading.
    <div className="-mx-1.5">
      <EditableValue
        align={name === 'description' ? 'start' : 'end'}
        field={field}
        fieldType={getFieldType(fieldTypes, field.type)}
        // The row is a record of the item object, as the studio's own cells take it.
        record={record as never}
        object={object}
        editable={editable}
        onCommit={(value) => onCommit(name, value)}
      />
    </div>
  );
}

/** The row at the end of the offer: type what is being offered, Tab through quantity and price, Enter adds it. */
function AddItem({
  quoteId,
  busy,
  onAdd,
}: {
  quoteId: string;
  busy: boolean;
  onAdd: (item: Record<string, unknown>) => void;
}) {
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const first = useRef<HTMLInputElement>(null);
  const ready = description.trim().length > 0;
  const submit = () => {
    if (!ready || busy) {
      return;
    }

    onAdd({
      quote: quoteId,
      description: description.trim(),
      quantity: Number(quantity) > 0 ? Number(quantity) : 1,
      unit_price: Number(price) >= 0 && price !== '' ? Number(price) : 0,
    });
    setDescription('');
    setQuantity('1');
    setPrice('');
    first.current?.focus();
  };
  const enter = (event: { key: string; preventDefault: () => void }) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <tr className={TABLE_ROW} data-slot="add-item">
      <td className={cn(TABLE_CELL, 'py-1')}>
        <div className="flex items-center gap-2">
          <Icon name="plus" className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={first}
            aria-label="New item"
            placeholder="Add an item…"
            className="h-8 border-transparent bg-transparent px-1 shadow-none focus-visible:bg-background"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={enter}
          />
        </div>
      </td>
      <td className={cn(TABLE_CELL, 'py-1 text-right')}>
        <Input
          aria-label="New item quantity"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          className="-mx-1.5 h-8 w-[calc(100%+0.75rem)] px-[5px] text-right"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          onKeyDown={enter}
        />
      </td>
      <td className={cn(TABLE_CELL, 'py-1 text-right')}>
        <Input
          aria-label="New item unit price"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder="0"
          className="-mx-1.5 h-8 w-[calc(100%+0.75rem)] px-[5px] text-right"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          onKeyDown={enter}
        />
      </td>
      <td className={cn(TABLE_CELL, 'py-1 text-right')}>
        <Button size="xs" variant="outline" disabled={!ready || busy} onClick={submit} data-action="add-item">
          Add
        </Button>
      </td>
      <td />
    </tr>
  );
}

/**
 * A quote's items, each edited in place, with a row at the end to add the next one: type what is on offer, Tab to the
 * quantity and the price, Enter. They add up to the quote's total, which follows them. A quote is a document: its items
 * change only while it is a draft, so one that was sent stays as the customer saw it.
 */
export const quoteItemsBlock = defineBlockComponent({
  id: ids.blocks.quote_items,
  label: 'Items',
  icon: 'list',
  surfaces: { record: { objectIds: [ids.objects.quote], frame: false } },
  component: function QuoteItems() {
    const { object, record, readOnly } = useRecordPage();
    const money = useQuoteMoney();
    const query = useMemo(
      () => ({
        object: 'quote_item',
        filter: { field: 'quote', op: 'eq' as const, value: record.id },
        sort: [{ field: 'created_at', direction: 'asc' as const }],
        limit: 200,
      }),
      [record.id],
    );
    const list = useRecords(query);
    const items = list.data?.items ?? [];
    const create = useCreateRecord('quote_item');
    const updateItem = useUpdateRecord('quote_item');
    const remove = useDeleteRecords('quote_item');
    const updateQuote = useUpdateRecord(object.nameSingular);
    const total = itemsTotal(items);
    const editable = !readOnly && record.status === 'draft';
    const busy = create.isPending || updateItem.isPending || remove.isPending;
    const { isPending: syncing, mutate: setTotal } = updateQuote;
    const stored = record.total === null || record.total === undefined ? null : num(record.total);

    // The total follows the items once this page has changed them; opening a quote writes nothing. (The agent and
    // workflows run the recalculate action after they change items.)
    const changed = useRef(false);
    useEffect(() => {
      if (!changed.current || !editable || syncing || !list.data) {
        return;
      }

      if (stored === null || round2(stored) !== total) {
        setTotal({ id: record.id, patch: { total } });
      } else {
        changed.current = false;
      }
    }, [editable, syncing, list.data, total, stored, record.id, setTotal]);
    const touched = {
      onSuccess: () => {
        changed.current = true;
      },
    };

    if (list.isPending) {
      return <Skeleton className="h-24 w-full" />;
    }

    return (
      <div data-slot="quote-items">
        <div className="overflow-x-auto">
          <table className="w-full min-w-96 text-xs">
            <thead>
              <tr className={cn(TABLE_ROW, 'border-t')}>
                <th className={TABLE_HEAD}>Description</th>
                <th className={cn(TABLE_HEAD, 'w-20 text-right')}>Qty</th>
                <th className={cn(TABLE_HEAD, 'w-28 text-right')}>Unit price</th>
                <th className={cn(TABLE_HEAD, 'w-24 text-right')}>Amount</th>
                <th className={cn(TABLE_HEAD, 'w-8')} />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={TABLE_ROW} data-item={item.id}>
                  {['description', 'quantity', 'unit_price'].map((name) => (
                    <td key={name} className={cn(TABLE_CELL, 'py-1', name !== 'description' && 'text-right')}>
                      <ItemValue
                        name={name}
                        record={item}
                        editable={editable}
                        onCommit={(field, value) =>
                          updateItem.mutate({ id: item.id, patch: { [field]: value } }, touched)
                        }
                      />
                    </td>
                  ))}
                  <td className={cn(TABLE_CELL, 'text-right tabular-nums')}>{money(lineTotal(item))}</td>
                  <td className={cn(TABLE_CELL, 'py-1 text-right')}>
                    {editable ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Remove item"
                        disabled={busy}
                        onClick={() => remove.mutate([item.id], touched)}
                      >
                        <Icon name="x" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {editable ? (
                <AddItem quoteId={record.id} busy={busy} onAdd={(item) => create.mutate(item, touched)} />
              ) : items.length === 0 ? (
                <tr className={TABLE_ROW}>
                  <td colSpan={5} className={cn(TABLE_CELL, 'py-6 text-center text-muted-foreground')}>
                    No items.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr data-slot="quote-total">
                <td colSpan={3} className={cn(TABLE_CELL, 'py-2 text-right text-muted-foreground')}>
                  Total
                </td>
                <td className={cn(TABLE_CELL, 'py-2 text-right font-semibold tabular-nums')}>{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        {editable ? null : (
          <p className="mt-2 text-xs text-muted-foreground" data-slot="quote-locked">
            Items can only be changed while the quote is a draft.
          </p>
        )}
      </div>
    );
  },
});
