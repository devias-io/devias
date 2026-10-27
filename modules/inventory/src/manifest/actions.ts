import { defineAction } from '@devias/core';
import { ids } from './ids';

/**
 * What workflows, the API and the agent can call beyond recording a move (a move is a record: `create_record`).
 * All three work inside the workspace only, so their output is not outside content.
 */
export const actions = [
  defineAction({
    id: ids.actions.stock_on_hand,
    name: 'stock_on_hand',
    label: 'Stock on hand',
    description: 'Stock on hand by product and location, and what is low. Filter by product or location.',
    input: [
      { name: 'product', label: 'Product id', help: 'Only this product.' },
      { name: 'location', label: 'Location id', help: 'Only this location.' },
    ],
    output: [
      {
        name: 'products',
        type: 'json',
        description: 'Products with any move: stock on hand, reorder point, low flag, and by location.',
      },
    ],
    approval: 'auto',
    external: false,
  }),
  defineAction({
    id: ids.actions.transfer,
    name: 'transfer_stock',
    label: 'Move stock between locations',
    description: 'Move a quantity of a product from one location to another.',
    input: [
      { name: 'product', label: 'Product id', required: true },
      { name: 'from', label: 'From location id', required: true },
      { name: 'to', label: 'To location id', required: true },
      { name: 'quantity', label: 'Quantity', type: 'number', required: true },
      { name: 'moved_on', label: 'Date', placeholder: '{{today}}', help: 'YYYY-MM-DD; defaults to today.' },
      { name: 'reference', label: 'Reference' },
    ],
    output: [
      {
        name: 'out',
        type: 'record',
        objectId: ids.objects.stock_move,
        description: 'The move out of the first location.',
      },
      { name: 'in', type: 'record', objectId: ids.objects.stock_move, description: 'The move into the second.' },
    ],
    external: false,
  }),
  defineAction({
    id: ids.actions.count,
    name: 'count_stock',
    label: 'Record a stock count',
    description: 'Record the counted quantity of a product at a location; any difference is recorded as a count move.',
    input: [
      { name: 'product', label: 'Product id', required: true },
      { name: 'location', label: 'Location id', required: true },
      { name: 'counted', label: 'Counted', type: 'number', required: true },
      { name: 'counted_on', label: 'Date', placeholder: '{{today}}', help: 'YYYY-MM-DD; defaults to today.' },
    ],
    output: [
      { name: 'before', type: 'number', description: 'What the moves added up to before the count.' },
      { name: 'counted', type: 'number', description: 'What was counted.' },
      { name: 'difference', type: 'number', description: 'Counted minus before.' },
      {
        name: 'move_id',
        type: 'record',
        objectId: ids.objects.stock_move,
        description: 'The count move that recorded the difference; null when it matched.',
      },
    ],
    external: false,
  }),
];
