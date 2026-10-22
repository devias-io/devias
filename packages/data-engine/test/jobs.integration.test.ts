import { manifest as fixtureManifest } from '@devias/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDataEngine,
  type DataEngine,
  type EngineContext,
  EngineError,
  moduleActorContext,
  readEventsAfter,
  silentLogger,
} from '../src';
import { createTestDb, type TestDb } from './helpers/db';

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

describe('module jobs, state and upserts on PGlite', () => {
  let db: TestDb;
  let engine: DataEngine;
  let now = new Date('2026-10-11T10:00:00.000Z');
  const workspaceId = 'ws_jobs';
  const owner: EngineContext = { workspaceId, actor: { kind: 'user', id: 'u_owner' }, role: 'owner' };
  const member: EngineContext = { workspaceId, actor: { kind: 'user', id: 'u_member' }, role: 'member' };
  const later = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };

  beforeAll(async () => {
    db = await createTestDb();
    engine = createDataEngine({
      db: db.db,
      logger: silentLogger,
      seedManifests: [fixtureManifest],
      clock: () => now,
    });
    await engine.workspaces.initialize(workspaceId);
  });
  afterAll(async () => {
    await engine.close();
    await db.close();
  });

  it('queues a job once per key, and hands each due job to one worker at a time', async () => {
    const first = await engine.jobs.enqueue(workspaceId, {
      moduleId: 'fixture',
      name: 'sync',
      payload: { full: true },
      key: 'sync:first',
      maxAttempts: 3,
    });
    const again = await engine.jobs.enqueue(workspaceId, {
      moduleId: 'fixture',
      name: 'sync',
      key: 'sync:first',
      maxAttempts: 3,
    });
    expect(again.id).toBe(first.id);
    const delayed = await engine.jobs.enqueue(workspaceId, {
      moduleId: 'fixture',
      name: 'later',
      runAt: new Date(now.getTime() + 60_000),
      maxAttempts: 1,
    });
    // Two workers at once: each job goes to one of them, and the delayed one to neither yet.
    const [a, b] = await Promise.all([
      engine.jobs.claim({ limit: 10, leaseMs: 60_000 }),
      engine.jobs.claim({ limit: 10, leaseMs: 60_000 }),
    ]);
    const claimed = [...a, ...b];
    expect(claimed.map((job) => job.id)).toEqual([first.id]);
    expect(claimed[0]).toMatchObject({ status: 'running', attempts: 1, payload: { full: true }, workspaceId });
    expect(await engine.jobs.claim({ limit: 10, leaseMs: 60_000 })).toEqual([]);
    // A worker that stops leaves the job to be taken again once its lease runs out; that is another attempt.
    later(61_000);
    const taken = await engine.jobs.claim({ limit: 10, leaseMs: 60_000 });
    expect(taken.map((job) => [job.id, job.attempts])).toEqual([
      [first.id, 2],
      [delayed.id, 1],
    ]);
    const [retaken, due] = taken as [(typeof taken)[0], (typeof taken)[0]];
    await engine.jobs.complete(retaken, { synced: 12 });
    await engine.jobs.complete(due, null);
    expect(await engine.jobs.get(member, first.id)).toMatchObject({
      status: 'succeeded',
      result: { synced: 12 },
      lastError: null,
    });
  });

  it('puts a failed attempt back when told to retry, and announces a job that failed for good', async () => {
    const job = await engine.jobs.enqueue(workspaceId, { moduleId: 'fixture', name: 'push', maxAttempts: 2 });
    const [attempt] = await engine.jobs.claim({ limit: 1, leaseMs: 60_000 });

    if (!attempt) {
      throw new Error('the job is due');
    }

    await engine.jobs.fail(attempt, 'Rate limited', new Date(now.getTime() + 30_000));
    expect(await engine.jobs.get(owner, job.id)).toMatchObject({ status: 'pending', lastError: 'Rate limited' });
    expect(await engine.jobs.claim({ limit: 1, leaseMs: 60_000 })).toEqual([]);
    later(30_000);
    const [second] = await engine.jobs.claim({ limit: 1, leaseMs: 60_000 });

    if (!second) {
      throw new Error('the job is due again');
    }

    const before = await engine.events.currentSequence(workspaceId);
    await engine.jobs.fail(second, 'Still rate limited', null);
    const failed = await engine.jobs.get(owner, job.id);
    expect(failed).toMatchObject({ status: 'failed', attempts: 2, lastError: 'Still rate limited' });
    expect(failed.finishedAt).not.toBeNull();
    expect(await readEventsAfter(db.db, workspaceId, before, 10)).toEqual([
      expect.objectContaining({ type: 'job.failed', moduleId: 'fixture', jobId: job.id, name: 'push' }),
    ]);

    // Listing filters and pages; retrying is for admins, and for failed jobs only.
    const failedOnes = await engine.jobs.list(member, { status: 'failed' });
    expect(failedOnes.items.map((item) => item.id)).toEqual([job.id]);
    expect(failedOnes.items[0]).not.toHaveProperty('workspaceId');
    const page = await engine.jobs.list(member, { module: 'fixture', limit: 2 });
    expect(page.items.map((item) => item.name)).toEqual(['push', 'later']);
    expect((await engine.jobs.list(member, { cursor: page.nextCursor ?? undefined })).items.map((i) => i.name)).toEqual(
      ['sync'],
    );
    expect(await codeOf(engine.jobs.list(member, { status: 'nope' }))).toBe('VALIDATION');
    expect(await codeOf(engine.jobs.retry(member, job.id))).toBe('FORBIDDEN');
    const retried = await engine.jobs.retry(owner, job.id);
    expect(retried).toMatchObject({ status: 'pending', attempts: 0, finishedAt: null });
    expect(await codeOf(engine.jobs.retry(owner, job.id))).toBe('CONFLICT');
    expect(await codeOf(engine.jobs.get(owner, '00000000-0000-0000-0000-000000000000'))).toBe('NOT_FOUND');
  });

  it('forgets finished jobs past their retention', async () => {
    later(31 * 86_400_000);
    // The retried job is pending again, so it stays.
    expect(await engine.jobs.prune(new Date(now.getTime() - 30 * 86_400_000))).toBe(2);
    expect((await engine.jobs.list(owner)).items.map((job) => job.status)).toEqual(['pending']);
  });

  it("keeps a module's own state per workspace, with expiry and a size limit", async () => {
    await engine.moduleKv.set(workspaceId, 'fixture', 'cursor', { page: 3 });
    expect(await engine.moduleKv.get(workspaceId, 'fixture', 'cursor')).toEqual({ page: 3 });
    expect(await engine.moduleKv.get(workspaceId, 'other', 'cursor')).toBeUndefined();
    expect(await engine.moduleKv.get('ws_elsewhere', 'fixture', 'cursor')).toBeUndefined();
    await engine.moduleKv.set(workspaceId, 'fixture', 'cursor', { page: 4 }, { ttlMs: 1000 });
    expect(await engine.moduleKv.get(workspaceId, 'fixture', 'cursor')).toEqual({ page: 4 });
    later(1001);
    expect(await engine.moduleKv.get(workspaceId, 'fixture', 'cursor')).toBeUndefined();
    await engine.moduleKv.set(workspaceId, 'fixture', 'seen', ['a']);
    await engine.moduleKv.delete(workspaceId, 'fixture', 'seen');
    expect(await engine.moduleKv.get(workspaceId, 'fixture', 'seen')).toBeUndefined();
    expect(await codeOf(engine.moduleKv.set(workspaceId, 'fixture', 'big', 'x'.repeat(70_000)))).toBe('VALIDATION');
    expect(await codeOf(engine.moduleKv.set(workspaceId, 'fixture', '', 1))).toBe('VALIDATION');
  });

  it('upserts by a unique field: creates once, then updates the same record', async () => {
    const first = await engine.records.upsert(owner, 'person', { email: 'ada@example.com' }, { first_name: 'Ada' });
    expect(first.created).toBe(true);
    expect(first.record).toMatchObject({ email: 'ada@example.com', first_name: 'Ada' });
    const second = await engine.records.upsert(
      owner,
      'person',
      { email: 'ada@example.com' },
      { first_name: 'Ada', last_name: 'Lovelace' },
    );
    expect(second).toMatchObject({ created: false, record: { id: first.record.id, last_name: 'Lovelace' } });
    const upsert = (match: Record<string, unknown>, values: Record<string, unknown> = { first_name: 'X' }) =>
      engine.records.upsert(owner, 'person', match, values);
    expect(await codeOf(upsert({}))).toBe('VALIDATION');
    expect(await codeOf(upsert({ email: 'a@x.test', phone: '1' }))).toBe('VALIDATION');
    expect(await codeOf(upsert({ first_name: 'Ada' }))).toBe('VALIDATION');
    expect(await codeOf(upsert({ nope: 'x' }))).toBe('VALIDATION');
    expect(await codeOf(upsert({ email: '' }))).toBe('VALIDATION');
    expect(await codeOf(upsert({ email: 'b@x.test' }, { first_name: 'B', email: 'c@x.test' }))).toBe('VALIDATION');
    // Two writers at once on a new value end with one record.
    const racing = await Promise.all([
      upsert({ email: 'grace@example.com' }, { first_name: 'Grace' }),
      upsert({ email: 'grace@example.com' }, { first_name: 'Grace', last_name: 'Hopper' }),
    ]);
    expect(racing.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(racing.map((result) => result.record.id)).size).toBe(1);
  });

  it('records the module and the person it ran for in history', async () => {
    const ctx = moduleActorContext(workspaceId, 'crm-sync', 'u_member');
    const person = await engine.records.create(ctx, 'person', { first_name: 'Scoped' });
    expect(person.created_by).toBe('module:crm-sync@user:u_member');
  });
});
