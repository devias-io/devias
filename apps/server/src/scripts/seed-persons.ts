import { insertPersons } from './seed-persons-batch';
import { runSeed } from './seed-run';

/**
 * Fills a workspace with people (the CRM's `person` object) for load testing lists, filters, sorting and search.
 *
 *   pnpm --filter @devias/server-app seed:persons                       # 1,000,000 people in the only workspace
 *   pnpm --filter @devias/server-app seed:persons --count 250000        # a different number
 *   pnpm --filter @devias/server-app seed:persons --workspace <id>      # when there is more than one workspace
 *   pnpm --filter @devias/server-app seed:persons --batch 50000         # rows per statement (default 25000)
 *   pnpm --filter @devias/server-app seed:persons --remove              # delete what this script added
 *
 * The rows are generated inside the database in batches (`generate_series`), so a million take about a minute on
 * Postgres. They are written straight to the `record` table: no record events, workflows or notifications fire, and
 * they are marked `created_by = 'seed:persons'` so `--remove` can take exactly them out again. Each person gets a
 * unique email, and, when the workspace has companies (seed those first: `seed:companies`), one of its first 100,000
 * as their company. Run it against Postgres (`DATABASE_URL`): with PGlite it is slow and the dev server must be
 * stopped first, as it tolerates one process per data directory.
 */
runSeed({
  object: 'person',
  label: 'people',
  tag: 'seed:persons',
  defaultCount: 1_000_000,
  command: 'seed:persons',
  insert: (db, { workspaceId, objectId, objects, idSql, run, from, to }) =>
    insertPersons(db, {
      workspaceId,
      personObjectId: objectId,
      companyObjectId: objects.get('company'),
      idSql,
      run,
      from,
      to,
      tag: 'seed:persons',
    }),
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
