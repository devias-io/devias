import { defineModule, type Job, type JobPage } from '@devias/core';
import { readEventsAfter, runRaw } from '@devias/data-engine';
import { manifest as crmManifest } from '@devias/mod-crm/manifest';
import { crm } from '@devias/mod-crm/server';
import { defineActionHandler, defineJobHandler, defineModuleServer, RetryableError } from '@devias/server';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createWorkspace, type Session, signUp } from './helpers';

/** What the outside feed answers next: items, or a failure. */
const feed: { items: { id: string; title: string }[]; failures: number; broken: boolean } = {
  items: [],
  failures: 0,
  broken: false,
};

/**
 * A module that mirrors an outside feed into its own object: an action asks for a pull, the `pull` job does it
 * (keeping its cursor in kv and upserting by the feed's id), an hourly schedule runs it too. Its role covers its own
 * object only.
 */
const feeds = defineModuleServer(
  defineModule({
    id: 'feeds',
    version: '0.1.0',
    name: 'Feeds',
    objects: [
      {
        id: 'feeds.item',
        nameSingular: 'item',
        namePlural: 'items',
        labelSingular: 'Item',
        labelPlural: 'Items',
        primaryField: 'feeds.item.title',
        fields: [
          { id: 'feeds.item.title', name: 'title', label: 'Title', type: 'text' },
          {
            id: 'feeds.item.external_id',
            name: 'external_id',
            label: 'Feed id',
            type: 'text',
            isUnique: true,
          },
        ],
      },
    ],
    actions: [{ id: 'feeds.pull_now', label: 'Pull the feed now', external: false, approval: 'auto' }],
    role: { permissions: [], objects: { 'feeds.item': ['read', 'write'] } },
  }),
  {
    actions: [
      defineActionHandler({
        id: 'feeds.pull_now',
        input: z.object({}),
        run: (_input, ctx) => ctx.jobs.enqueue('pull', { reason: 'asked' }, { retryLimit: 2 }),
      }),
    ],
    jobs: {
      pull: defineJobHandler({
        input: z.object({ reason: z.string() }).nullable(),
        run: async (_payload, ctx) => {
          if (feed.failures > 0) {
            feed.failures -= 1;

            throw new RetryableError('The feed is busy');
          }

          if (feed.broken) {
            throw new Error('The feed is broken');
          }

          const cursor = (await ctx.kv.get<number>('cursor')) ?? 0;
          let created = 0;

          for (const item of feed.items.slice(cursor)) {
            const { created: isNew } = await ctx.engine.records.upsert(
              'item',
              { external_id: item.id },
              { title: item.title },
            );

            if (isNew) {
              created += 1;
            }
          }

          await ctx.kv.set('cursor', feed.items.length);

          return { created, attempt: ctx.job.attempt };
        },
      }),
    },
    schedules: [{ name: 'hourly', cron: '0 * * * *', job: 'pull' }],
  },
);

