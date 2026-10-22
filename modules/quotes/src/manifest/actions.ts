import { defineAction } from '@devias/core';
import { ids } from './ids';

/**
 * The action workflows, the API and the agent can call; `../server` implements it. It works inside the workspace only,
 * so its output is not outside content.
 */
export const actions = [
  defineAction({
    id: ids.actions.recalculate_quote,
    label: 'Recalculate a quote',
    icon: 'refresh-cw',
    description: "Add the quote's items up and store the total on the quote.",
    input: [{ name: 'quote_id', label: 'Quote', type: 'record', objectId: ids.objects.quote, required: true }],
    output: [
      { name: 'id', type: 'record', objectId: ids.objects.quote, description: 'The quote.' },
      { name: 'total', type: 'number', description: "The quote's fresh total." },
      { name: 'items', type: 'number', description: 'How many items it has.' },
    ],
    approval: 'auto',
    external: false,
  }),
];
