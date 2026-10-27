import { expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { ids } from '../src/manifest/ids';

it('names its actions apart from their ids', () => {
  expect(manifest.actions.map((action) => [action.id, action.name])).toEqual([
    [ids.actions.create_invoice_payment_link, 'create_invoice_payment_link'],
    [ids.actions.handle_checkout_event, 'handle_checkout_event'],
  ]);
});

it('comes with the workflow that records a payment when Stripe reports one', () => {
  expect(manifest.workflows).toEqual([
    expect.objectContaining({
      id: ids.workflows.apply_checkout_payments,
      trigger: {
        kind: 'module_event',
        moduleId: manifest.id,
        types: ['checkout.session.completed', 'checkout.session.async_payment_succeeded'],
      },
      steps: [
        expect.objectContaining({
          id: ids.steps.handle_checkout_event,
          actionId: ids.actions.handle_checkout_event,
          input: { event: '{{event.payload}}' },
        }),
      ],
    }),
  ]);
  // The events it listens to are ones the module delivers.
  const delivered = new Set(manifest.events.map((event) => event.name));
  const trigger = manifest.workflows[0]?.trigger;
  expect(trigger?.kind === 'module_event' && trigger.types.every((type) => delivered.has(type))).toBe(true);
});
