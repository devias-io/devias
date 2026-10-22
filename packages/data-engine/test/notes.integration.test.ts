import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EngineError, readEventsAfter } from '../src';
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

describe('record notes on PGlite', () => {
  let t: TestEngine;
  let dealId: string;

  beforeAll(async () => {
    t = await createTestEngine();
    dealId = (await t.engine.records.create(t.owner, 'opportunity', { name: 'Big deal', amount: 100 })).id;
  });
  afterAll(() => t.close());

  it('writes notes as the caller, newest first, and tells the change feed', async () => {
    const before = (await readEventsAfter(t.db, t.workspaceId, 0, 1000)).length;
    const first = await t.engine.notes.create(t.member, 'opportunity', dealId, {
      title: '  Gate code  ',
      body: '4512, ring twice',
    });
    expect(first).toMatchObject({
      object: 'opportunity',
      recordId: dealId,
      title: 'Gate code',
      body: '4512, ring twice',
      author: { kind: 'user', id: 'u_member' },
    });
    const second = await t.engine.notes.create(t.owner, 'opportunity', dealId, { title: 'Wants a heat pump' });
    expect(second.body).toBe('');

    const page = await t.engine.notes.list(t.owner, 'opportunity', dealId);
    expect(page.items.map((note) => note.title)).toEqual(['Wants a heat pump', 'Gate code']);
    expect(page.total).toBe(2);
    expect(page.nextCursor).toBeNull();

    const events = await readEventsAfter(t.db, t.workspaceId, 0, 1000);
    expect(events.slice(before).map((event) => event.type)).toEqual(['note.created', 'note.created']);
    expect(events.at(-1)).toMatchObject({ object: 'opportunity', recordId: dealId, noteId: second.id });
    // A note leaves the record, and its activity, untouched.
    const activity = await t.engine.activity.list(t.owner, 'opportunity', dealId);
    expect(activity.items.map((entry) => entry.kind)).toEqual(['created']);
  });

  it('pages with a cursor', async () => {
    const id = (await t.engine.records.create(t.owner, 'opportunity', { name: 'Many notes' })).id;

    for (const title of ['one', 'two', 'three', 'four', 'five']) {
      await t.engine.notes.create(t.owner, 'opportunity', id, { title });
    }

    const first = await t.engine.notes.list(t.owner, 'opportunity', id, { limit: 2 });
    expect(first.items.map((note) => note.title)).toEqual(['five', 'four']);
    expect(first.total).toBe(5);
    const second = await t.engine.notes.list(t.owner, 'opportunity', id, { limit: 2, cursor: first.nextCursor ?? '' });
    expect(second.items.map((note) => note.title)).toEqual(['three', 'two']);
    const third = await t.engine.notes.list(t.owner, 'opportunity', id, { limit: 2, cursor: second.nextCursor ?? '' });
    expect(third.items.map((note) => note.title)).toEqual(['one']);
    expect(third.nextCursor).toBeNull();
    expect(await codeOf(t.engine.notes.list(t.owner, 'opportunity', id, { cursor: 'nonsense' }))).toBe(
      'INVALID_CURSOR',
    );
  });

  it('lets authors edit and remove their own notes, and admins any', async () => {
    const own = await t.engine.notes.create(t.member, 'opportunity', dealId, { title: 'Mine', body: 'draft' });
    const edited = await t.engine.notes.update(t.member, 'opportunity', dealId, own.id, { body: 'final' });
    expect(edited).toMatchObject({ title: 'Mine', body: 'final' });
    expect(Date.parse(edited.updatedAt)).toBeGreaterThanOrEqual(Date.parse(own.createdAt));

    const theirs = await t.engine.notes.create(t.owner, 'opportunity', dealId, { title: 'Theirs' });
    expect(await codeOf(t.engine.notes.update(t.member, 'opportunity', dealId, theirs.id, { title: 'x' }))).toBe(
      'FORBIDDEN',
    );
    expect(await codeOf(t.engine.notes.delete(t.member, 'opportunity', dealId, theirs.id))).toBe('FORBIDDEN');
    // The owner is an admin: they can edit and remove the member's note.
    await t.engine.notes.update(t.owner, 'opportunity', dealId, own.id, { title: 'Corrected' });
    await t.engine.notes.delete(t.owner, 'opportunity', dealId, own.id);
    const left = await t.engine.notes.list(t.owner, 'opportunity', dealId);
    expect(left.items.map((note) => note.title)).not.toContain('Corrected');
    expect(await codeOf(t.engine.notes.delete(t.owner, 'opportunity', dealId, own.id))).toBe('NOT_FOUND');
  });

  it('refuses empty titles, unknown records and notes that belong to another record', async () => {
    expect(await codeOf(t.engine.notes.create(t.owner, 'opportunity', dealId, { title: '   ' }))).toBe('VALIDATION');
    expect(
      await codeOf(
        t.engine.notes.create(t.owner, 'opportunity', '11111111-1111-4111-8111-111111111111', { title: 'Ghost' }),
      ),
    ).toBe('NOT_FOUND');
    expect(await codeOf(t.engine.notes.update(t.owner, 'opportunity', dealId, 'not-an-id', { title: 'x' }))).toBe(
      'VALIDATION',
    );
    const other = (await t.engine.records.create(t.owner, 'opportunity', { name: 'Other deal' })).id;
    const note = await t.engine.notes.create(t.owner, 'opportunity', other, { title: 'On the other deal' });
    expect(await codeOf(t.engine.notes.update(t.owner, 'opportunity', dealId, note.id, { title: 'x' }))).toBe(
      'NOT_FOUND',
    );
  });

  it('goes with the record when it is deleted', async () => {
    const id = (await t.engine.records.create(t.owner, 'opportunity', { name: 'Short lived' })).id;
    await t.engine.notes.create(t.owner, 'opportunity', id, { title: 'Soon gone' });
    await t.engine.records.delete(t.owner, 'opportunity', [id]);
    const rows = await t.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM comment WHERE entity_kind = 'record' AND entity_id = '${id}' AND deleted_at IS NULL`,
    );
    expect(rows.rows[0]?.n).toBe(0);
  });
});
