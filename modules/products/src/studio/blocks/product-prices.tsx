import { defineBlockComponent } from '@devias/core';
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
import {
  Button,
  cn,
  Icon,
  Input,
  NativeSelect,
  NativeSelectOption,
  Skeleton,
  TABLE_CELL,
  TABLE_HEAD,
  TABLE_ROW,
} from '@devias/ui';
import { useMemo, useRef, useState } from 'react';
import {
  type Billing,
  billingLabel,
  billingOf,
  billingOfCadence,
  CADENCES,
  type CadenceKey,
  cadenceKeyOf,
} from '../../lib/billing';
import { ids } from '../../manifest';

/** One field of a price as a click-to-edit value, its text lined up with the column's heading. */
function PriceValue({
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
  const object = useObject('price');
  const fields = useFields(object?.id);
  const fieldTypes = useFieldTypes();
  const field = fields.find((candidate) => candidate.name === name);

  if (!object || !field) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  return (
    <div className={cn('-mx-1.5', name === 'amount' && '[&>div]:justify-end [&_[data-slot=edit-hint]]:hidden')}>
      <EditableValue
        field={field}
        fieldType={getFieldType(fieldTypes, field.type)}
        record={record as never}
        object={object}
        editable={editable}
        onCommit={(value) => onCommit(name, value)}
      />
    </div>
  );
}

/** The schedules to choose from; a price on one of its own is listed too, so the choice shows what it is. */
function CadenceSelect({
  billing,
  onChange,
  label,
  disabled,
}: {
  billing: Billing;
  onChange: (key: CadenceKey) => void;
  label: string;
  disabled?: boolean;
}) {
  const current = cadenceKeyOf(billing);

  return (
    <NativeSelect
      size="sm"
      aria-label={label}
      disabled={disabled}
      className="w-full"
      value={current ?? 'custom'}
      onChange={(event) => onChange(event.target.value as CadenceKey)}
    >
      {current === null ? <NativeSelectOption value="custom">{billingLabel(billing)}</NativeSelectOption> : null}
      {CADENCES.map((cadence) => (
        <NativeSelectOption key={cadence.key} value={cadence.key}>
          {cadence.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** The row at the end: a name, how it is billed and an amount; Enter adds it. */
function AddPrice({ busy, onAdd }: { busy: boolean; onAdd: (price: Record<string, unknown>) => void }) {
  const [nickname, setNickname] = useState('');
  const [cadence, setCadence] = useState<CadenceKey>('once');
  const [amount, setAmount] = useState('');
  const first = useRef<HTMLInputElement>(null);
  const ready = amount !== '' && Number(amount) >= 0;
  const submit = () => {
    if (!ready || busy) {
      return;
    }

    onAdd({ nickname: nickname.trim() || undefined, amount: Number(amount), ...billingOfCadence(cadence) });
    setNickname('');
    setCadence('once');
    setAmount('');
    first.current?.focus();
  };
  const enter = (event: { key: string; preventDefault: () => void }) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <tr className={TABLE_ROW} data-slot="add-price">
      <td className={cn(TABLE_CELL, 'py-1.5')}>
        <div className="flex items-center gap-2">
          <Icon name="plus" className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={first}
            aria-label="New price name"
            placeholder="Add a price…"
            className="h-7 border-transparent bg-transparent px-1 shadow-none focus-visible:bg-background"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            onKeyDown={enter}
          />
        </div>
      </td>
      <td className={cn(TABLE_CELL, 'py-1.5')}>
        <CadenceSelect billing={billingOfCadence(cadence)} label="New price billing" onChange={setCadence} />
      </td>
      <td className={cn(TABLE_CELL, 'py-1.5 text-right')}>
        <Input
          aria-label="New price amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder="0"
          className="h-7 w-full text-right"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onKeyDown={enter}
        />
      </td>
      <td className={cn(TABLE_CELL, 'py-1.5 text-right')}>
        <Button size="xs" variant="outline" disabled={!ready || busy} onClick={submit} data-action="add-price">
          Add
        </Button>
      </td>
    </tr>
  );
}

/**
 * A product's prices, each edited in place, with a row at the end to add the next one. The first price a product
 * gets is its default; the star moves it. A price that was sold is turned off from its own page rather than deleted.
 */
export const productPricesBlock = defineBlockComponent({
  id: ids.blocks.product_prices,
  label: 'Prices',
  icon: 'tag',
  surfaces: { record: { objectIds: [ids.objects.product], frame: false } },
  component: function ProductPrices() {
    const { object, record, readOnly } = useRecordPage();
    const query = useMemo(
      () => ({
        object: 'price',
        filter: { field: 'product', op: 'eq' as const, value: record.id },
        sort: [{ field: 'created_at', direction: 'asc' as const }],
        limit: 200,
      }),
      [record.id],
    );
    const list = useRecords(query);
    const prices = list.data?.items ?? [];
    const create = useCreateRecord('price');
    const updatePrice = useUpdateRecord('price');
    const remove = useDeleteRecords('price');
    const updateProduct = useUpdateRecord(object.nameSingular);
    const busy = create.isPending || updatePrice.isPending || remove.isPending || updateProduct.isPending;
    const editable = !readOnly;
    const defaultId = typeof record.default_price === 'string' ? record.default_price : null;
    const makeDefault = (id: string | null) => updateProduct.mutate({ id: record.id, patch: { default_price: id } });

    if (list.isPending) {
      return <Skeleton className="h-24 w-full" />;
    }

    return (
      <div data-slot="product-prices">
        <table className="w-full min-w-96 table-fixed text-xs">
          <thead>
            <tr className={cn(TABLE_ROW, 'border-t')}>
              <th className={TABLE_HEAD}>Name</th>
              <th className={cn(TABLE_HEAD, 'w-40')}>Billing</th>
              <th className={cn(TABLE_HEAD, 'w-28 text-right')}>Amount</th>
              <th className={cn(TABLE_HEAD, 'w-16')} />
            </tr>
          </thead>
          <tbody>
            {prices.map((price) => {
              const isDefault = price.id === defaultId;
              const billing = billingOf(price);

              return (
                <tr
                  key={price.id}
                  className={cn(TABLE_ROW, price.active === false && 'text-muted-foreground')}
                  data-price={price.id}
                  data-default={isDefault ? '' : undefined}
                >
                  <td className={cn(TABLE_CELL, 'py-1')}>
                    <PriceValue
                      name="nickname"
                      record={price}
                      editable={editable}
                      onCommit={(field, value) => updatePrice.mutate({ id: price.id, patch: { [field]: value } })}
                    />
                  </td>
                  <td className={cn(TABLE_CELL, 'py-1')}>
                    {editable ? (
                      <CadenceSelect
                        billing={billing}
                        label="Billing"
                        onChange={(key) => updatePrice.mutate({ id: price.id, patch: { ...billingOfCadence(key) } })}
                      />
                    ) : (
                      billingLabel(billing)
                    )}
                  </td>
                  <td className={cn(TABLE_CELL, 'py-1')}>
                    <PriceValue
                      name="amount"
                      record={price}
                      editable={editable}
                      onCommit={(field, value) => updatePrice.mutate({ id: price.id, patch: { [field]: value } })}
                    />
                  </td>
                  <td className={cn(TABLE_CELL, 'py-1 text-right')}>
                    <span className="inline-flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={isDefault ? 'Default price' : 'Make default'}
                        aria-pressed={isDefault}
                        disabled={busy || !editable || isDefault}
                        className={cn(isDefault ? 'text-yellow-500' : 'text-muted-foreground')}
                        onClick={() => makeDefault(price.id)}
                      >
                        <Icon name="star" className={cn(isDefault && 'fill-yellow-400')} />
                      </Button>
                      {editable ? (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Remove price"
                          disabled={busy}
                          onClick={() => {
                            if (isDefault) {
                              makeDefault(null);
                            }

                            remove.mutate([price.id]);
                          }}
                        >
                          <Icon name="x" />
                        </Button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
            {editable ? (
              <AddPrice
                busy={busy}
                onAdd={(price) =>
                  create.mutate(
                    { ...price, product: record.id },
                    {
                      // The first price is the product's default.
                      onSuccess: (created) => {
                        if (!defaultId && prices.length === 0) {
                          makeDefault(created.id);
                        }
                      },
                    },
                  )
                }
              />
            ) : prices.length === 0 ? (
              <tr className={TABLE_ROW}>
                <td colSpan={4} className={cn(TABLE_CELL, 'py-6 text-center text-muted-foreground')}>
                  No prices.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    );
  },
});
