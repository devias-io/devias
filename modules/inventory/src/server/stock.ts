import type { Filter, RecordData } from '@devias/core';
import type { ScopedEngine } from '@devias/server';
import { isLow, movesTotal, onHandOf, roundQuantity, totalOnHand } from '../lib/stock';

export interface ProductStock {
  id: string;
  name: string;
  unit: string | null;
  on_hand: number;
  reorder_point: number | null;
  low: boolean;
  locations: { id: string; name: string; on_hand: number }[];
}

const idIs = (field: string, id: string | undefined): Filter | undefined =>
  id ? { field, op: 'eq', value: id } : undefined;

/** How much of one product is at one location: what the moves there add up to. */
export const onHandAt = async (engine: ScopedEngine, product: string, location: string): Promise<number> => {
  const filter: Filter = {
    and: [
      { field: 'product', op: 'eq', value: product },
      { field: 'location', op: 'eq', value: location },
    ],
  };
  const [ins, outs] = await Promise.all([
    engine.records.aggregate(movesTotal('in', undefined, filter)),
    engine.records.aggregate(movesTotal('out', undefined, filter)),
  ]);

  return totalOnHand(ins, outs);
};

/**
 * Stock on hand by product and location, added up from the moves: per location, what came in and went out of each
 * product. Products with no move are left out unless asked for by id.
 */
export const stockOnHand = async (
  engine: ScopedEngine,
  scope: { product?: string | undefined; location?: string | undefined } = {},
): Promise<ProductStock[]> => {
  const locations = (
    await engine.records.list({ object: 'location', select: ['name'], filter: idIs('id', scope.location), limit: 200 })
  ).items;
  const byProduct = new Map<string, { name: string; locations: ProductStock['locations'] }>();
  await Promise.all(
    locations.map(async (location) => {
      const filter = { and: [{ field: 'location', op: 'eq', value: location.id }, idIs('product', scope.product)] };
      const where = { and: filter.and.filter(Boolean) } as Filter;
      const [ins, outs] = await Promise.all([
        engine.records.aggregate(movesTotal('in', 'product', where)),
        engine.records.aggregate(movesTotal('out', 'product', where)),
      ]);

      for (const [id, level] of onHandOf(ins, outs)) {
        const entry = byProduct.get(id) ?? { name: level.label, locations: [] };
        entry.locations.push({ id: location.id, name: String(location.name ?? location.id), on_hand: level.onHand });
        byProduct.set(id, entry);
      }
    }),
  );

  if (scope.product && !byProduct.has(scope.product)) {
    byProduct.set(scope.product, { name: scope.product, locations: [] });
  }

  const ids = [...byProduct.keys()];
  const products = new Map<string, RecordData>();

  if (ids.length > 0) {
    const found = await engine.records.list({
      object: 'product',
      select: ['name', 'unit', 'reorder_point'],
      filter: { field: 'id', op: 'in', value: ids },
      limit: ids.length,
    });

    for (const product of found.items) {
      products.set(product.id, product);
    }
  }

  return ids
    .map((id): ProductStock => {
      const entry = byProduct.get(id) as { name: string; locations: ProductStock['locations'] };
      const product = products.get(id);
      const onHand = roundQuantity(entry.locations.reduce((sum, location) => sum + location.on_hand, 0));
      const reorderPoint = typeof product?.reorder_point === 'number' ? product.reorder_point : null;

      return {
        id,
        name: typeof product?.name === 'string' ? product.name : entry.name,
        unit: typeof product?.unit === 'string' ? product.unit : null,
        on_hand: onHand,
        reorder_point: reorderPoint,
        low: isLow(onHand, reorderPoint),
        locations: entry.locations.sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};
