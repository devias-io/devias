import type { ActivityChange, ActivityEntry, Actor, RecordData } from '@devias/core';
import type { Chore, Company, Note, Opportunity, Person } from '@devias/fixtures';
import {
  applyManifest,
  createConnection,
  createMockClient,
  createRecord,
  createWorkflow,
  DEFAULT_MOCK_ACTOR,
  MOCK_TEAMMATES,
  type MockActivityInput,
  type MockClient,
  type MockClientOptions,
  type MockStore,
} from '../src/mock';

/**
 * Test fixture: a deterministic Fixture dataset for the mock backend. Given the same PRNG seed and anchor date, the
 * generated companies, people, opportunities, chores and notes (ids included) are identical every run. The product
 * ships no demo data; tests build what they need with `demoClient` or `seedDemo`.
 */

export interface SeedContext {
  store: MockStore;
  /** Uniform random number in `[0, 1)` from the seeded PRNG. */
  random(): number;
  /** Integer in `[min, max]`. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
  shuffle<T>(items: readonly T[]): T[];
  /** Deterministic UUID-shaped id. */
  id(): string;
  /** Anchor date, `YYYY-MM-DD`. */
  today: string;
  /** `YYYY-MM-DD` of `today + days`. */
  date(daysFromToday: number): string;
  /** ISO timestamp `daysAgo` days before today at a random time of day. */
  timestamp(daysAgo: number): string;
  /** Validate and insert a record (deterministic id and timestamps, no events). */
  insert<T extends RecordData = RecordData>(object: string, data: Record<string, unknown>): T;
}

export interface SeedOptions {
  /** PRNG seed (default 42). */
  seed?: number;
  /** Anchor date `YYYY-MM-DD` (defaults to today). */
  today?: string;
}

/** mulberry32: small, fast and identical in Node and browsers. */
export const createRng = (seed: number): (() => number) => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const DAY_MS = 86_400_000;

export const createSeedContext = (store: MockStore, options: SeedOptions = {}): SeedContext => {
  const random = createRng(options.seed ?? 42);
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const hex = '0123456789abcdef';
  const ctx: SeedContext = {
    store,
    random,
    int,
    pick: (items) => {
      const item = items[Math.floor(random() * items.length)];

      if (item === undefined) {
        throw new Error('pick() needs a non-empty list');
      }

      return item;
    },
    chance: (probability) => random() < probability,
    shuffle: (items) => {
      const out = [...items];

      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        const a = out[i] as (typeof out)[number];
        out[i] = out[j] as (typeof out)[number];
        out[j] = a;
      }

      return out;
    },
    id: () => {
      let raw = '';

      for (let i = 0; i < 32; i += 1) {
        if (i === 12) {
          raw += '4';
        } else if (i === 16) {
          raw += hex[8 + int(0, 3)];
        } else {
          raw += hex[int(0, 15)];
        }
      }

      return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
    },
    today,
    date: (days) => new Date(todayMs + days * DAY_MS).toISOString().slice(0, 10),
    timestamp: (daysAgo) =>
      new Date(todayMs - daysAgo * DAY_MS + int(8 * 3600, 18 * 3600) * 1000 + int(0, 59_999)).toISOString(),
    insert: <T extends RecordData = RecordData>(object: string, data: Record<string, unknown>): T => {
      const createdDaysAgo = int(1, 120);
      const createdAt = ctx.timestamp(createdDaysAgo);
      const updated = ctx.timestamp(int(0, createdDaysAgo));
      const updatedAt = updated < createdAt ? createdAt : updated;

      return createRecord(store, object, data, { id: ctx.id(), createdAt, updatedAt }) as T;
    },
  };

  return ctx;
};

