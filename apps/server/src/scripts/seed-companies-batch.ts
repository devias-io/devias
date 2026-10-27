import { sql } from 'drizzle-orm';
import { type Db, list, PLACES, pick, SOURCES, type SqlFragment } from './seed-sql';

const ADJECTIVES = [
  'Apex',
  'Bright',
  'Blue',
  'Clear',
  'Delta',
  'Eastern',
  'First',
  'Global',
  'Green',
  'Horizon',
  'Iron',
  'Jade',
  'Keystone',
  'Lumen',
  'Meridian',
  'Nordic',
  'Northern',
  'Orbit',
  'Pioneer',
  'Prime',
  'Quantum',
  'Red',
  'Silver',
  'Summit',
  'Titan',
  'Union',
  'Vertex',
  'Western',
  'Zenith',
  'Atlas',
];
const NOUNS = [
  'Systems',
  'Labs',
  'Works',
  'Logistics',
  'Capital',
  'Networks',
  'Dynamics',
  'Foods',
  'Energy',
  'Health',
  'Media',
  'Software',
  'Industries',
  'Consulting',
  'Partners',
  'Solutions',
  'Materials',
  'Mobility',
  'Analytics',
  'Robotics',
  'Retail',
  'Finance',
  'Studios',
  'Cloud',
  'Trade',
  'Design',
  'Construct',
  'Agro',
  'Pharma',
  'Telecom',
];
const SUFFIXES = ['SRL', 'Ltd', 'GmbH', 'Inc', 'SA', 'BV'];
const INDUSTRIES = ['software', 'services', 'manufacturing', 'retail', 'finance', 'healthcare', 'other'];
const COMBINATIONS = ADJECTIVES.length * NOUNS.length * SUFFIXES.length;
/** A number written into the SQL itself, so Postgres does not have to guess the type of a parameter. */
const lit = (value: number) => sql.raw(String(value));

/**
 * Adds the companies numbered `from` to `to` (inclusive) to a workspace, generated inside the database. Names are
 * unique: each number maps to its own adjective, noun and suffix (a shuffled walk through every combination, since 7919 is prime and shares no factor with their number), and
 * past the last combination a counter is added. The domain is made from the name, so it is unique too.
 */
export const insertCompanies = async (
  db: Db,
  options: {
    workspaceId: string;
    companyObjectId: string;
    idSql: SqlFragment;
    /** Marks the rows so `--remove` can find them again. */
    tag: string;
    from: number;
    to: number;
  },
) => {
  const { workspaceId, companyObjectId, idSql, tag, from, to } = options;
  await db.execute(sql`
    with rows as (
      select g.n, r.*
      from generate_series(${from}::bigint, ${to}::bigint) as g(n)
      cross join lateral (
        select
          ((g.n - 1) * 7919) % ${lit(COMBINATIONS)} as k,
          (g.n - 1) / ${lit(COMBINATIONS)} as lap,
          ${pick(INDUSTRIES)} as industry,
          ${pick(SOURCES)} as source,
          (${sql.raw(`array[${PLACES.map(([c]) => `'${c.replaceAll("'", "''")}'`).join(',')}]::text[]`)})[1 + floor(greatest(random(), g.n * 0) * ${lit(PLACES.length)})::int] as city,
          greatest(random(), g.n * 0) as r_size,
          greatest(random(), g.n * 0) as r_revenue,
          greatest(random(), g.n * 0) as r_flag,
          greatest(random(), g.n * 0) as r_phone,
          now() - greatest(random(), g.n * 0) * interval '1460 days' as created_at
        offset 0
      ) r
    ),
    named as (
      select
        rows.*,
        (${list(ADJECTIVES)})[1 + (rows.k / ${lit(NOUNS.length * SUFFIXES.length)})::int] as adjective,
        (${list(NOUNS)})[1 + ((rows.k / ${lit(SUFFIXES.length)}) % ${lit(NOUNS.length)})::int] as noun,
        (${list(SUFFIXES)})[1 + (rows.k % ${lit(SUFFIXES.length)})::int] as suffix,
        -- Most companies are small: the headcount is spread evenly on a log scale from 1 to 5,000 people.
        greatest(1, floor(exp(rows.r_size * ln(5000))))::int as employees
      from rows
    ),
    finished as (
      select
        named.*,
        named.adjective || ' ' || named.noun || ' ' || named.suffix || case when named.lap > 0 then ' ' || (named.lap + 1) else '' end as name,
        lower(named.adjective || named.noun) || '-' || named.k || case when named.lap > 0 then '-' || named.lap else '' end as slug
      from named
    )
    insert into record (id, workspace_id, object_id, data, created_at, updated_at, created_by, updated_by)
    select
      ${idSql},
      ${workspaceId},
      ${companyObjectId},
      jsonb_build_object(
        'name', finished.name,
        'domain', finished.slug || '.com',
        'industry', finished.industry,
        'employees', finished.employees,
        'annual_revenue', (finished.employees * (40000 + floor(finished.r_revenue * 160000)) / 1000)::bigint * 1000,
        'ideal_customer_profile', finished.r_flag < 0.2,
        'city', finished.city,
        'linkedin', 'https://www.linkedin.com/company/' || finished.slug,
        'email', 'hello@' || finished.slug || '.com',
        'description', finished.adjective || ' ' || finished.noun || ' works with ' || finished.industry || ' teams in ' || finished.city || '.',
        'source', finished.source
      ) || case when finished.r_phone < 0.6
        then jsonb_build_object('phone', '+40 2' || lpad((floor(finished.r_phone / 0.6 * 100000000))::bigint::text, 8, '0'))
        else '{}'::jsonb end,
      finished.created_at,
      finished.created_at,
      ${tag},
      ${tag}
    from finished
  `);
};
