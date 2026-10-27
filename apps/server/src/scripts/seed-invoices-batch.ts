import { sql } from 'drizzle-orm';
import { type Db, list, type SqlFragment } from './seed-sql';

const LINE_DESCRIPTIONS = [
  'Consulting',
  'Software development',
  'Design work',
  'Monthly retainer',
  'Support plan',
  'Implementation',
  'Training session',
  'Hosting',
  'License',
  'Maintenance',
  'Workshop',
  'Audit',
  'Integration',
  'Analytics setup',
  'Content production',
  'Project management',
];
const PAYMENT_METHODS = ['bank_transfer', 'card', 'cash', 'other'];

/** A number written into the SQL itself, so Postgres does not have to guess the type of a parameter. */
const lit = (value: number) => sql.raw(String(value));
/** A random number in [0, 1) that depends on the row, so Postgres draws a new one for each row (see seed-sql). */
const rnd = (row: string) => sql.raw(`greatest(random(), (${row}) * 0)`);

/**
 * Adds the invoices numbered `from` to `to` (inclusive), each with one to five lines, and for paid invoices (and a
 * fifth of the sent ones, partly) a payment, all generated inside the database. Totals are worked out the way the
 * invoicing module does: the discount comes off the subtotal, tax is charged on what is left, amounts are in cents.
 * Statuses: 10% draft, 30% sent, 50% paid, 10% void; issue dates over the last two years.
 */