const COMPANIES: readonly (readonly [name: string, domain: string, industry: string, city: string])[] = [
  ['Acme Corp', 'acme.example.com', 'manufacturing', 'Chicago'],
  ['Globex Industries', 'globex.example.com', 'manufacturing', 'Springfield'],
  ['Initech', 'initech.example.com', 'software', 'Austin'],
  ['Vandelay Imports', 'vandelay.example.com', 'retail', 'New York'],
  ['Hooli', 'hooli.example.com', 'software', 'Palo Alto'],
  ['Pied Piper', 'piedpiper.example.com', 'software', 'Palo Alto'],
  ['Wonka Foods', 'wonka.example.com', 'retail', 'Denver'],
  ['Stark Analytics', 'stark.example.com', 'finance', 'Boston'],
  ['Wayne Logistics', 'wayne.example.com', 'services', 'Gotham'],
  ['Cyberdyne Systems', 'cyberdyne.example.com', 'software', 'Los Angeles'],
  ['Tyrell Biotech', 'tyrell.example.com', 'healthcare', 'San Diego'],
  ['Aperture Labs', 'aperture.example.com', 'other', 'Cleveland'],
  ['Soylent Retail', 'soylent.example.com', 'retail', 'Seattle'],
  ['Massive Dynamic', 'massivedynamic.example.com', 'services', 'Berlin'],
  ['Oscorp Health', 'oscorp.example.com', 'healthcare', 'London'],
];

const FIRST_NAMES = [
  'Ada',
  'Alan',
  'Amara',
  'Ben',
  'Carla',
  'Chen',
  'Dana',
  'Diego',
  'Elena',
  'Emeka',
  'Fatima',
  'Felix',
  'Grace',
  'Hugo',
  'Ines',
  'Ivan',
  'Jade',
  'Jonas',
  'Kai',
  'Lena',
  'Liam',
  'Maya',
  'Mateo',
  'Nadia',
  'Noah',
  'Olivia',
  'Omar',
  'Priya',
  'Quinn',
  'Rosa',
  'Sam',
  'Sofia',
  'Tariq',
  'Tessa',
  'Uma',
  'Victor',
  'Wren',
  'Xavier',
  'Yara',
  'Zoe',
];

const LAST_NAMES = [
  'Lovelace',
  'Turing',
  'Okafor',
  'Novak',
  'Rossi',
  'Wei',
  'Schmidt',
  'Silva',
  'Petrova',
  'Adeyemi',
  'Haddad',
  'Berg',
  'Hopper',
  'Moreau',
  'Costa',
  'Ivanov',
  'Nguyen',
  'Larsen',
  'Tanaka',
  'Fischer',
  'Murphy',
  'Ortega',
  'Kim',
  'Ali',
  'Dubois',
  'Jensen',
  'Farah',
  'Sharma',
  'Byrne',
  'Lopez',
  'Walker',
  'Mendes',
  'Rahman',
  'Weber',
  'Iyer',
  'Popov',
  'Blake',
  'Reyes',
  'Hassan',
  'Andersen',
];

const JOB_TITLES = [
  'CEO',
  'CTO',
  'VP Sales',
  'Head of Marketing',
  'Product Manager',
  'Account Executive',
  'Engineering Manager',
  'Customer Success Lead',
  'Founder',
  'Operations Director',
  'Sales Engineer',
  'Data Analyst',
];

const PRODUCTS = [
  'Platform license',
  'Enterprise rollout',
  'Pilot program',
  'Support renewal',
  'Data migration',
  'Training package',
  'Analytics add-on',
  'Multi-year contract',
  'Expansion seats',
  'Integration project',
];

const STAGES = ['new', 'screening', 'meeting', 'proposal', 'customer', 'lost'] as const;
const PROBABILITY: Record<(typeof STAGES)[number], number> = {
  new: 10,
  screening: 25,
  meeting: 40,
  proposal: 65,
  customer: 100,
  lost: 0,
};

const ASSIGNEES = ['Dev User', 'Ada Lovelace', 'Grace Hopper', 'Linus Torvalds'];

const NOTE_TITLES = [
  'Kickoff call notes',
  'Discovery summary',
  'Pricing discussion',
  'Objections raised',
  'Renewal timeline',
  'Champion identified',
  'Competitor mention',
  'Next steps',
];

