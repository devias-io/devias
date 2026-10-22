import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EngineError } from '../src';
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

describe('record activity on PGlite', () => {
  let t: TestEngine;
  let dealId: string;

  beforeAll(async () => {
    t = await createTestEngine();
    const deal = await t.engine.records.create(t.owner, 'opportunity', { name: 'Big deal', amount: 100 });
    dealId = deal.id;
    await t.engine.records.update(t.member, 'opportunity', dealId, { stage: 'meeting', amount: 250 });
    // An update that changes nothing leaves no trace.
    await t.engine.records.update(t.member, 'opportunity', dealId, { amount: 250 });
  });
  afterAll(() => t.close());

  it('lists what changed, newest first, with who changed it and the values before and after', async () => {
    const page = await t.engine.activity.list(t.owner, 'opportunity', dealId);
    expect(page.items.map((entry) => entry.kind)).toEqual(['updated', 'created']);
    const [updated, created] = page.items;
    expect(updated).toMatchObject({
      kind: 'updated',
      actor: { kind: 'user', id: 'u_member' },
      changes: [
        { field: 'stage', before: 'new', after: 'meeting' },
        { field: 'amount', before: 100, after: 250 },
      ],
    });
    expect(created).toMatchObject({ kind: 'created', actor: { kind: 'user', id: 'u_owner' } });
    expect(page.nextCursor).toBeNull();
  });

  it('pages with a cursor and rejects bad input', async () => {
    const first = await t.engine.activity.list(t.owner, 'opportunity', dealId, { limit: 1 });
    expect(first.items.map((entry) => entry.kind)).toEqual(['updated']);
    expect(first.nextCursor).not.toBeNull();
    const second = await t.engine.activity.list(t.owner, 'opportunity', dealId, {
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((entry) => entry.kind)).toEqual(['created']);
    expect(second.nextCursor).toBeNull();

    expect(await codeOf(t.engine.activity.list(t.owner, 'opportunity', dealId, { cursor: 'nope' }))).toBe(
      'INVALID_CURSOR',
    );
    const missing = '0190a000-0000-7000-8000-000000000000';
    expect(await codeOf(t.engine.activity.list(t.owner, 'opportunity', missing))).toBe('ok');
  });

  it('keeps other records out of the activity', async () => {
    const other = await t.engine.records.create(t.owner, 'opportunity', { name: 'Other deal' });
    await t.engine.records.update(t.owner, 'opportunity', other.id, { amount: 5 });
    const page = await t.engine.activity.list(t.owner, 'opportunity', dealId);
    expect(page.items).toHaveLength(2);
    expect(page.items.every((entry) => entry.id !== undefined)).toBe(true);
  });
});

describe('purging a workspace with notes', () => {
  it('leaves none of them behind', async () => {
    const t = await createTestEngine();

    try {
      const deal = await t.engine.records.create(t.owner, 'opportunity', { name: 'Gone soon' });
      await t.engine.notes.create(t.owner, 'opportunity', deal.id, { title: 'Gate code' });
      const count = async (table: string) =>
        (await t.client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]?.n;
      expect(await count('comment')).toBe(1);

      await t.engine.workspaces.purge(t.workspaceId);
      expect([await count('comment'), await count('record')]).toEqual([0, 0]);
    } finally {
      await t.close();
    }
  });
});