export const insertInvoices = async (
  db: Db,
  options: {
    workspaceId: string;
    invoiceObjectId: string;
    lineObjectId: string | undefined;
    paymentObjectId: string | undefined;
    /** The company object, when the workspace has one: an invoice goes to one of its first 100,000 records. */
    companyObjectId: string | undefined;
    idSql: SqlFragment;
    /** Marks the rows so `--remove` can find them again. */
    tag: string;
    from: number;
    to: number;
  },
) => {
  const { workspaceId, invoiceObjectId, lineObjectId, paymentObjectId, companyObjectId, idSql, tag, from, to } =
    options;
  // Without an object for lines or payments (the module not installed in full), those rows are left out.
  const lineTarget = lineObjectId ?? invoiceObjectId;
  const paymentTarget = paymentObjectId ?? invoiceObjectId;
  await db.execute(sql`
    with companies as (
      select coalesce(array_agg(id::text), '{}'::text[]) as ids
      from (
        select id from record
        where workspace_id = ${workspaceId} and object_id = ${companyObjectId ?? invoiceObjectId}
          and deleted_at is null and ${companyObjectId ? sql`true` : sql`false`}
        limit 100000
      ) c
    ),
    inv as materialized (
      select
        g.n,
        ${idSql} as id,
        r.*,
        case when r.r_status < 0.10 then 'draft' when r.r_status < 0.40 then 'sent' when r.r_status < 0.90 then 'paid' else 'void' end as status,
        (current_date - floor(r.r_issue * 730)::int) as issue_date,
        (array[14, 30, 30, 45, 60])[1 + floor(r.r_due * 5)::int] as due_days,
        (array[0, 9, 19, 21])[1 + floor(r.r_tax * 4)::int] as tax_rate,
        case when r.r_discount < 0.2 then (array[5, 10, 15])[1 + floor(r.r_discount / 0.2 * 3)::int] else 0 end as discount_pct,
        1 + floor(r.r_lines * 5)::int as n_lines
      from generate_series(${from}::bigint, ${to}::bigint) as g(n)
      cross join lateral (
        select
          ${rnd('g.n')} as r_status,
          ${rnd('g.n')} as r_issue,
          ${rnd('g.n')} as r_due,
          ${rnd('g.n')} as r_tax,
          ${rnd('g.n')} as r_discount,
          ${rnd('g.n')} as r_lines,
          ${rnd('g.n')} as r_company,
          ${rnd('g.n')} as r_partial,
          ${rnd('g.n')} as r_paid_on,
          ${rnd('g.n')} as r_share,
          ${rnd('g.n')} as r_method
        offset 0
      ) r
    ),
    lines as materialized (
      select
        inv.id as invoice_id,
        inv.issue_date,
        l.i as position,
        ${idSql} as id,
        (${list(LINE_DESCRIPTIONS)})[1 + floor(${rnd('inv.n + l.i')} * ${lit(LINE_DESCRIPTIONS.length)})::int] as description,
        1 + floor(${rnd('inv.n + l.i')} * 10)::int as quantity,
        round((20 + ${rnd('inv.n + l.i')} * 1980)::numeric, 2) as unit_price
      from inv cross join lateral generate_series(1, inv.n_lines) as l(i)
    ),
    sums as materialized (
      select invoice_id, round(sum(quantity * unit_price), 2) as subtotal from lines group by invoice_id
    ),
    fin as materialized (
      select
        inv.*,
        sums.subtotal,
        round(sums.subtotal * inv.discount_pct / 100, 2) as discount,
        round((sums.subtotal - round(sums.subtotal * inv.discount_pct / 100, 2)) * inv.tax_rate / 100, 2) as tax
      from inv join sums on sums.invoice_id = inv.id
    ),
    totals as materialized (
      select fin.*, fin.subtotal - fin.discount + fin.tax as total from fin
    ),
    pay as materialized (
      select
        totals.*,
        case when totals.status = 'paid' then totals.total else round((totals.total * (0.3 + totals.r_share * 0.4))::numeric, 2) end as amount,
        least(totals.issue_date + floor(totals.r_paid_on * totals.due_days)::int, current_date) as paid_on
      from totals
      where totals.status = 'paid' or (totals.status = 'sent' and totals.r_partial < 0.2)
    ),
    ins_lines as (
      insert into record (id, workspace_id, object_id, data, created_at, updated_at, created_by, updated_by)
      select
        lines.id,
        ${workspaceId},
        ${lineTarget},
        jsonb_build_object(
          'description', lines.description,
          'invoice', lines.invoice_id::text,
          'quantity', lines.quantity,
          'unit_price', lines.unit_price
        ),
        lines.issue_date::timestamptz,
        lines.issue_date::timestamptz,
        ${tag},
        ${tag}
      from lines
      where ${lineObjectId ? sql`true` : sql`false`}
    ),
    ins_payments as (
      insert into record (id, workspace_id, object_id, data, created_at, updated_at, created_by, updated_by)
      select
        ${idSql},
        ${workspaceId},
        ${paymentTarget},
        jsonb_build_object(
          'invoice', pay.id::text,
          'amount', pay.amount,
          'paid_on', pay.paid_on::text,
          'method', (${list(PAYMENT_METHODS)})[1 + floor(pay.r_method * ${lit(PAYMENT_METHODS.length)})::int],
          'reference', 'PAY-' || pay.n
        ),
        pay.paid_on::timestamptz,
        pay.paid_on::timestamptz,
        ${tag},
        ${tag}
      from pay
      where ${paymentObjectId ? sql`true` : sql`false`}
    )
    insert into record (id, workspace_id, object_id, data, created_at, updated_at, created_by, updated_by)
    select
      totals.id,
      ${workspaceId},
      ${invoiceObjectId},
      jsonb_strip_nulls(jsonb_build_object(
        'number', 'INV-' || lpad(totals.n::text, 6, '0'),
        'status', totals.status,
        'company', case when cardinality(companies.ids) > 0
          then companies.ids[1 + floor(totals.r_company * cardinality(companies.ids))::int] end,
        'issue_date', totals.issue_date::text,
        'due_date', (totals.issue_date + totals.due_days)::text,
        'tax_rate', totals.tax_rate,
        'subtotal', totals.subtotal,
        'discount_type', 'percent',
        'discount_value', totals.discount_pct,
        'discount_amount', totals.discount,
        'tax', totals.tax,
        'total', totals.total,
        'currency', 'EUR',
        'payment_methods', jsonb_build_array('bank_transfer'),
        'issuer_name', 'Devias SRL'
      )),
      totals.issue_date::timestamptz,
      totals.issue_date::timestamptz,
      ${tag},
      ${tag}
    from totals cross join companies
  `);
};