const NOTE_BODIES = [
  'Walked through the current process and the main pain points. Follow-up scheduled for next week.',
  'They want a phased rollout starting with one team. Budget is approved for this quarter.',
  'Asked for a comparison with their incumbent vendor; sending the one-pager tomorrow.',
  'Security review is the main blocker. Legal needs the DPA before signature.',
  'Positive call. The champion will present internally and loop in procurement.',
];

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Populate the store with the demo dataset. Requires the fixture manifest to be applied. */
const seedCrmDemo = (ctx: SeedContext): void => {
  const required = ['company', 'person', 'opportunity', 'chore', 'note'];
  const missing = required.filter((name) => !ctx.store.objectByName(name));

  if (missing.length > 0) {
    throw new Error(`the demo fixture needs the fixture manifest; missing objects: ${missing.join(', ')}`);
  }

  const companies = COMPANIES.map(([name, domain, industry, city]) =>
    ctx.insert<Company>('company', {
      name,
      domain,
      industry,
      employees: ctx.int(8, 2_400),
      annual_revenue: ctx.int(2, 900) * 100_000,
      ideal_customer_profile: ctx.chance(0.4),
      city,
    }),
  );

  const usedEmails = new Set<string>();
  const people: Person[] = [];
  const lastNames = ctx.shuffle(LAST_NAMES);
  FIRST_NAMES.forEach((firstName, index) => {
    const lastName = lastNames[index] ?? 'Doe';
    const company = ctx.pick(companies);
    let email = `${firstName}.${lastName}@${company.domain}`.toLowerCase();

    if (usedEmails.has(email)) {
      email = `${firstName}.${lastName}${index}@${company.domain}`.toLowerCase();
    }

    usedEmails.add(email);
    people.push(
      ctx.insert<Person>('person', {
        first_name: firstName,
        last_name: lastName,
        email,
        phone: `+1 555 01${String(ctx.int(0, 99)).padStart(2, '0')} ${String(ctx.int(0, 9999)).padStart(4, '0')}`,
        job_title: ctx.pick(JOB_TITLES),
        company: company.id,
        city: ctx.chance(0.7) ? company.city : ctx.pick(COMPANIES)[3],
        linkedin: ctx.chance(0.6) ? `https://linkedin.com/in/${slug(`${firstName} ${lastName}`)}` : null,
      }),
    );
  });
  const peopleByCompany = new Map<string, Person[]>();

  for (const person of people) {
    if (!person.company) {
      continue;
    }

    const list = peopleByCompany.get(person.company) ?? [];
    list.push(person);
    peopleByCompany.set(person.company, list);
  }

  const opportunities: Opportunity[] = [];

  for (let i = 0; i < 20; i += 1) {
    const company = companies[i % companies.length] as Company;
    const stage = STAGES[i % STAGES.length] as (typeof STAGES)[number];
    const closed = stage === 'customer' || stage === 'lost';
    const contacts = peopleByCompany.get(company.id) ?? [];
    opportunities.push(
      ctx.insert<Opportunity>('opportunity', {
        name: `${company.name} – ${PRODUCTS[i % PRODUCTS.length]}`,
        stage,
        amount: ctx.int(5, 250) * 1_000,
        close_date: closed ? ctx.date(-ctx.int(1, 60)) : ctx.date(ctx.int(3, 90)),
        probability: PROBABILITY[stage],
        rating: ctx.int(1, 5),
        company: company.id,
        point_of_contact: contacts.length > 0 ? ctx.pick(contacts).id : null,
      }),
    );
  }

  const TASK_TITLES = [
    (_o: Opportunity, p: Person) => `Send proposal to ${p.first_name} ${p.last_name ?? ''}`.trim(),
    (o: Opportunity) => `Schedule demo for ${o.name.split(' – ')[0]}`,
    (o: Opportunity) => `Prepare contract for ${o.name}`,
    (_o: Opportunity, p: Person) => `Call ${p.first_name} about the renewal`,
    (o: Opportunity) => `Review requirements from ${o.name.split(' – ')[0]}`,
    () => 'Update the pipeline forecast',
    (_o: Opportunity, p: Person) => `Book onboarding session with ${p.first_name}`,
  ];

  for (let i = 0; i < 25; i += 1) {
    const opportunity = ctx.pick(opportunities);
    const person = people.find((p) => p.id === opportunity.point_of_contact) ?? ctx.pick(people);
    const dueOffset = ctx.int(-10, 30);
    const title = (TASK_TITLES[i % TASK_TITLES.length] as (o: Opportunity, p: Person) => string)(opportunity, person);
    ctx.insert<Chore>('chore', {
      title,
      due_date: ctx.date(dueOffset),
      done: dueOffset < 0 ? ctx.chance(0.7) : ctx.chance(0.15),
      assignee: ctx.pick(ASSIGNEES),
      opportunity: ctx.chance(0.7) ? opportunity.id : null,
      person: person.id,
    });
  }

  for (let i = 0; i < 20; i += 1) {
    const person = ctx.pick(people);
    ctx.insert<Note>('note', {
      title: `${NOTE_TITLES[i % NOTE_TITLES.length]} – ${person.first_name} ${person.last_name ?? ''}`.trim(),
      body: ctx.pick(NOTE_BODIES),
      person: person.id,
      company: person.company,
    });
  }

  seedActivity(ctx, { companies, people, opportunities });
  seedDemoWorkflows(ctx.store);
  seedDemoModules(ctx.store);
};

