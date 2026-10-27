import { insertInvoices } from './seed-invoices-batch';
import { runSeed } from './seed-run';

/**
 * Fills a workspace with invoices (the invoicing module's `invoice` object) for load testing the Billing page, lists
 * and filters. Each invoice gets one to five lines, and paid invoices (and some sent ones, partly) a payment.
 *
 *   pnpm --filter @devias/server-app seed:invoices                      # 200,000 invoices in the only workspace
 *   pnpm --filter @devias/server-app seed:invoices --count 50000        # a different number
 *   pnpm --filter @devias/server-app seed:invoices --workspace <id>     # when there is more than one workspace
 *   pnpm --filter @devias/server-app seed:invoices --remove             # delete the invoices, lines and payments it added
 *
 * Works the same way as `seed:persons`: rows are generated inside the database, written straight to the `record`
 * table without events, and marked `created_by = 'seed:invoices'` for `--remove`. Numbers run INV-000001 upwards and
 * carry on from earlier runs. Seed companies first (`seed:companies`) so each invoice goes to one; the count is of
 * invoices, so there are about three times as many rows in all.
 */
runSeed({
  object: 'invoice',
  label: 'invoices',
  tag: 'seed:invoices',
  defaultCount: 200_000,
  command: 'seed:invoices',
  alsoRemove: ['invoice_line', 'payment'],
  insert: (db, { workspaceId, objectId, objects, idSql, from, to }) =>
    insertInvoices(db, {
      workspaceId,
      invoiceObjectId: objectId,
      lineObjectId: objects.get('invoice_line'),
      paymentObjectId: objects.get('payment'),
      companyObjectId: objects.get('company'),
      idSql,
      from,
      to,
      tag: 'seed:invoices',
    }),
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
