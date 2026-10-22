import { evaluateFilter, type Filter, matchesSearch, type RecordData, type Sort, sortRecords } from '@devias/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EngineError, functionContext } from '../src';
import { createTestEngine, type TestEngine } from './helpers/db';

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;

    return 'ok';
  } catch (error) {
    if (error instanceof EngineError) {
      return error.code;
    }

    throw error;
  }
};

/** Deterministic PRNG so the oracle dataset is stable. */
const prng = (seed: number) => {
  let s = seed >>> 0;

  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;

    return s / 0x100000000;
  };
};

describe('records on PGlite', () => {
  let t: TestEngine;
  let companyId: string;

  beforeAll(async () => {
    t = await createTestEngine();
    const company = await t.engine.records.create(t.owner, 'company', { name: 'Globex', domain: 'GLOBEX.example' });
    companyId = company.id;
  });
  afterAll(() => t.close());

  it('creates records per field type with defaults, normalization and null-filled output', async () => {
    const opp = await t.engine.records.create(t.owner, 'opportunity', {
      name: 'Big deal',
      amount: 1200.5,
      close_date: '2026-03-01',
      probability: 40,
      rating: { stars: 4 },
      company: companyId,
    });
    expect(opp.stage).toBe('new'); // default applied
    expect(opp.point_of_contact).toBeNull(); // absent optional fields are null in the output
    expect(opp.rating).toEqual({ stars: 4 }); // unknown types are opaque
    expect(opp.created_by).toBe('user:u_owner');
    expect(opp.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const fetched = await t.engine.records.get(t.owner, 'opportunity', opp.id);
    expect(fetched).toEqual(opp);
  });

  it('validates values, unknown keys, required fields and select options', async () => {
    expect(await codeOf(t.engine.records.create(t.owner, 'opportunity', { name: 'x', stage: 'nope' }))).toBe(
      'VALIDATION',
    );
    expect(await codeOf(t.engine.records.create(t.owner, 'opportunity', { name: 'x', ghost: 1 }))).toBe('VALIDATION');
    expect(await codeOf(t.engine.records.create(t.owner, 'opportunity', { amount: 1 }))).toBe('VALIDATION');
    expect(await codeOf(t.engine.records.create(t.owner, 'company', { name: 'y', employees: 'many' }))).toBe(
      'VALIDATION',
    );
    expect(await codeOf(t.engine.records.create(t.owner, 'person', { first_name: 'a', email: 'not-an-email' }))).toBe(
      'VALIDATION',
    );
    expect(await codeOf(t.engine.records.create(t.owner, 'chore', { title: 'a', due_date: '01/02/2026' }))).toBe(
      'VALIDATION',
    );
  });

  it('validates relation targets (must exist, same object, not deleted) in batches', async () => {
    const ghost = '019965a0-0000-7000-8000-00000000dead';
    expect(await codeOf(t.engine.records.create(t.owner, 'person', { first_name: 'a', company: ghost }))).toBe(
      'VALIDATION',
    );
    expect(await codeOf(t.engine.records.create(t.owner, 'person', { first_name: 'a', company: 'not-a-uuid' }))).toBe(
      'VALIDATION',
    );
    const person = await t.engine.records.create(t.owner, 'person', { first_name: 'Bob' });
    // a person id is not a valid company id
    expect(await codeOf(t.engine.records.create(t.owner, 'person', { first_name: 'a', company: person.id }))).toBe(
      'VALIDATION',
    );
    const doomed = await t.engine.records.create(t.owner, 'company', { name: 'Doomed' });
    await t.engine.records.delete(t.owner, 'company', [doomed.id]);
    expect(await codeOf(t.engine.records.create(t.owner, 'person', { first_name: 'a', company: doomed.id }))).toBe(
      'VALIDATION',
    );
    const ok = await t.engine.records.batch(t.owner, 'person', {
      create: [
        { first_name: 'c1', company: companyId },
        { first_name: 'c2', company: companyId },
      ],
    });
    expect(ok.created).toHaveLength(2);
  });

  it('enforces uniqueness case-insensitively for emails and releases claims on update and delete', async () => {
    const a = await t.engine.records.create(t.owner, 'person', { first_name: 'Ann', email: 'Ann@Example.com' });
    expect(a.email).toBe('ann@example.com');
    expect(
      await codeOf(t.engine.records.create(t.owner, 'person', { first_name: 'Dup', email: 'ANN@example.COM' })),
    ).toBe('UNIQUE_VIOLATION');
    expect(await codeOf(t.engine.records.create(t.owner, 'company', { name: 'Globex' }))).toBe('UNIQUE_VIOLATION');
    await t.engine.records.update(t.owner, 'person', a.id, { email: 'ann2@example.com' });
    const b = await t.engine.records.create(t.owner, 'person', { first_name: 'B', email: 'ann@example.com' });
    await t.engine.records.delete(t.owner, 'person', [b.id]);
    await expect(
      t.engine.records.create(t.owner, 'person', { first_name: 'C', email: 'ann@example.com' }),
    ).resolves.toBeTruthy();
    // a batch with two identical emails fails atomically
    const before = await t.engine.records.list(t.owner, { object: 'person', count: true });
    expect(
      await codeOf(
        t.engine.records.batch(t.owner, 'person', {
          create: [
            { first_name: 'x', email: 'same@example.com' },
            { first_name: 'y', email: 'same@example.com' },
          ],
        }),
      ),
    ).toBe('UNIQUE_VIOLATION');
    const after = await t.engine.records.list(t.owner, { object: 'person', count: true });
    expect(after.totalCount).toBe(before.totalCount);
  });

  it('updates with diffs, skips no-op patches, soft deletes and keeps dense sequences', async () => {
    const start = await t.engine.events.currentSequence(t.workspaceId);
    const task = await t.engine.records.create(t.owner, 'chore', { title: 'Call', done: false });
    const same = await t.engine.records.update(t.owner, 'chore', task.id, { done: false });
    expect(same.updated_at).toBe(task.updated_at);
    const changed = await t.engine.records.update(t.member, 'chore', task.id, { done: true, assignee: 'me' });
    expect(changed.done).toBe(true);
    expect(changed.updated_by).toBe('user:u_member');
    await t.engine.records.delete(t.owner, 'chore', [task.id]);
    expect(await codeOf(t.engine.records.get(t.owner, 'chore', task.id))).toBe('NOT_FOUND');
    expect(await codeOf(t.engine.records.delete(t.owner, 'chore', [task.id]))).toBe('NOT_FOUND');
    const events = await t.engine.events.list(t.owner, { after: start });
    expect(events.map((e) => e.sequence)).toEqual([start + 1, start + 2, start + 3]);
    expect(events.map((e) => e.type)).toEqual(['record.created', 'record.updated', 'record.deleted']);
    const updated = events[1];
    expect(updated?.type === 'record.updated' && updated.changedFields?.sort()).toEqual(['assignee', 'done']);
    expect(updated?.actor).toEqual({ kind: 'user', id: 'u_member' });
  });

  it('enforces permissions and read-only objects', async () => {
    const stranger = { workspaceId: t.workspaceId, actor: { kind: 'user' as const, id: 'nobody' }, role: null };
    expect(await codeOf(t.engine.records.list(stranger, { object: 'person' }))).toBe('FORBIDDEN');
    const readKey = { workspaceId: t.workspaceId, actor: { kind: 'api_key' as const, id: 'k' }, role: null };
    expect(await codeOf(t.engine.records.list(readKey, { object: 'person' }))).toBe('ok');
    expect(await codeOf(t.engine.records.create(readKey, 'person', { first_name: 'k' }))).toBe('FORBIDDEN');
    const schema = await t.engine.metadata.getSchema(t.owner);
    const note = schema.objects.find((o) => o.nameSingular === 'note');

    if (!note) {
      throw new Error('note object missing');
    }

    await t.engine.metadata.objects.update(t.owner, note.id, { readOnly: true });
    expect(await codeOf(t.engine.records.create(t.member, 'note', { title: 'x' }))).toBe('FORBIDDEN');
    expect(await codeOf(t.engine.records.create(t.owner, 'note', { title: 'x' }))).toBe('ok');
    expect(
      await codeOf(
        t.engine.records.create(functionContext(t.workspaceId, 'fixture/function/x'), 'note', { title: 'y' }),
      ),
    ).toBe('ok');
    await t.engine.metadata.objects.update(t.owner, note.id, { readOnly: false });
    expect(await codeOf(t.engine.records.create(t.member, 'note', { title: 'z' }))).toBe('ok');
  });

  it('includes related records in batches and honours select', async () => {
    const page = await t.engine.records.list(t.owner, {
      object: 'person',
      filter: { field: 'company', op: 'is_not_empty' },
      include: { company: { select: ['name'] } },
      select: ['first_name', 'company'],
    });
    expect(page.items.length).toBeGreaterThan(0);

    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual([
        'company',
        'created_at',
        'created_by',
        'first_name',
        'id',
        'updated_at',
        'updated_by',
      ]);
    }

    expect(page.included?.company).toEqual([expect.objectContaining({ id: companyId, name: 'Globex' })]);
    expect(Object.keys(page.included?.company?.[0] ?? {})).not.toContain('domain');
  });

  it('searches module field values as JSON text with contains', async () => {
    const schema = await t.engine.metadata.getSchema(t.owner);
    const company = schema.objects.find((o) => o.nameSingular === 'company');

    if (!company) {
      throw new Error('company');
    }

    // A module field type: the engine stores its values as JSON without knowing their shape.
    const brief = await t.engine.metadata.fields.create(t.owner, {
      objectId: company.id,
      name: 'brief',
      type: 'rich_text',
      label: 'Brief',
    });
    const mention = (id: string) => ({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { object: 'company', id, label: 'X' } }] }],
    });
    const mentioning = await t.engine.records.create(t.owner, 'company', {
      name: 'Mentions',
      brief: mention(companyId),
    });
    await t.engine.records.create(t.owner, 'company', { name: 'Other', brief: mention('someone-else') });
    const filter: Filter = { field: 'brief', op: 'contains', value: `"${companyId}"` };
    const page = await t.engine.records.list(t.owner, { object: 'company', filter });
    expect(page.items.map((r) => r.id)).toEqual([mentioning.id]);
    // The core evaluator (used client-side and by the mock) agrees with Postgres.
    expect(page.items.every((r) => evaluateFilter(r, filter))).toBe(true);
    await t.engine.metadata.fields.delete(t.owner, brief.id);
  });

  it('refuses to name an object like what a mention can point at', async () => {
    expect(
      await codeOf(
        t.engine.metadata.objects.create(t.owner, {
          nameSingular: 'workflow',
          namePlural: 'workflows',
          labelSingular: 'Workflow',
          labelPlural: 'Workflows',
        }),
      ),
    ).toBe('VALIDATION');
  });

  it('deletes only the records an object\u2019s delete rule allows, and takes the records that cascade with them', async () => {
    const { metadata, records, events } = t.engine;
    const order = await metadata.objects.create(t.owner, {
      nameSingular: 'ruled_order',
      namePlural: 'ruled_orders',
      labelSingular: 'Order',
      labelPlural: 'Orders',
      deleteWhen: { field: 'status', op: 'eq', value: 'draft' },
    });
    const line = await metadata.objects.create(t.owner, {
      nameSingular: 'ruled_line',
      namePlural: 'ruled_lines',
      labelSingular: 'Line',
      labelPlural: 'Lines',
    });
    await metadata.fields.create(t.owner, { objectId: order.id, name: 'status', type: 'text', label: 'Status' });
    const relation = (onDelete?: 'cascade') => ({
      relationType: 'many_to_one',
      targetObjectId: order.id,
      ...(onDelete ? { onDelete } : {}),
    });
    await metadata.fields.create(t.owner, {
      objectId: line.id,
      name: 'order',
      type: 'relation',
      label: 'Order',
      settings: relation('cascade'),
    });
    await metadata.fields.create(t.owner, {
      objectId: line.id,
      name: 'keeper',
      type: 'relation',
      label: 'Keeper',
      settings: relation(),
    });
    const draft = await records.create(t.owner, 'ruled_order', { status: 'draft' });
    const sent = await records.create(t.owner, 'ruled_order', { status: 'sent' });
    const onDraft = await records.create(t.owner, 'ruled_line', { order: draft.id });
    const kept = await records.create(t.owner, 'ruled_line', { keeper: draft.id });
    const onSent = await records.create(t.owner, 'ruled_line', { order: sent.id });

    // A record that fails the rule stays, with everything else in the same call.
    expect(await codeOf(records.delete(t.owner, 'ruled_order', [draft.id, sent.id]))).toBe('CONFLICT');
    expect(await codeOf(records.get(t.owner, 'ruled_order', draft.id))).toBe('ok');
    expect(await codeOf(records.batch(t.owner, 'ruled_order', { delete: [sent.id] }))).toBe('CONFLICT');

    const start = await events.currentSequence(t.workspaceId);
    await records.delete(t.owner, 'ruled_order', [draft.id]);
    expect(await codeOf(records.get(t.owner, 'ruled_order', draft.id))).toBe('NOT_FOUND');
    // Its lines go with it, through the cascading relation only; the other lines stay.
    expect(await codeOf(records.get(t.owner, 'ruled_line', onDraft.id))).toBe('NOT_FOUND');
    expect(await codeOf(records.get(t.owner, 'ruled_line', kept.id))).toBe('ok');
    expect(await codeOf(records.get(t.owner, 'ruled_line', onSent.id))).toBe('ok');
    const feed = await events.list(t.owner, { after: start });
    expect(feed.map((e) => [e.type, 'object' in e ? e.object : null])).toEqual([
      ['record.deleted', 'ruled_order'],
      ['record.deleted', 'ruled_line'],
    ]);

    // Changing the rule changes what can go; `null` removes it.
    await metadata.objects.update(t.owner, order.id, { deleteWhen: null });
    await records.delete(t.owner, 'ruled_order', [sent.id]);
    expect(await codeOf(records.get(t.owner, 'ruled_line', onSent.id))).toBe('NOT_FOUND');
    expect((await metadata.objects.get(t.owner, order.id)).deleteWhen).toBeUndefined();
  });

  it('searches across searchable fields and reports label titles', async () => {
    const hits = await t.engine.records.lookup(t.owner, { text: 'glob' });
    expect(hits.some((h) => h.object === 'company' && h.title === 'Globex' && h.subtitle === 'Company')).toBe(true);
    const only = await t.engine.records.lookup(t.owner, { text: 'glob', objects: ['person'] });
    expect(only).toEqual([]);
  });

  describe('filters, sorts and keyset walks agree with the core oracle', () => {
    const rows: RecordData[] = [];
    const names = ['Ada', 'ada', 'Bob', 'Zed', 'carol', 'Dan', 'eve', 'Frank', 'grace', 'Heidi'];
    const stages = ['new', 'screening', 'meeting', 'proposal', 'customer', 'lost'];

    beforeAll(async () => {
      const rand = prng(42);
      const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)] as T;
      const maybe = <T>(value: T, p = 0.25): T | null => (rand() < p ? null : value);
      const creates: Record<string, unknown>[] = [];

      for (let i = 0; i < 60; i += 1) {
        creates.push({
          name: `${pick(names)} ${i}`,
          stage: pick(stages),
          amount: maybe(Math.round(rand() * 5000) / 10),
          close_date: maybe(
            `2026-0${1 + Math.floor(rand() * 9)}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`,
          ),
          probability: maybe(Math.floor(rand() * 100), 0.5),
          company: maybe(companyId, 0.5),
        });
      }

      const result = await t.engine.records.batch(t.owner, 'opportunity', { create: creates });
      rows.push(...result.created);
      const all = await t.engine.records.list(t.owner, { object: 'opportunity', limit: 200 });
      rows.length = 0;
      rows.push(...all.items);
    });

    const cases: { name: string; filter?: Filter; sort: Sort[]; search?: string }[] = [
      { name: 'plain by id', sort: [] },
      { name: 'amount asc (nulls last)', sort: [{ field: 'amount', direction: 'asc' }] },
      { name: 'amount desc (nulls first)', sort: [{ field: 'amount', direction: 'desc' }] },
      {
        name: 'mixed directions with nulls',
        sort: [
          { field: 'close_date', direction: 'desc' },
          { field: 'probability', direction: 'asc' },
          { field: 'name', direction: 'asc' },
        ],
      },
      {
        name: 'text sort + filter tree',
        filter: {
          and: [
            {
              or: [
                { field: 'stage', op: 'in', value: ['new', 'CUSTOMER'] },
                { field: 'amount', op: 'gt', value: 400 },
              ],
            },
            { not: { field: 'probability', op: 'is_empty' } },
          ],
        },
        sort: [{ field: 'name', direction: 'desc' }],
      },
      {
        name: 'not over null comparisons and between',
        filter: {
          or: [
            { not: { field: 'amount', op: 'neq', value: 10 } },
            { field: 'close_date', op: 'between', value: ['2026-03-01', '2026-06-30'] },
          ],
        },
        sort: [
          { field: 'stage', direction: 'asc' },
          { field: 'amount', direction: 'desc' },
        ],
      },
      {
        name: 'contains/startsWith case-insensitive + relation',
        filter: {
          and: [
            { field: 'name', op: 'contains', value: 'A' },
            {
              or: [
                { field: 'name', op: 'starts_with', value: 'ad' },
                { field: 'company', op: 'eq', value: '{{company}}' },
              ],
            },
          ],
        },
        sort: [{ field: 'probability', direction: 'desc' }],
      },
      { name: 'search', search: 'ada', sort: [{ field: 'amount', direction: 'asc' }] },
      {
        name: 'notIn + lte',
        filter: {
          and: [
            { field: 'stage', op: 'not_in', value: ['lost'] },
            { field: 'amount', op: 'lte', value: 250 },
          ],
        },
        sort: [{ field: 'close_date', direction: 'asc' }],
      },
    ];

    for (const c of cases) {
      it(c.name, async () => {
        const filter = c.filter
          ? (JSON.parse(JSON.stringify(c.filter).replace('{{company}}', companyId)) as Filter)
          : undefined;
        const expected = sortRecords(
          rows.filter((r) => evaluateFilter(r, filter) && (!c.search || matchesSearch(r, ['name'], c.search))),
          c.sort,
        ).map((r) => r.id);
        const walked: string[] = [];
        let cursor: string | undefined;
        let pages = 0;

        do {
          const page = await t.engine.records.list(t.owner, {
            object: 'opportunity',
            filter,
            sort: c.sort,
            search: c.search,
            limit: 7,
            cursor,
            count: true,
          });
          expect(page.totalCount).toBe(expected.length);
          walked.push(...page.items.map((r) => r.id));
          cursor = page.nextCursor ?? undefined;
          pages += 1;
        } while (cursor && pages < 50);

        expect(walked).toEqual(expected);
        expect(pages).toBe(Math.max(1, Math.ceil(expected.length / 7)));
      });
    }

    it('rejects a cursor issued for another query', async () => {
      const page = await t.engine.records.list(t.owner, {
        object: 'opportunity',
        sort: [{ field: 'amount', direction: 'asc' }],
        limit: 2,
      });
      expect(page.nextCursor).toBeTruthy();
      expect(
        await codeOf(
          t.engine.records.list(t.owner, {
            object: 'opportunity',
            sort: [{ field: 'amount', direction: 'desc' }],
            cursor: page.nextCursor ?? '',
          }),
        ),
      ).toBe('INVALID_CURSOR');
    });
  });
});
