import { defineBlockComponent, type Query } from '@devias/core';
import { links, useAggregate, useNavigation, useRecords, useWorkspace } from '@devias/studio';
import { Highlight, InsightCard, InsightText, Skeleton } from '@devias/ui';
import { useMemo } from 'react';
import { formatQuantity, isLow, movesTotal, onHandOf } from '../../lib/stock';
import { ids } from '../../manifest';

const ins = movesTotal('in', 'product');
const outs = movesTotal('out', 'product');
const withReorderPoint: Query = {
  object: 'product',
  select: ['name', 'unit', 'reorder_point'],
  filter: {
    and: [
      { field: 'tracked', op: 'eq', value: true },
      { field: 'reorder_point', op: 'is_not_empty' },
    ],
  },
  limit: 200,
};

/** Home block: the products at or below their reorder point, the furthest below first. */
function LowStockCard() {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const products = useRecords(withReorderPoint);
  const added = useAggregate(ins);
  const taken = useAggregate(outs);
  const low = useMemo(() => {
    if (!products.data || !added.data || !taken.data) {
      return null;
    }

    const levels = onHandOf(added.data, taken.data);

    return products.data.items
      .map((product) => ({ product, onHand: levels.get(product.id)?.onHand ?? 0 }))
      .filter(({ product, onHand }) => isLow(onHand, product.reorder_point))
      .sort((a, b) => a.onHand - Number(a.product.reorder_point) - (b.onHand - Number(b.product.reorder_point)));
  }, [products.data, added.data, taken.data]);

  return (
    <InsightCard icon="package" title="Low stock">
      {low === null ? (
        <Skeleton className="h-6 w-3/4" />
      ) : low.length === 0 ? (
        <InsightText>Every product with a reorder point has enough in stock.</InsightText>
      ) : (
        <>
          <InsightText>
            <Highlight>
              {low.length} {low.length === 1 ? 'product is' : 'products are'}
            </Highlight>{' '}
            at or below the reorder point.
          </InsightText>
          <ul className="mt-2 flex flex-col text-xs" data-slot="low-stock-list">
            {low.slice(0, 5).map(({ product, onHand }) => (
              <li key={product.id}>
                <navigation.Link
                  href={links.record(slug, 'product', product.id)}
                  className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
                >
                  <span className="truncate">{typeof product.name === 'string' ? product.name : product.id}</span>
                  <span className="shrink-0 text-xs text-warning tabular-nums">
                    {formatQuantity(onHand, product.unit)} of{' '}
                    {formatQuantity(Number(product.reorder_point), product.unit)}
                  </span>
                </navigation.Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </InsightCard>
  );
}

export const lowStockBlock = defineBlockComponent({
  id: ids.blocks.low_stock,
  label: 'Low stock',
  icon: 'package',
  requires: { objectIds: [ids.objects.stock_move] },
  surfaces: { home: { order: 40 } },
  component: LowStockCard,
});