const TEAM: Actor[] = [DEFAULT_MOCK_ACTOR, ...MOCK_TEAMMATES.map((user) => ({ kind: 'user' as const, id: user.id }))];

/**
 * History for the demo records, so their activity is not empty: who created them, deals moving through the
 * stages and a few edits by the team. It predates the live feed, so it goes straight to the activity.
 */
const seedActivity = (
  ctx: SeedContext,
  records: { companies: Company[]; people: Person[]; opportunities: Opportunity[] },
): void => {
  const { store } = ctx;
  const latest = Date.parse(store.now()) - 60_000;
  const rows: { objectId: string; recordId: string; at: number; actor: Actor; input: MockActivityInput }[] = [];
  const add = (object: string, record: RecordData, steps: MockActivityInput[]) => {
    const objectId = store.objectByName(object)?.id;

    if (!objectId) {
      return;
    }

    const start = Math.min(Date.parse(record.created_at), latest);
    const end = Math.max(start, Math.min(Date.parse(record.updated_at), latest));
    rows.push({ objectId, recordId: record.id, at: start, actor: ctx.pick(TEAM), input: { kind: 'created' } });
    steps.forEach((input, index) => {
      // Spread the later steps between creation and the last update, in order.
      const at = start + ((end - start) * (index + 1)) / (steps.length + 1);
      rows.push({ objectId, recordId: record.id, at: Math.round(at), actor: ctx.pick(TEAM), input });
    });
  };
  const change = (field: string, before: unknown, after: unknown): MockActivityInput => ({
    kind: 'updated',
    changes: [{ field, before, after } satisfies ActivityChange],
  });

  for (const company of records.companies) {
    add('company', company, []);
  }

  for (const person of records.people) {
    const steps: MockActivityInput[] = [];

    if (ctx.chance(0.3) && person.job_title) {
      const previous = ctx.pick(JOB_TITLES.filter((title) => title !== person.job_title));
      steps.push(change('job_title', previous, person.job_title));
    }

    add('person', person, steps);
  }

  for (const opportunity of records.opportunities) {
    const steps: MockActivityInput[] = [];
    const stage = opportunity.stage as (typeof STAGES)[number];
    // Walk the pipeline up to the current stage; lost deals drop out after a stage or two.
    const path: string[] =
      stage === 'lost'
        ? ['new', ...STAGES.slice(1, ctx.int(2, 3)), 'lost']
        : [...STAGES.slice(0, STAGES.indexOf(stage) + 1)];

    for (let i = 1; i < path.length; i += 1) {
      steps.push(change('stage', path[i - 1], path[i]));
    }

    if (typeof opportunity.amount === 'number' && ctx.chance(0.4)) {
      const amount = opportunity.amount;
      steps.splice(ctx.int(0, steps.length), 0, change('amount', Math.round((amount * 0.8) / 1000) * 1000, amount));
    }

    add('opportunity', opportunity, steps);
  }

  rows.sort((a, b) => a.at - b.at);
  store.activity.push(
    ...rows.map((row, index) => ({
      objectId: row.objectId,
      recordId: row.recordId,
      entry: {
        ...row.input,
        id: `seed-${index + 1}`,
        sequence: 0,
        actor: row.actor,
        occurredAt: new Date(row.at).toISOString(),
      } as ActivityEntry,
    })),
  );
};

