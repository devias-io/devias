import { insertCompanies } from './seed-companies-batch';
import { runSeed } from './seed-run';

/**
 * Fills a workspace with companies (the CRM's `company` object) for load testing, and for people to belong to.
 *
 *   pnpm --filter @devias/server-app seed:companies                     # 100,000 companies in the only workspace
 *   pnpm --filter @devias/server-app seed:companies --count 20000       # a different number
 *   pnpm --filter @devias/server-app seed:companies --workspace <id>    # when there is more than one workspace
 *   pnpm --filter @devias/server-app seed:companies --remove            # delete what this script added
 *
 * Works the same way as `seed:persons`: rows are generated inside the database, written straight to the `record`
 * table without events, and marked `created_by = 'seed:companies'` for `--remove`. Names and domains are unique, also
 * across runs. Run this before `seed:persons` so the people get a company.
 */
runSeed({
  object: 'company',
  label: 'companies',
  tag: 'seed:companies',
  defaultCount: 100_000,
  command: 'seed:companies',
  insert: (db, { workspaceId, objectId, idSql, from, to }) =>
    insertCompanies(db, { workspaceId, companyObjectId: objectId, idSql, from, to, tag: 'seed:companies' }),
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