describe('module jobs and schedules', () => {
  let server: Server;
  let alice: Session;
  let api: Api;
  let ws: { id: string };
  let base: string;

  beforeAll(async () => {
    server = await createServer(
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
        MIGRATE_ON_BOOT: 'true',
        LOG_LEVEL: 'error',
      }),
      { modules: [crm, feeds], builtin: [crmManifest], pgliteDataDir: 'memory://', modelClient: null },
    );
    alice = await signUp(server, 'alice@jobs.test', 'Alice');
    api = client(server, { cookie: alice.cookie });
    ws = await createWorkspace(api, 'Jobs', 'jobs');
    base = `/api/workspaces/${ws.id}`;
    expect((await api(`${base}/modules/apply`, { body: { manifest: feeds.manifest } })).status).toBe(200);
  });
  afterAll(() => server.close());

  const jobs = async (query = '') => ((await api(`${base}/jobs${query}`)).json as JobPage).items;
  /** Make every waiting job due now, as if its backoff had passed. */
  const dueNow = () => runRaw(server.engine.db, sql`UPDATE job SET run_at = now() WHERE status = 'pending'`);

  it('runs a job an action queued, retrying it with backoff, as the module for the person who asked', async () => {
    feed.items = [
      { id: 'f1', title: 'First' },
      { id: 'f2', title: 'Second' },
    ];
    feed.failures = 1;
    const queued = await api(`${base}/modules/feeds/actions/pull_now`, { body: {} });
    expect(queued.status).toBe(200);
    expect(queued.json).toMatchObject({ status: 'pending' });

    // The first attempt meets a busy feed: the job waits about 30 seconds before it is tried again.
    expect(await server.jobs.runOnce()).toBe(1);
    const [waiting] = await jobs('?module=feeds');
    expect(waiting).toMatchObject({ name: 'pull', status: 'pending', attempts: 1, lastError: 'The feed is busy' });
    const wait = Date.parse(waiting?.runAt ?? '') - Date.now();
    expect(wait).toBeGreaterThan(20_000);
    expect(wait).toBeLessThanOrEqual(31_000);
    expect(await server.jobs.runOnce()).toBe(0);

    await dueNow();
    expect(await server.jobs.runOnce()).toBe(1);
    const [done] = await jobs('?module=feeds');
    expect(done).toMatchObject({
      status: 'succeeded',
      attempts: 2,
      result: { created: 2, attempt: 2 },
      lastError: null,
    });
    const items = (await api(`${base}/records/item/list`, { body: {} })).json as {
      items: { title: string; external_id: string; created_by: string }[];
    };
    expect(items.items.map((item) => item.external_id).sort()).toEqual(['f1', 'f2']);
    expect(items.items[0]?.created_by).toBe(`module:feeds@user:${alice.userId}`);

    // The cursor kept in kv: the next pull only adds what is new, and updates by the feed's id.
    feed.items.push({ id: 'f3', title: 'Third' });
    await api(`${base}/modules/feeds/actions/pull_now`, { body: {} });
    await server.jobs.runOnce();
    expect((await jobs('?module=feeds'))[0]?.result).toMatchObject({ created: 1 });
  });

  it('fails a job that throws for good, and announces it', async () => {
    feed.broken = true;
    const before = await server.engine.events.currentSequence(ws.id);
    await api(`${base}/modules/feeds/actions/pull_now`, { body: {} });
    await server.jobs.runOnce();
    feed.broken = false;
    const [failed] = await jobs('?status=failed');
    expect(failed).toMatchObject({ name: 'pull', status: 'failed', attempts: 1 });
    expect(failed?.lastError).toMatch(/The feed is broken/);
    const events = await readEventsAfter(server.engine.db, ws.id, before, 50);
    expect(events.filter((event) => event.type === 'job.failed')).toEqual([
      expect.objectContaining({ moduleId: 'feeds', jobId: failed?.id, name: 'pull' }),
    ]);
    // An admin runs it again, and this time it works.
    const retried = await api(`${base}/jobs/${failed?.id}/retry`, { body: {} });
    expect(retried.json).toMatchObject({ status: 'pending', attempts: 0 });
    await server.jobs.runOnce();
    expect(((await api(`${base}/jobs/${failed?.id}`)).json as Job).status).toBe('succeeded');
  });

  it('runs scheduled jobs once per fire time, never for fire times before the install', async () => {
    const before = (await jobs('?module=feeds&limit=200')).length;
    // The last full hour may be before the install: nothing is owed for it.
    const installed = Date.parse(
      ((await api(`${base}/modules`)).json as { moduleId: string; installedAt: string }[]).find(
        (module) => module.moduleId === 'feeds',
      )?.installedAt ?? '',
    );
    const nextHour = new Date(Math.ceil((installed + 1) / 3_600_000) * 3_600_000);
    await server.jobs.tickSchedules(new Date(installed));
    expect((await jobs('?module=feeds&limit=200')).length).toBe(before);
    // Once the hour comes, one job; ticking again in the same hour adds none.
    await server.jobs.tickSchedules(new Date(nextHour.getTime() + 5_000));
    await server.jobs.tickSchedules(new Date(nextHour.getTime() + 25 * 60_000));
    const scheduled = (await jobs('?module=feeds&limit=200')).filter((job) => job.schedule === 'hourly');
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.idempotencyKey).toBe(`schedule:hourly:${nextHour.toISOString()}`);
    // A server that was down for three hours owes one run, not three.
    await server.jobs.tickSchedules(new Date(nextHour.getTime() + 3 * 3_600_000 + 60_000));
    expect((await jobs('?module=feeds&limit=200')).filter((job) => job.schedule === 'hourly')).toHaveLength(2);
  });

  it('upserts over HTTP, and runs a workflow again on what an earlier run was about', async () => {
    const upsert = (title: string) =>
      api(`${base}/records/item/upsert`, { body: { match: { external_id: 'f9' }, values: { title } } });
    const made = await upsert('Ninth');
    expect(made.json).toMatchObject({ created: true, record: { external_id: 'f9', title: 'Ninth' } });
    expect((await upsert('Ninth, renamed')).json).toMatchObject({
      created: false,
      record: { title: 'Ninth, renamed' },
    });
    expect((await api(`${base}/records/item/upsert`, { body: { match: { title: 'x' }, values: {} } })).status).toBe(
      400,
    );

    const record = (made.json as { record: { id: string } }).record;
    const workflow = (
      await api(`${base}/workflows`, {
        body: {
          title: 'Mark seen',
          trigger: { kind: 'manual', objectId: 'item' },
          steps: [
            {
              kind: 'action',
              actionId: 'core.update_record',
              input: { object: 'item', id: '{{record.id}}', values: { title: 'Seen' } },
            },
          ],
        },
      })
    ).json as { id: string };
    const first = (await api(`${base}/workflows/${workflow.id}/run`, { body: { recordId: record.id } })).json as {
      id: string;
    };
    const again = await api(`${base}/workflows/${workflow.id}/runs/${first.id}/retry`, { body: {} });
    expect(again.status).toBe(201);
    expect(again.json).toMatchObject({
      status: 'succeeded',
      trigger: { kind: 'manual', objectId: 'feeds.item', recordId: record.id, retryOf: first.id },
    });
    expect((await api(`${base}/workflows/${workflow.id}/runs/nope/retry`, { body: {} })).status).toBe(404);
  });
});
