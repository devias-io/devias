import { sql } from 'drizzle-orm';
import { type Db, PLACES, pick, SOURCES } from './seed-sql';

const FIRST_NAMES = [
  'Adrian',
  'Alexandra',
  'Andrei',
  'Ana',
  'Bianca',
  'Bogdan',
  'Camelia',
  'Cătălin',
  'Cristina',
  'Dan',
  'Daniela',
  'Elena',
  'Emil',
  'Florin',
  'Gabriela',
  'George',
  'Ioana',
  'Ion',
  'Irina',
  'Laura',
  'Lucian',
  'Maria',
  'Mihai',
  'Mihaela',
  'Nicolae',
  'Oana',
  'Paul',
  'Radu',
  'Raluca',
  'Sorin',
  'Ștefan',
  'Teodora',
  'Tudor',
  'Vlad',
  'Victor',
  'James',
  'Emma',
  'Liam',
  'Olivia',
  'Noah',
  'Sophia',
  'Lucas',
  'Mia',
  'Henry',
  'Charlotte',
  'Daniel',
  'Amelia',
  'Marco',
  'Giulia',
  'Lukas',
  'Hannah',
  'Pierre',
  'Camille',
  'Javier',
  'Lucía',
  'Jan',
  'Eva',
];
const LAST_NAMES = [
  'Popescu',
  'Ionescu',
  'Popa',
  'Stan',
  'Dumitru',
  'Gheorghe',
  'Constantin',
  'Marin',
  'Stoica',
  'Munteanu',
  'Manea',
  'Rusu',
  'Barbu',
  'Matei',
  'Radu',
  'Vasile',
  'Dinu',
  'Tudor',
  'Neagu',
  'Preda',
  'Comanescu',
  'Lungu',
  'Moldovan',
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Miller',
  'Davis',
  'Wilson',
  'Taylor',
  'Clark',
  'Walker',
  'Rossi',
  'Bianchi',
  'Müller',
  'Schmidt',
  'Dubois',
  'Martin',
  'García',
  'López',
  'Novak',
  'Kowalski',
];
const JOB_TITLES = [
  'Founder',
  'CEO',
  'CTO',
  'COO',
  'CFO',
  'VP of Sales',
  'VP of Engineering',
  'Head of Product',
  'Head of Marketing',
  'Sales Director',
  'Engineering Manager',
  'Product Manager',
  'Account Executive',
  'Account Manager',
  'Software Engineer',
  'Senior Software Engineer',
  'Designer',
  'Marketing Specialist',
  'Operations Manager',
  'Finance Manager',
  'HR Manager',
  'Customer Success Manager',
  'Support Lead',
  'Business Analyst',
  'Consultant',
];
const SENIORITIES = ['founder', 'c_level', 'vp', 'director', 'manager', 'senior', 'entry'];
const DEPARTMENTS = [
  'executive',
  'sales',
  'marketing',
  'product',
  'engineering',
  'operations',
  'finance',
  'hr',
  'support',
  'other',
];
const STAGES = ['lead', 'contacted', 'engaged', 'customer', 'inactive'];
const EMAIL_DOMAINS = ['example.com', 'example.org', 'mail.example.net', 'corp.example.io'];

/** Adds the people numbered `from` to `to` (inclusive) to a workspace, generated inside the database. */
export const insertPersons = async (
  db: Db,
  options: {
    workspaceId: string;
    personObjectId: string;
    /** The company object, when the workspace has one: its people get one of its first 100,000 records as their company. */
    companyObjectId?: string | undefined;
    /** `uuidv7()` where Postgres has it, else `gen_random_uuid()`. */
    idSql: ReturnType<typeof sql>;
    /** Makes emails unique across runs. */
    /** Marks the rows so `--remove` can find them again. */
    tag: string;
    run: string;
    from: number;
    to: number;
  },
) => {
  const { workspaceId, personObjectId, companyObjectId, idSql, run, from, to, tag } = options;
  const person = { id: personObjectId };
  const company = companyObjectId ? { id: companyObjectId } : undefined;
  await db.execute(sql`
        with companies as (
          select coalesce(array_agg(id::text), '{}'::text[]) as ids
          from (
            select id from record
            where workspace_id = ${workspaceId} and object_id = ${company?.id ?? person.id}
              and deleted_at is null and ${company ? sql`true` : sql`false`}
            limit 100000
          ) c
        ),
        rows as (
          select g.n, r.*
          from generate_series(${from}::bigint, ${to}::bigint) as g(n)
          cross join lateral (
            select
              ${pick(FIRST_NAMES)} as first_name,
              ${pick(LAST_NAMES)} as last_name,
              ${pick(JOB_TITLES)} as job_title,
              ${pick(EMAIL_DOMAINS)} as domain,
              (${sql.raw(`array[${PLACES.map(([c]) => `'${c.replaceAll("'", "''")}'`).join(',')}]::text[]`)})[place] as city,
              (${sql.raw(`array[${PLACES.map(([, c]) => `'${c}'`).join(',')}]::text[]`)})[place] as country,
              (${sql.raw(`array[${PLACES.map(([, , t]) => `'${t}'`).join(',')}]::text[]`)})[place] as time_zone,
              ${pick(SOURCES)} as source,
              ${pick(SENIORITIES)} as seniority,
              ${pick(DEPARTMENTS)} as department,
              ${pick(STAGES)} as stage,
              greatest(random(), g.n * 0) as r_company,
              greatest(random(), g.n * 0) as r_phone,
              now() - greatest(random(), g.n * 0) * interval '730 days' as created_at
            from (select 1 + floor(greatest(random(), g.n * 0) * ${PLACES.length})::int as place offset 0) p
            offset 0
          ) r
        )
        insert into record (id, workspace_id, object_id, data, created_at, updated_at, created_by, updated_by)
        select
          ${idSql},
          ${workspaceId},
          ${person.id},
          jsonb_strip_nulls(jsonb_build_object(
            'first_name', rows.first_name,
            'last_name', rows.last_name,
            'email', lower(regexp_replace(translate(rows.first_name || '.' || rows.last_name, 'ăâîșțĂÂÎȘȚéèêëáàäöüÖÜíóúñ', 'aaistAAISTeeeeaaaouOUioun'), '[^A-Za-z.]', '', 'g'))
              || '.' || ${run}::text || rows.n::text || '@' || rows.domain,
            'phone', case when rows.r_phone < 0.7 then '+40 7' || lpad((floor(rows.r_phone * 100000000))::bigint::text, 8, '0') end,
            'job_title', rows.job_title,
            'company', case when cardinality(companies.ids) > 0 and rows.r_company < 0.85
              then companies.ids[1 + floor(rows.r_company / 0.85 * cardinality(companies.ids))::int] end,
            'city', rows.city,
            'country', rows.country,
            'time_zone', rows.time_zone,
            'source', rows.source,
            'seniority', rows.seniority,
            'department', rows.department,
            'stage', rows.stage
          )),
          rows.created_at,
          rows.created_at,
          ${tag},
          ${tag}
        from rows cross join companies
      `);
};
