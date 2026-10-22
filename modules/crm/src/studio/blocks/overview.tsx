import { defineBlockComponent, localDate, num, type ObjectMetadata, plural, type RecordData, str } from '@devias/core';
import {
  ActivityEntries,
  externalHref,
  links,
  shortAddress,
  useActivity,
  useAggregate,
  useNavigation,
  useRecord,
  useRecords,
  useSchema,
  useWorkspace,
} from '@devias/studio';
import { Avatar, AvatarFallback, cn, Figure, Figures, Icon, Section, Skeleton } from '@devias/ui';
import { type ReactNode, useMemo } from 'react';
import { z } from 'zod';
import { DEAL_STAGES, INDUSTRIES, ids } from '../../manifest';
import { CompanyLogo, closeWords, dayOf, OPEN_STAGES, useMoney } from '../shared';

// ---------------------------------------------------------------------------------------------
// Words and numbers
// ---------------------------------------------------------------------------------------------

const fullName = (person: RecordData) =>
  [str(person.first_name), str(person.last_name)].filter(Boolean).join(' ') || 'Unnamed person';
const initials = (person: RecordData) =>
  [str(person.first_name), str(person.last_name)]
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

const stageLabel = (value: unknown) => DEAL_STAGES.find((stage) => stage.value === value)?.label ?? str(value);
const OPEN = OPEN_STAGES.map((stage) => stage.value);

// ---------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------

/** A link to another page in the text: ink, underlined in a quiet line that darkens on hover. */
const LINK =
  'text-xs font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

/** The link in a section's heading row, where the whole list is: quiet grey text with an arrow. */
function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  const { Link } = useNavigation();

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline hover:underline-offset-4"
    >
      {children}
      <Icon name="arrow-right" className="size-3.5" />
    </Link>
  );
}

/** A titled list with a link to the tab that lists them all. */
function ListCard({
  title,
  total,
  tab,
  record,
  object,
  empty,
  loading,
  children,
}: {
  title: string;
  total: number | undefined;
  tab: string;
  record: RecordData;
  object: ObjectMetadata;
  empty: string;
  loading: boolean;
  children: ReactNode;
}) {
  const { slug } = useWorkspace();

  return (
    <Section
      variant="plain"
      title={title}
      actions={
        total ? (
          <SectionLink href={links.record(slug, object.nameSingular, record.id, tab)}>View all</SectionLink>
        ) : null
      }
    >
      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full rounded-sm" />
          <Skeleton className="h-10 w-full rounded-sm" />
        </div>
      ) : total ? (
        <ul>{children}</ul>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </Section>
  );
}

