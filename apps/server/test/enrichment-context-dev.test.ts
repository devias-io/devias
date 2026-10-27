import { manifest as crmManifest } from '@devias/mod-crm/manifest';
import crm from '@devias/mod-crm/server';
import { ids as enrichIds } from '@devias/mod-enrichment-context-dev/manifest';
import enrichment from '@devias/mod-enrichment-context-dev/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createWorkspace, signUp } from './helpers';

/** Answers like Context.dev would: a 400 for a request with nothing in it, and a good match for anyone else. */
const contextFetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  if (!url.endsWith('/v1/people/enrich')) {
    return json({}, 500);
  }

  const body = JSON.parse(String(init?.body ?? '{}')) as { email?: string };

  if (!body.email) {
    return json({ message: 'Not enough to go on' }, 400);
  }

  return json({
    match: {
      status: 'candidate',
      score: 92,
      person: {
        location: { city: 'London', country: 'United Kingdom' },
        social_urls: ['https://www.linkedin.com/in/ada-lovelace'],
        current_role: { title: 'CTO', organization: { name: 'Acme', domain: 'acme.com' }, is_current: true },
        current_role_status: 'present',
      },
    },
  });
});

/** Context.dev fills in what a CRM person is missing, from a workflow run by hand or on every new person. */
describe('Enrichment with Context.dev', () => {
  let server: Server;
  let api: Api;
  let base: string;
  let workspaceId: string;

  beforeAll(async () => {
    server = await createServer(
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
        MIGRATE_ON_BOOT: 'true',
        LOG_LEVEL: 'error',
      }),
      { modules: [crm, enrichment], builtin: [crmManifest], moduleFetch: contextFetch, pgliteDataDir: 'memory://' },
    );
    api = client(server, { cookie: (await signUp(server, 'owner@enrich.test')).cookie });
    workspaceId = (await createWorkspace(api, 'Acme', 'acme-enrich')).id;
    base = `/api/workspaces/${workspaceId}`;
    const catalog = (await api(`${base}/modules/catalog`)).json as { id: string }[];
    const manifest = catalog.find((entry) => entry.id === enrichIds.module);
    expect((await api(`${base}/modules/apply`, { body: { manifest } })).status).toBe(200);
    const connection = await api(`${base}/connections`, {
      body: { module: enrichIds.module, values: { api_key: 'ctx_test_key' } },
    });
    expect(connection.json).toMatchObject({ status: 'connected' });
  });
  afterAll(() => server.close());

  const workflows = async () =>
    (await api(`${base}/workflows`)).json as { id: string; title: string; enabled: boolean; moduleId?: string }[];
  const person = async (id: string) => (await api(`${base}/records/person/${id}`)).json as Record<string, unknown>;
  const addPerson = async (extra: Record<string, unknown>) =>
    (await api(`${base}/records/person`, { body: { first_name: 'Ada', last_name: 'Lovelace', ...extra } })).json as {
      id: string;
    };

  it('comes with a workflow to run by hand and one for new people, which starts off', async () => {
    const mine = (await workflows()).filter((workflow) => workflow.moduleId === enrichIds.module);
    expect(mine.map((workflow) => [workflow.title, workflow.enabled]).sort()).toEqual([
      ['Enrich new people', false],
      ['Enrich this person', true],
    ]);
  });

  it('fills in what a person is missing when the workflow is run on them, and not twice', async () => {
    const company = (await api(`${base}/records/company`, { body: { name: 'Acme', domain: 'acme.com' } })).json as {
      id: string;
    };
    const ada = await addPerson({ email: 'ada@acme.com', city: 'Paris' });
    const manual = (await workflows()).find((workflow) => workflow.title === 'Enrich this person');

    const ran = await api(`${base}/workflows/${manual?.id}/run`, { body: { recordId: ada.id } });
    expect(ran.status).toBe(201);
    expect(ran.json).toMatchObject({
      status: 'succeeded',
      steps: [{ status: 'succeeded', output: { enriched: true, score: 92 } }],
    });
    // What was empty is filled in; the city the CRM had is kept.
    expect(await person(ada.id)).toMatchObject({
      job_title: 'CTO',
      city: 'Paris',
      country: 'United Kingdom',
      linkedin: 'https://www.linkedin.com/in/ada-lovelace',
      company: company.id,
    });
    const calls = contextFetch.mock.calls.length;
    expect((await api(`${base}/workflows/${manual?.id}/run`, { body: { recordId: ada.id } })).json).toMatchObject({
      steps: [{ output: { enriched: false, reason: 'Looked up recently' } }],
    });
    expect(contextFetch.mock.calls.length).toBe(calls);
  });

  it('looks every new person up once the workspace switches that on, and not before', async () => {
    const automatic = (await workflows()).find((workflow) => workflow.title === 'Enrich new people');
    const calls = () => contextFetch.mock.calls.length;
    await server.workflows.runOnce(workspaceId);
    const before = calls();
    const early = await addPerson({ first_name: 'Grace', last_name: 'Hopper', email: 'grace@acme.com' });
    await server.workflows.runOnce(workspaceId);
    expect(calls()).toBe(before);
    expect(await person(early.id)).toMatchObject({ job_title: null });

    // The module's text is not the workspace's to change, but the switch is.
    expect((await api(`${base}/workflows/${automatic?.id}`, { method: 'PATCH', body: { enabled: true } })).status).toBe(
      200,
    );
    await server.workflows.runOnce(workspaceId);
    const later = await addPerson({ first_name: 'Alan', last_name: 'Turing', email: 'alan@acme.com' });
    await server.workflows.runOnce(workspaceId);
    expect(await person(later.id)).toMatchObject({ job_title: 'CTO', country: 'United Kingdom' });
    // Someone added while it was off stays as they were.
    expect(await person(early.id)).toMatchObject({ job_title: null });
  });
});
