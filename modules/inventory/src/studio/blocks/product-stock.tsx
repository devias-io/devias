import { defineBlockComponent, type Filter } from '@devias/core';
import { ids as products } from '@devias/mod-products/manifest';
import {
  EditableValue,
  getFieldType,
  useAggregate,
  useFields,
  useFieldTypes,
  useRecordPage,
  useUpdateRecord,
} from '@devias/studio';
import { Button, Skeleton } from '@devias/ui';
import { useMemo } from 'react';
import { formatQuantity, isLow, movesTotal, onHandOf, totalOnHand } from '../../lib/stock';
import { ids } from '../../manifest';

/** What stock is counted against: the product's reorder point, edited in place. */
function ReorderPoint() {
  const { object, record, readOnly } = useRecordPage();
  const fields = useFields(object.id);
  const fieldTypes = useFieldTypes();
  const update = useUpdateRecord(object.nameSingular);
  const field = fields.find((candidate) => candidate.name === 'reorder_point');

  if (!field) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border pt-2 text-xs">
      <span className="text-muted-foreground">{field.label}</span>
      <div className="-me-1.5 w-32 [&>div]:justify-end [&_[data-slot=edit-hint]]:hidden">
        <EditableValue
          field={field}
          fieldType={getFieldType(fieldTypes, field.type)}
          record={record}
          object={object}
          editable={!readOnly}
          onCommit={(value) => update.mutate({ id: record.id, patch: { reorder_point: value } })}
        />
      </div>
    </div>
  );
}

/** A tracked product's stock on hand: the total, each location's share, and whether it is low. */
function Tracked() {
  const { record } = useRecordPage();
  const filter = useMemo<Filter>(() => ({ field: 'product', op: 'eq', value: record.id }), [record.id]);
  const ins = useAggregate(useMemo(() => movesTotal('in', 'location', filter), [filter]));
  const outs = useAggregate(useMemo(() => movesTotal('out', 'location', filter), [filter]));

  if (!ins.data || !outs.data) {
    return <Skeleton className="h-6 w-1/2" />;
  }

  const total = totalOnHand(ins.data, outs.data);
  const locations = [...onHandOf(ins.data, outs.data).values()].sort((a, b) => a.label.localeCompare(b.label));
  const low = isLow(total, record.reorder_point);

  return (
    <div className="flex flex-col gap-2 text-xs" data-slot="product-stock">
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">{formatQuantity(total, record.unit)}</span>
        <span className="text-muted-foreground">in stock</span>
        {low ? (
          <span className="ms-auto rounded-sm bg-warning/10 px-1.5 text-xs text-warning" data-slot="low-stock">
            Low
          </span>
        ) : null}
      </div>
      {locations.length === 0 ? (
        <p className="text-muted-foreground">No stock moves yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {locations.map((location) => (
            <li key={location.label} className="flex items-center justify-between py-1.5">
              <span className="truncate">{location.label}</span>
              <span className="tabular-nums">{formatQuantity(location.onHand, record.unit)}</span>
            </li>
          ))}
        </ul>
      )}
      <ReorderPoint />
    </div>
  );
}

/** A product page's Stock: the figures when the product is tracked, else a line saying it is not, and a way to start. */
function ProductStock() {
  const { object, record, readOnly } = useRecordPage();
  const update = useUpdateRecord(object.nameSingular);

  if (record.tracked === true) {
    return <Tracked />;
  }

  return (
    <div className="flex items-center justify-between gap-3 text-xs" data-slot="product-stock-off">
      <p className="text-muted-foreground">Its stock is not counted.</p>
      {readOnly ? null : (
        <Button
          size="xs"
          variant="outline"
          disabled={update.isPending}
          onClick={() => update.mutate({ id: record.id, patch: { tracked: true } })}
        >
          Track stock
        </Button>
      )}
    </div>
  );
}

/** "Stock" in the main column of every product page, right after its prices, without the product layout naming it. */
export const productStockBlock = defineBlockComponent({
  id: ids.blocks.product_stock,
  label: 'Stock',
  icon: 'package',
  requires: { objectIds: [ids.objects.stock_move] },
  surfaces: {
    record: {
      objectIds: [products.objects.product],
      placement: 'main',
      after: products.blocks.product_prices,
      frame: false,
    },
  },
  component: () => <ProductStock />,
});