/** A row of a list: a link to the record, what it is, and a figure on the right. */
function Row({
  object,
  id,
  title,
  meta,
  aside,
  lead,
}: {
  object: string;
  id: string;
  title: string;
  meta?: ReactNode;
  aside?: ReactNode;
  /** Before the text: an avatar for a person. */
  lead?: ReactNode;
}) {
  const { slug } = useWorkspace();
  const { Link } = useNavigation();

  return (
    <li className="not-last:border-b not-last:border-subtle-border">
      <Link
        href={links.record(slug, object, id)}
        className="group/row -mx-3 flex items-center gap-3 rounded-sm px-3 py-2 transition-colors hover:bg-muted/70"
      >
        {lead}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{title}</span>
          {meta ? <span className="block truncate text-xs text-muted-foreground">{meta}</span> : null}
        </span>
        {aside ? <span className="shrink-0 text-xs tabular-nums">{aside}</span> : null}
        <Icon
          name="chevron-right"
          className="size-4 shrink-0 text-subtle-foreground transition-transform group-hover/row:translate-x-0.5"
        />
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Deals and people of a record
// ---------------------------------------------------------------------------------------------

const useOpenDeals = (field: string, id: string) =>
  useRecords({
    object: 'deal',
    filter: {
      and: [
        { field, op: 'eq', value: id },
        { field: 'stage', op: 'in', value: OPEN },
      ],
    },
    sort: [{ field: 'close_date', direction: 'asc' }],
    limit: 5,
    count: true,
  });

/** A table of deals: the deal, where it is, when it closes and what it is worth. */
function DealRows({ items, money, today }: { items: RecordData[]; money: (value: number) => string; today: string }) {
  const { slug } = useWorkspace();
  const { Link } = useNavigation();

  return (
    <li className="list-none" data-slot="deal-rows">
      <div className="grid h-8 grid-cols-[minmax(0,1fr)_7rem_10rem_5.5rem] items-center gap-x-4 text-xs font-medium text-muted-foreground max-md:hidden">
        <span>Deal</span>
        <span className="pl-2.5">Stage</span>
        <span>Closes</span>
        <span className="text-right">Amount</span>
      </div>
      <ul>
        {items.map((deal) => (
          <li key={deal.id} className="not-last:border-b not-last:border-subtle-border">
            <Link
              href={links.record(slug, 'deal', deal.id)}
              className="-mx-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-sm px-3 py-2.5 text-xs transition-colors hover:bg-muted/70 md:grid-cols-[minmax(0,1fr)_7rem_10rem_5.5rem]"
            >
              <span className="truncate font-medium">{str(deal.name) || 'Untitled deal'}</span>
              <span className="hidden md:block">
                <span className="inline-flex h-6 items-center rounded-full border border-border px-2.5 text-xs font-medium">
                  {stageLabel(deal.stage)}
                </span>
              </span>
              <span className="hidden truncate text-muted-foreground md:block">
                {str(deal.close_date) ? closeWords(str(deal.close_date), today) : '—'}
              </span>
              <span className="text-right tabular-nums">{money(num(deal.amount))}</span>
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Per object
// ---------------------------------------------------------------------------------------------

/** "3 days ago", "in 2 hours", "just now". */
const ago = (iso: string): string => {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return format.format(Math.round(seconds / size), unit);
    }
  }

  return 'just now';
};

/** The latest of a record's history, with a way to the whole of it. */
function RecentActivity({ record, object }: { record: RecordData; object: ObjectMetadata }) {
  const { slug } = useWorkspace();
  const activity = useActivity(object.nameSingular, record.id);
  const items = activity.data?.pages[0]?.items.slice(0, 5) ?? [];

  return (
    <Section
      variant="plain"
      title="Recent activity"
      actions={
        items.length > 0 ? (
          <SectionLink href={links.record(slug, object.nameSingular, record.id, 'activity')}>View all</SectionLink>
        ) : null
      }
    >
      {activity.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : items.length > 0 ? (
        <ActivityEntries object={object} record={record} entries={items} />
      ) : (
        <p className="text-xs text-muted-foreground">Nothing yet.</p>
      )}
    </Section>
  );
}

/** A person's company at a glance: what it is and how big it is, with a way to its page. */
function CompanyCard({ company }: { company: RecordData }) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const money = useMoney();
  const industry = INDUSTRIES.find((option) => option.value === company.industry)?.label;
  const website = str(company.domain);
  const about = str(company.description);
  const facts: { label: string; value: ReactNode }[] = [
    { label: 'Employees', value: typeof company.employees === 'number' ? company.employees.toLocaleString() : null },
    {
      label: 'Annual revenue',
      value: typeof company.annual_revenue === 'number' ? money(company.annual_revenue) : null,
    },
    { label: 'Location', value: str(company.city) || null },
    {
      label: 'Website',
      value: website ? (
        <a
          href={externalHref(website)}
          target="_blank"
          rel="noreferrer noopener"
          className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          {shortAddress(website)}
        </a>
      ) : null,
    },
  ].filter((fact) => fact.value);

  return (
    <Section variant="plain" title="Company">
      <div data-slot="company-card">
        <div className="flex items-center gap-3">
          <CompanyLogo logo={str(company.logo)} className="size-8" />
          <div className="min-w-0">
            <navigation.Link
              href={links.record(slug, 'company', company.id)}
              className="block truncate text-xs font-medium hover:underline"
            >
              {str(company.name) || 'Unnamed company'}
            </navigation.Link>
            {industry ? <span className="block text-xs text-muted-foreground">{industry}</span> : null}
          </div>
        </div>
        {about ? <p className="mt-3 line-clamp-3 text-xs text-muted-foreground">{about}</p> : null}
        {facts.length > 0 ? (
          <dl className="mt-3 flex flex-col gap-y-1.5">
            {facts.map((fact) => (
              <div key={fact.label} className="grid grid-cols-[minmax(6.5rem,40%)_minmax(0,1fr)] gap-x-3 text-xs">
                <dt className="truncate text-muted-foreground">{fact.label}</dt>
                <dd className="truncate">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </Section>
  );
}

/** The other people at the person's company. */
function Colleagues({
  person,
  company,
  companyObject,
}: {
  person: RecordData;
  company: RecordData;
  companyObject: ObjectMetadata;
}) {
  const colleagues = useRecords({
    object: 'person',
    filter: {
      and: [
        { field: 'company', op: 'eq', value: company.id },
        { field: 'id', op: 'neq', value: person.id },
      ],
    },
    sort: [{ field: 'first_name', direction: 'asc' }],
    limit: 5,
    count: true,
  });

  return (
    <ListCard
      title="Colleagues"
      total={colleagues.data?.totalCount}
      tab="people"
      record={company}
      object={companyObject}
      empty={`No one else at ${str(company.name) || 'this company'} yet.`}
      loading={colleagues.isPending}
    >
      {(colleagues.data?.items ?? []).map((colleague) => (
        <Row
          key={colleague.id}
          object="person"
          id={colleague.id}
          title={fullName(colleague)}
          meta={str(colleague.job_title) || str(colleague.email) || undefined}
          lead={
            <Avatar className="size-8">
              <AvatarFallback className="bg-secondary font-medium text-foreground">
                {initials(colleague)}
              </AvatarFallback>
            </Avatar>
          }
        />
      ))}
    </ListCard>
  );
}

/**
 * The first figures of a person: their open deals with a thin bar of where they stand, what they have already won,
 * and how lately anything happened. The sums come from the database (`records.aggregate`), so they are exact.
 */
function PersonFigures({ record, object }: { record: RecordData; object: ObjectMetadata }) {
  const money = useMoney();
  const byStage = useAggregate(
    useMemo(
      () => ({
        object: 'deal',
        filter: { field: 'point_of_contact', op: 'eq' as const, value: record.id },
        groupBy: 'stage',
        measures: [{ fn: 'count' as const }, { fn: 'sum' as const, field: 'amount' }],
      }),
      [record.id],
    ),
  );
  const activity = useActivity(object.nameSingular, record.id);
  const group = (stage: string) => byStage.data?.groups.find((entry) => entry.key === stage);
  const open = OPEN_STAGES.map((stage) => ({
    ...stage,
    count: group(stage.value)?.count ?? 0,
    amount: measure(group(stage.value)?.values['sum.amount']),
  })).filter((stage) => stage.count > 0);
  const openCount = open.reduce((sum, stage) => sum + stage.count, 0);
  const openTotal = open.reduce((sum, stage) => sum + stage.amount, 0);
  const won = group('customer');
  const wonCount = won?.count ?? 0;
  const latest = activity.data?.pages[0]?.items[0];
  const loading = !byStage.data;

  return (
    <Figures>
      <Figure
        label="Open deals"
        value={loading ? '—' : openCount}
        hint={loading ? undefined : openCount > 0 ? `${money(openTotal)} in total` : 'none open'}
        extra={
          openCount > 0 ? (
            <div
              role="img"
              aria-label={`Open deals by stage: ${open.map((stage) => `${stage.label} ${money(stage.amount)}`).join(', ')}`}
              className="flex h-1.5 gap-0.5"
            >
              {open.map((stage) => (
                <span
                  key={stage.value}
                  title={`${stage.label} · ${money(stage.amount)}`}
                  className={cn('min-w-1.5 rounded-full', STAGE_BAR[stage.value])}
                  style={{ flexGrow: stage.amount > 0 ? stage.amount : 1 }}
                />
              ))}
            </div>
          ) : null
        }
      />
      <Figure
        label="Won to date"
        value={loading ? '—' : money(measure(won?.values['sum.amount']))}
        hint={loading ? undefined : wonCount > 0 ? plural(wonCount, 'deal', 'deals') : 'none yet'}
      />
      <Figure label="Last activity" value={latest ? ago(latest.occurredAt) : '—'} />
      <Figure label="Added" value={dayOf(str(record.created_at).slice(0, 10))} hint={ago(str(record.created_at))} />
    </Figures>
  );
}

/**
 * A person's page, as two columns: the main one holds the figures, the open deals, what happened lately and their
 * colleagues; the side one, their company.
 */
function PersonOverview({
  record,
  object,
  part,
}: {
  record: RecordData;
  object: ObjectMetadata;
  part: 'main' | 'side' | undefined;
}) {
  const { index } = useSchema();
  const money = useMoney();
  const today = localDate(new Date());
  const deals = useOpenDeals('point_of_contact', record.id);
  const company = useRecord('company', str(record.company) || undefined);
  const companyObject = index.objectsById.get(ids.objects.company);
  const side = company.data ? <CompanyCard company={company.data} /> : null;

  if (part === 'side') {
    return side;
  }

  return (
    <div className="flex flex-col gap-8">
      <PersonFigures record={record} object={object} />
      <ListCard
        title="Open deals"
        total={deals.data?.totalCount}
        tab="deals"
        record={record}
        object={object}
        empty="No open deals."
        loading={deals.isPending}
      >
        <DealRows items={deals.data?.items ?? []} money={money} today={today} />
      </ListCard>
      <RecentActivity record={record} object={object} />
      {company.data && companyObject ? (
        <Colleagues person={record} company={company.data} companyObject={companyObject} />
      ) : null}
      {part === undefined ? side : null}
    </div>
  );
}

/** The open stages in the pipeline bar, in the ink of the page: the nearer to won, the stronger. */
const STAGE_BAR: Record<string, string> = {
  new: 'bg-foreground/15',
  screening: 'bg-foreground/30',
  meeting: 'bg-foreground/55',
  proposal: 'bg-foreground',
};

/** The number a measure came back as; sums arrive as numbers or numeric strings, and as null for none. */
const measure = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * A company's deals at a glance: the open pipeline as one bar split by stage with what each stage holds and what was
 * won, then the deal that closes first. Sums come from the database (`records.aggregate`).
 */
function PipelineSummary({ company, open, today }: { company: RecordData; open: RecordData[]; today: string }) {
  const { slug } = useWorkspace();
  const { Link } = useNavigation();
  const money = useMoney();
  const byStage = useAggregate(
    useMemo(
      () => ({
        object: 'deal',
        filter: { field: 'company', op: 'eq' as const, value: company.id },
        groupBy: 'stage',
        measures: [{ fn: 'count' as const }, { fn: 'sum' as const, field: 'amount' }],
      }),
      [company.id],
    ),
  );

  if (!byStage.data) {
    return null;
  }

  const group = (stage: string) => byStage.data?.groups.find((entry) => entry.key === stage);
  const stages = OPEN_STAGES.map((stage) => {
    const found = group(stage.value);

    return { ...stage, count: found?.count ?? 0, amount: measure(found?.values['sum.amount']) };
  }).filter((stage) => stage.count > 0);
  // Select groups come back for every option, empty ones too.
  const won = (group('customer')?.count ?? 0) > 0 ? group('customer') : undefined;
  const wonAmount = measure(won?.values['sum.amount']);

  if (stages.length === 0 && !won) {
    return null;
  }

  const next = open.find((deal) => str(deal.close_date));
  const nextCloses = next ? closeWords(str(next.close_date), today) : '';
  const count = (value: number) => `${value} ${value === 1 ? 'deal' : 'deals'}`;
  const total = stages.reduce((sum, stage) => sum + stage.amount, 0);

  return (
    <Section
      variant="plain"
      title="Pipeline"
      actions={<SectionLink href={links.record(slug, 'company', company.id, 'deals')}>View deals</SectionLink>}
    >
      <div className="flex flex-col gap-5" data-slot="pipeline">
        {stages.length > 0 ? (
          <div
            role="img"
            aria-label={`Open pipeline ${money(total)}: ${stages.map((stage) => `${stage.label} ${money(stage.amount)}`).join(', ')}`}
            className="flex h-2 gap-0.5"
          >
            {stages.map((stage) => (
              <span
                key={stage.value}
                className={cn('min-w-1.5 rounded-full', STAGE_BAR[stage.value])}
                style={{ flexGrow: stage.amount > 0 ? stage.amount : 1 }}
              />
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 @xl:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]">
          {stages.map((stage) => (
            <div key={stage.value} className="contents" data-stage={stage.value}>
              <Figure
                label={
                  <>
                    <span className={cn('size-2 shrink-0 rounded-full', STAGE_BAR[stage.value])} />
                    {stage.label}
                  </>
                }
                value={money(stage.amount)}
                hint={count(stage.count)}
                className="@2xl:px-0"
              />
            </div>
          ))}
          <div className="contents" data-stage="won">
            <Figure
              label="Won to date"
              value={money(wonAmount)}
              hint={won ? count(won.count) : 'none yet'}
              className="@2xl:px-0"
            />
          </div>
        </div>
        {next ? (
          <p
            className="flex flex-wrap items-center gap-x-2 border-t border-border pt-4 text-xs text-muted-foreground"
            data-slot="next-deal"
          >
            <span>
              <span className="text-foreground">Next:</span> {str(next.name) || 'Untitled deal'}{' '}
              {nextCloses.charAt(0).toLowerCase() + nextCloses.slice(1)}, still at {stageLabel(next.stage)}.
            </span>
            <Link href={links.record(slug, 'deal', next.id)} className={cn('ms-auto', LINK)}>
              Open deal
            </Link>
          </p>
        ) : null}
      </div>
    </Section>
  );
}

/** A company's page, a row for each: its pipeline, its open deals, its people, then what happened lately. */
function CompanyOverview({ record, object }: { record: RecordData; object: ObjectMetadata }) {
  const money = useMoney();
  const today = localDate(new Date());
  const deals = useOpenDeals('company', record.id);
  const people = useRecords({
    object: 'person',
    filter: { field: 'company', op: 'eq', value: record.id },
    sort: [{ field: 'first_name', direction: 'asc' }],
    limit: 5,
    count: true,
  });

  return (
    <div className="flex flex-col gap-8">
      <PipelineSummary company={record} open={deals.data?.items ?? []} today={today} />
      <ListCard
        title="Open deals"
        total={deals.data?.totalCount}
        tab="deals"
        record={record}
        object={object}
        empty="No open deals."
        loading={deals.isPending}
      >
        <DealRows items={deals.data?.items ?? []} money={money} today={today} />
      </ListCard>
      <ListCard
        title="People"
        total={people.data?.totalCount}
        tab="people"
        record={record}
        object={object}
        empty="No people yet."
        loading={people.isPending}
      >
        {(people.data?.items ?? []).map((person) => (
          <Row
            key={person.id}
            object="person"
            id={person.id}
            title={fullName(person)}
            meta={str(person.job_title) || undefined}
            aside={str(person.email) ? <span className="text-muted-foreground">{str(person.email)}</span> : undefined}
            lead={
              <Avatar className="size-8">
                <AvatarFallback className="bg-secondary font-medium text-foreground">{initials(person)}</AvatarFallback>
              </Avatar>
            }
          />
        ))}
      </ListCard>
      <RecentActivity record={record} object={object} />
    </div>
  );
}

function Overview({
  record,
  object,
  config,
}: {
  record?: RecordData;
  object?: ObjectMetadata;
  config?: { part?: 'main' | 'side' };
}) {
  if (!record || !object) {
    return null;
  }

  const body =
    object.id === ids.objects.company ? (
      config?.part === 'side' ? null : (
        <CompanyOverview record={record} object={object} />
      )
    ) : object.id === ids.objects.person ? (
      <PersonOverview record={record} object={object} part={config?.part} />
    ) : null;

  return (
    <div className="@container flex flex-col gap-6" data-slot="crm-overview">
      {body}
    </div>
  );
}

/**
 * The first tab of people and companies: the figures that matter (the open pipeline, what was won) over the lists to act on. Other modules add their own cards after it, such as
 * the open tasks.
 */
export const overviewBlock = defineBlockComponent({
  id: ids.blocks.overview,
  label: 'Overview',
  icon: 'layout-grid',
  // A person's overview can be split in two: `part: 'main'` or `'side'` draws one column of it. A company's has no
  // side of its own (its details are fields blocks in the layout's narrow column), so `'side'` draws nothing.
  config: z.object({ part: z.enum(['main', 'side']).optional() }),
  surfaces: { record: { objectIds: [ids.objects.person, ids.objects.company], frame: false } },
  component: Overview,
});