/**
 * Payments installed from the catalog with a test key (nothing is called in the mock) and a workflow that starts from
 * its paid invoices. Skipped when the catalog has no Payments.
 */
const seedDemoModules = (store: MockStore): void => {
  const payments = store.catalog.find((manifest) => manifest.id === 'payments');

  if (!payments) {
    return;
  }

  if (!store.modules.has('payments')) {
    applyManifest(store, payments, { allowDestructive: true });
  }

  createConnection(store, { module: 'payments', values: { secret_key: 'sk_test_demo_0000000000000000' } });
  createWorkflow(store, {
    title: 'Invoice paid',
    description: 'When Payments reports a paid invoice, open a task to thank the customer.',
    trigger: { kind: 'event', moduleId: 'payments', types: ['invoice.paid'] },
    steps: [
      {
        id: 'thanks',
        kind: 'action',
        name: 'Thank-you task',
        actionId: 'core.create_record',
        input: {
          object: 'chore',
          values: {
            title: 'Thank {{event.payload.data.object.customer_email}} for paying',
            done: false,
            due_date: '{{today}}',
          },
        },
      },
    ],
  });
};

/** Two workflows so the Workflows settings and a record's Actions menu have something to show. */
const seedDemoWorkflows = (store: MockStore): void => {
  createWorkflow(store, {
    title: 'Customer kickoff',
    description: 'When a deal becomes a customer, close the probability and open a kickoff task.',
    trigger: {
      kind: 'record_event',
      objectId: 'opportunity',
      types: ['record.updated'],
      fieldIds: ['stage'],
      condition: { field: 'stage', op: 'eq', value: 'customer' },
    },
    steps: [
      {
        id: 'close',
        kind: 'action',
        name: 'Close it',
        actionId: 'core.update_record',
        input: { object: 'opportunity', id: '{{record.id}}', values: { probability: 100 } },
      },
      {
        id: 'chore',
        kind: 'action',
        name: 'Kickoff task',
        actionId: 'core.create_record',
        input: {
          object: 'chore',
          values: {
            title: 'Kick off {{record.name}}',
            opportunity: '{{record.id}}',
            done: false,
            due_date: '{{today}}',
          },
        },
      },
    ],
  });
  createWorkflow(store, {
    title: 'Mark as customer',
    description: 'Move an opportunity to the customer stage from its Actions menu.',
    trigger: { kind: 'manual', objectId: 'opportunity' },
    steps: [
      {
        id: 'won',
        kind: 'action',
        actionId: 'core.update_record',
        input: { object: 'opportunity', id: '{{record.id}}', values: { stage: 'customer', probability: 100 } },
      },
    ],
  });
};

/** Fill a mock client with the demo dataset, silently (no events), the way the old seed option did. */
export const seedDemo = (client: MockClient, options: SeedOptions = {}): void => {
  const { store } = client;
  store.silent = true;

  try {
    seedCrmDemo(createSeedContext(store, options));
  } finally {
    store.silent = false;
  }

  store.touch();
  store.changed();
};

/** A mock client with the demo dataset already in it; `today` and `seed` steer the generator. */
export const demoClient = (options: MockClientOptions & SeedOptions): MockClient => {
  const { today, seed, ...rest } = options;
  const client = createMockClient(rest);
  seedDemo(client, { ...(today ? { today } : {}), ...(seed !== undefined ? { seed } : {}) });

  return client;
};
