import { createHash, randomBytes } from 'node:crypto';
import { createFakeModelClient, text, toolUse } from '@devias/ai/testing';
import { type ChatEvent, type Connection, type ConnectionList, defineModule, type JobPage } from '@devias/core';
import { readEventsAfter, runRaw } from '@devias/data-engine';
import { manifest as stripeManifest } from '@devias/mod-payment-stripe/manifest';
import { paymentStripe } from '@devias/mod-payment-stripe/server';
import {
  defineActionHandler,
  defineJobHandler,
  defineModuleServer,
  type ModuleContext,
  RetryableError,
} from '@devias/server';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createWorkspace, readChatEvents, type Session, signUp } from './helpers';

const CLIENT_ID = 'devias-test-client';
const CLIENT_SECRET = 'devias-test-secret';
const REDIRECT_URI = 'http://localhost:3000/api/oauth/callback/example-id/account';
const ID = 'https://id.example.test';

/**
 * An OAuth module like a Example ID or Microsoft one, declared here: each person connects their own account with the
 * server's OAuth client, an action says who is connected, and connecting starts a first sync in the background.
 */
const exampleIdManifest = defineModule({
  id: 'example-id',
  version: '0.1.0',
  name: 'Example ID',
  variables: [
    { key: 'CLIENT_ID', label: 'OAuth client id', server: true },
    { key: 'CLIENT_SECRET', label: 'OAuth client secret', server: true, secret: true },
  ],
  connections: [
    {
      id: 'example-id.account',
      kind: 'oauth2',
      label: 'Example ID account',
      visibility: 'user',
      oauth: {
        authorizeUrl: `${ID}/authorize`,
        tokenUrl: `${ID}/token`,
        scopes: ['openid', 'email', 'profile'],
        // A refresh token every time, so the connection outlives the hour an access token lasts.
        extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
        clientId: { variable: 'CLIENT_ID' },
        clientSecret: { variable: 'CLIENT_SECRET' },
      },
    },
  ],
  actions: [
    {
      id: 'example-id.whoami',
      label: 'Who is connected',
      output: [
        { name: 'email', description: 'The connected account.' },
        { name: 'name', description: "The account's name." },
      ],
      approval: 'auto',
    },
  ],
  role: { permissions: [] },
});

/** Whose the access token is: a refused token is reported, so the person reconnects; a failing service is retried. */
const userinfo = async (ctx: ModuleContext): Promise<{ email: string; name: string | null }> => {
  const { accessToken } = await ctx.connection();
  let response: Response;

  try {
    response = await ctx.fetch(`${ID}/userinfo`, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch (error) {
    throw new RetryableError(`Example ID could not be reached: ${error instanceof Error ? error.message : error}`);
  }

  if (response.status === 401) {
    ctx.reportAuthFailure('Example ID refused the access token');

    throw new Error('Example ID refused the access token');
  }

  if (response.status === 429 || response.status >= 500) {
    throw new RetryableError(`Example ID answered ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`Example ID answered ${response.status}`);
  }

  const body = (await response.json()) as { email: string; name?: string };

  return { email: body.email, name: body.name ?? null };
};

const exampleId = defineModuleServer(exampleIdManifest, {
  actions: [defineActionHandler({ id: 'example-id.whoami', input: z.object({}), run: (_input, ctx) => userinfo(ctx) })],
  connections: {
    account: {
      test: async (ctx) => {
        try {
          const user = await userinfo(ctx);

          return { ok: true, account: user.email, message: `Connected as ${user.email}` };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
      },
      onConnect: async (ctx) => {
        const { id } = await ctx.connection();
        await ctx.jobs.enqueue('sync', null, { connectionId: id });
      },
    },
  },
  jobs: {
    // A first sync: it learns the profile and keeps it.
    sync: defineJobHandler({
      run: async (_payload, ctx) => {
        const { id } = await ctx.connection();
        const user = await userinfo(ctx);
        await ctx.kv.set(`profile:${id}`, user);

        return { account: user.email };
      },
    }),
  },
});

/**
 * A small OAuth provider standing in for Example ID: consent hands out a code bound to its PKCE challenge, the token
 * endpoint checks the client, the code and the verifier, refreshes access tokens, and answers `invalid_grant` for a
 * revoked refresh token; userinfo says whose a token is.
 */
const createFakeProvider = () => {
  const codes = new Map<string, { challenge: string; redirectUri: string; email: string }>();
  const accessTokens = new Map<string, string>();
  const refreshTokens = new Map<string, string>();
  const state = {
    email: 'alice@gmail.test',
    accessLifetime: 3600,
    refreshes: 0,
    revoked: false,
    /** Userinfo answers this status instead (an API turned off in the Example ID project, say). */
    userinfoFailure: null as number | null,
  };
  const issue = (email: string) => {
    const access = `ya29.${randomBytes(6).toString('hex')}`;
    accessTokens.set(access, email);

    return access;
  };
  const app = new Hono();
  app.get('/authorize', (c) => {
    const query = c.req.query();

    if (query.client_id !== CLIENT_ID || query.code_challenge_method !== 'S256' || !query.code_challenge) {
      return c.text('bad request', 400);
    }

    const code = randomBytes(8).toString('hex');
    codes.set(code, { challenge: query.code_challenge, redirectUri: query.redirect_uri ?? '', email: state.email });
    const back = new URL(query.redirect_uri ?? '');
    back.searchParams.set('code', code);
    back.searchParams.set('state', query.state ?? '');

    return c.redirect(back.toString(), 302);
  });
  app.post('/token', async (c) => {
    const form = new URLSearchParams(await c.req.text());

    if (form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET) {
      return c.json({ error: 'invalid_client' }, 401);
    }

    if (form.get('grant_type') === 'authorization_code') {
      const grant = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');

      if (!grant || grant.challenge !== challenge || grant.redirectUri !== form.get('redirect_uri')) {
        return c.json({ error: 'invalid_grant', error_description: 'Bad code or verifier' }, 400);
      }

      const refresh = `1//${randomBytes(6).toString('hex')}`;
      refreshTokens.set(refresh, grant.email);

      return c.json({
        access_token: issue(grant.email),
        refresh_token: refresh,
        expires_in: state.accessLifetime,
        token_type: 'Bearer',
        scope: 'openid email profile',
      });
    }

    if (form.get('grant_type') === 'refresh_token') {
      const email = refreshTokens.get(form.get('refresh_token') ?? '');

      if (!email || state.revoked) {
        return c.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
      }

      state.refreshes += 1;
      // Slow enough that concurrent callers overlap.
      await new Promise((resolve) => setTimeout(resolve, 30));

      return c.json({ access_token: issue(email), expires_in: 3600, token_type: 'Bearer' });
    }

    return c.json({ error: 'unsupported_grant_type' }, 400);
  });
  app.get('/userinfo', (c) => {
    const token = (c.req.header('authorization') ?? '').replace(/^Bearer /, '');
    const email = accessTokens.get(token);

    if (email && state.userinfoFailure) {
      return c.json({ error: 'forbidden' }, state.userinfoFailure as 403);
    }

    return email ? c.json({ email, name: 'Alice' }) : c.json({ error: 'invalid_token' }, 401);
  });
  /** The provider's URLs, routed to this app; anything else goes to `rest`. */
  const fetch = (rest?: (url: string, init?: RequestInit) => Promise<Response>) =>
    (async (url: string, init?: RequestInit) => {
      if (url.startsWith(`${ID}/token`)) {
        return app.request('/token', init);
      }

      if (url.startsWith(`${ID}/userinfo`)) {
        return app.request('/userinfo', init);
      }

      if (rest) {
        return rest(url, init);
      }

      return new Response('{}', { status: 500 });
    }) as never;

  return { app, state, fetch };
};

const env = {
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
  MIGRATE_ON_BOOT: 'true',
  LOG_LEVEL: 'error',
};

/** The person's browser: open the consent page (the fake provider agrees at once), then follow it back. */
const consent = async (
  server: Server,
  provider: ReturnType<typeof createFakeProvider>,
  url: string,
  cookie: string,
) => {
  const authorize = new URL(url);
  const agreed = await provider.app.request(`/authorize${authorize.search}`);
  expect(agreed.status).toBe(302);
  const back = new URL(agreed.headers.get('location') ?? '');

  return server.app.request(`${back.pathname}${back.search}`, { headers: { cookie } });
};

/** Stripe's answers for the acceptance test below, swapped in once the test knows the key. */
const stripeFetch: { current: ((url: string, init?: RequestInit) => Promise<Response>) | null } = { current: null };

describe('connecting accounts with OAuth', () => {
  const provider = createFakeProvider();
  const model = createFakeModelClient([], { delayMs: 0 });
  let server: Server;
  let alice: Session;
  let bob: Session;
  let api: Api;
  let ws: { id: string; slug: string };
  let base: string;

  beforeAll(async () => {
    server = await createServer(
      loadConfig({
        ...env,
        DEVIAS_MOD_EXAMPLE_ID_CLIENT_ID: CLIENT_ID,
        DEVIAS_MOD_EXAMPLE_ID_CLIENT_SECRET: CLIENT_SECRET,
      }),
      {
        modules: [exampleId, paymentStripe],
        builtin: [exampleIdManifest],
        pgliteDataDir: 'memory://',
        modelClient: model,
        moduleFetch: provider.fetch((url, init) =>
          stripeFetch.current ? stripeFetch.current(url, init) : Promise.resolve(new Response('{}', { status: 500 })),
        ),
      },
    );
    alice = await signUp(server, 'alice@acme.test', 'Alice');
    bob = await signUp(server, 'bob@acme.test', 'Bob');
    api = client(server, { cookie: alice.cookie });
    ws = await createWorkspace(api, 'Acme', 'acme-oauth');
    base = `/api/workspaces/${ws.id}`;
  });
  afterAll(() => server.close());

  const authorize = async (body: Record<string, unknown> = { module: 'example-id' }) => {
    const response = await api(`${base}/connections/authorize`, { body });
    expect(response.status).toBe(200);

    return (response.json as { url: string }).url;
  };
  const accountConnections = async () =>
    ((await api(`${base}/connections?module=example-id`)).json as ConnectionList).connections;

  it('sends the person to the consent page with PKCE, and back to where they started once connected', async () => {
    expect(((await api(`${base}/connections?module=example-id`)).json as ConnectionList).providers).toEqual([
      expect.objectContaining({ providerId: 'account', kind: 'oauth2', visibility: 'user', available: true }),
    ]);
    const url = new URL(
      await authorize({ module: 'example-id', returnTo: '/workspaces/acme-oauth/settings/integrations' }),
    );
    expect(url.origin + url.pathname).toBe(`${ID}/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid email profile',
      code_challenge_method: 'S256',
      access_type: 'offline',
    });
    expect(url.searchParams.get('code_challenge')).toBeTruthy();

    const done = await consent(server, provider, url.toString(), alice.cookie);
    expect(done.status).toBe(302);
    expect(done.headers.get('location')).toBe(
      'http://localhost:5173/workspaces/acme-oauth/settings/integrations?oauth=connected&module=example-id',
    );
    const [connection] = await accountConnections();
    expect(connection).toMatchObject({
      kind: 'oauth2',
      visibility: 'user',
      ownerUserId: alice.userId,
      account: 'alice@gmail.test',
      status: 'connected',
      scopes: ['openid', 'email', 'profile'],
    });
    // The tokens are sealed: nothing of them comes back.
    expect(JSON.stringify(connection)).not.toMatch(/ya29|1\/\//);

    // The action runs with Alice's own account.
    const whoami = await api(`${base}/modules/example-id/actions/whoami`, { body: {} });
    expect(whoami.json).toEqual({ email: 'alice@gmail.test', name: 'Alice' });
  });

  it('refuses a used, expired or someone else’s consent', async () => {
    // Used: the state is good once.
    const url = await authorize();
    const authorizeUrl = new URL(url);
    const agreed = await provider.app.request(`/authorize${authorizeUrl.search}`);
    const back = new URL(agreed.headers.get('location') ?? '');
    const callback = `${back.pathname}${back.search}`;
    // Someone else's session cannot finish it, and that spends it.
    const stranger = await server.app.request(callback, { headers: { cookie: bob.cookie } });
    expect(stranger.status).toBe(200);
    expect(await stranger.text()).toContain('Sign in as the person who started connecting');
    const again = await server.app.request(callback, { headers: { cookie: alice.cookie } });
    expect(await again.text()).toContain('expired or was already used');

    // Expired: ten minutes, then the state is gone.
    const late = await authorize();
    await runRaw(server.engine.db, sql`UPDATE oauth_state SET expires_at = now() - interval '1 minute'`);
    const expired = await consent(server, provider, late, alice.cookie);
    expect(await expired.text()).toContain('expired or was already used');

    // A return path that would leave the studio is dropped: the consent ends on the server's own page.
    for (const returnTo of ['//evil.test/x', '/\\evil.test/x', 'https://evil.test/x']) {
      const away = await consent(server, provider, await authorize({ module: 'example-id', returnTo }), alice.cookie);
      expect(away.status).toBe(200);
      expect(await away.text()).toContain('Example ID is connected');
    }

    // A consent the person refused at the provider.
    const refused = await authorize();
    const state = new URL(refused).searchParams.get('state');
    const denied = await server.app.request(
      `/api/oauth/callback/example-id/account?state=${state}&error=access_denied`,
      {
        headers: { cookie: alice.cookie },
      },
    );
    expect(await denied.text()).toContain('access_denied');
  });

  it('refreshes an expiring token once for concurrent runs, and asks to reconnect when the grant is revoked', async () => {
    const [connection] = await accountConnections();

    if (!connection) {
      throw new Error('Alice is connected');
    }

    // The access token is about to run out: two runs at once refresh it once.
    await runRaw(server.engine.db, sql`UPDATE module_connection SET expires_at = now() + interval '20 seconds'`);
    const before = provider.state.refreshes;
    const runs = await Promise.all([
      api(`${base}/modules/example-id/actions/whoami`, { body: {} }),
      api(`${base}/modules/example-id/actions/whoami`, { body: {} }),
    ]);
    expect(runs.map((run) => run.status)).toEqual([200, 200]);
    expect(provider.state.refreshes - before).toBe(1);
    expect(Date.parse((await accountConnections())[0]?.expiresAt ?? '')).toBeGreaterThan(Date.now() + 3000_000);

    // The person revoked access at Example ID: the next refresh fails, and the connection asks to be made again.
    provider.state.revoked = true;
    await runRaw(server.engine.db, sql`UPDATE module_connection SET expires_at = now()`);
    const failed = await api(`${base}/modules/example-id/actions/whoami`, { body: {} });
    expect(failed.status).toBe(400);
    expect((failed.json as { error: { message: string } }).error.message).toMatch(/connect it again/);
    expect((await accountConnections())[0]).toMatchObject({
      status: 'auth_failed',
      lastError: expect.stringMatching(/invalid_grant/),
    });
    const feed = await readEventsAfter(server.engine.db, ws.id, 0, 500);
    expect(feed.map((event) => event.type)).toContain('module.connection.failed');

    // Connecting again fixes it.
    provider.state.revoked = false;
    await consent(server, provider, await authorize(), alice.cookie);
    expect((await accountConnections()).map((c) => [c.account, c.status])).toEqual([['alice@gmail.test', 'connected']]);
  });

  it('acceptance: "Connect my Example ID account" shows a link card, and says who was connected', async () => {
    // Bob has no Example ID account connected yet.
    const bobApi = client(server, { cookie: bob.cookie });
    await api('/api/auth/organization/invite-member', {
      body: { email: bob.email, role: 'member', organizationId: ws.id },
      headers: { origin: 'http://localhost:5173' },
    }).then(async (invited) =>
      bobApi('/api/auth/organization/accept-invitation', {
        body: { invitationId: (invited.json as { id: string }).id },
        headers: { origin: 'http://localhost:5173' },
      }),
    );
    provider.state.email = 'bob@gmail.test';
    model.push(
      { content: [toolUse('connect_module', { module: 'example-id' }, 'tu_connect')] },
      { content: [text('Connected as bob@gmail.test.')] },
    );
    const ai = `${base}/ai`;
    const conversation = (await bobApi(`${ai}/conversations`, { body: {} })).json as { id: string };
    const started = await readChatEvents(
      await server.app.request(`${ai}/conversations/${conversation.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: bob.cookie },
        body: JSON.stringify({ content: 'Connect my Example ID account' }),
      }),
    );
    const pause = started.find((event) => event.type === 'paused');
    const call = pause?.type === 'paused' ? pause.pending[0] : undefined;
    // The card is a link to the consent page, not a form: no values for anyone to type, and no URL for the model.
    expect(call).toMatchObject({
      name: 'connect_module',
      requiresApproval: true,
      inputRequest: {
        title: 'Connect your Example ID account',
        fields: [],
        connect: { module: 'example-id', provider: 'account', visibility: 'user', label: 'Example ID account' },
      },
    });

    // What the card does: start the consent as Bob, let him agree, and approve the call once he is back.
    const url = (
      (await bobApi(`${base}/connections/authorize`, { body: { module: 'example-id' } })).json as { url: string }
    ).url;
    const finished = await consent(server, provider, url, bob.cookie);
    expect(finished.status).toBe(200);
    expect(await finished.text()).toContain('Example ID is connected as bob@gmail.test');
    const resolved = await readChatEvents(
      await server.app.request(`${ai}/conversations/${conversation.id}/tool-calls/${call?.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: bob.cookie },
        body: JSON.stringify({ approved: true }),
      }),
    );
    const result = resolved.find((event) => event.type === 'tool_result');
    expect(result).toMatchObject({
      status: 'executed',
      result: {
        module: 'example-id',
        connected: true,
        account: 'bob@gmail.test',
        belongsTo: 'you',
        status: 'connected',
      },
    });
    expect(resolved.at(-1)).toMatchObject({ type: 'done', status: 'completed' });
    // Nothing of the consent reached the model.
    expect(JSON.stringify(model.requests)).not.toMatch(/id\.example\.test|code_challenge|ya29/);
    // Bob's account is his: Alice does not see it.
    expect((await accountConnections()).map((c) => c.account)).toEqual(['alice@gmail.test']);
  });

  it('acceptance: "Why didn\'t the Example ID sync run?" finds the failed job, explains it and retries it after approval', async () => {
    // Connecting starts a first sync; those queued so far run while Example ID answers.
    await server.jobs.runOnce();
    await server.jobs.runOnce();
    expect(((await api(`${base}/jobs?module=example-id&status=failed`)).json as JobPage).items).toEqual([]);
    // Alice reconnects; by the time her first sync runs, Example ID refuses the profile request, and it fails for good.
    provider.state.email = 'alice@gmail.test';
    await consent(server, provider, await authorize(), alice.cookie);
    provider.state.userinfoFailure = 403;
    await server.jobs.runOnce();
    await server.jobs.runOnce();
    const [failed] = ((await api(`${base}/jobs?module=example-id&status=failed`)).json as JobPage).items;
    expect(failed).toMatchObject({ name: 'sync', status: 'failed', lastError: 'Example ID answered 403' });
    // Whoever runs the Example ID project turns the API back on.
    provider.state.userinfoFailure = null;

    model.push(
      { content: [toolUse('list_jobs', { module: 'example-id', status: 'failed' }, 'tu_jobs')] },
      { content: [toolUse('retry_job', { id: failed?.id }, 'tu_retry')] },
      { content: [text('Example ID refused the sync (403). I ran it again.')] },
    );
    const ai = `${base}/ai`;
    const conversation = (await api(`${ai}/conversations`, { body: {} })).json as { id: string };
    const asked = await readChatEvents(
      await server.app.request(`${ai}/conversations/${conversation.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ content: "Why didn't the Example ID sync run yesterday?" }),
      }),
    );
    // Listing runs without asking; what Example ID answered reaches the model as data, not instructions.
    const listed = asked.find(
      (event): event is Extract<ChatEvent, { type: 'tool_result' }> => event.type === 'tool_result',
    );
    expect(listed).toMatchObject({
      status: 'executed',
      result: {
        untrusted: expect.any(String),
        content: { items: [expect.objectContaining({ id: failed?.id, lastError: 'Example ID answered 403' })] },
      },
    });
    // Retrying asks first.
    const pause = asked.find((event) => event.type === 'paused');
    const retry = pause?.type === 'paused' ? pause.pending[0] : undefined;
    expect(retry).toMatchObject({ name: 'retry_job', requiresApproval: true, input: { id: failed?.id } });
    const resolved = await readChatEvents(
      await server.app.request(`${ai}/conversations/${conversation.id}/tool-calls/${retry?.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ approved: true }),
      }),
    );
    expect(resolved.find((event) => event.type === 'tool_result')).toMatchObject({
      status: 'executed',
      result: { id: failed?.id, status: 'pending' },
    });
    expect(resolved.at(-1)).toMatchObject({ type: 'done', status: 'completed' });
    await server.jobs.runOnce();
    expect((await api(`${base}/jobs/${failed?.id}`)).json).toMatchObject({
      status: 'succeeded',
      result: { account: 'alice@gmail.test' },
    });
  });

  it('acceptance: "Stripe stopped working" tests the connection, explains it and offers a secure card', async () => {
    await api(`${base}/modules/apply`, { body: { manifest: stripeManifest } });
    // Stripe accepted the key once, then it was rolled.
    let goodKey = 'sk_test_original_1234';
    stripeFetch.current = async (_url, init) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? '';

      return auth === `Bearer ${goodKey}`
        ? Response.json({ livemode: false })
        : Response.json({ error: { message: 'Invalid API Key provided' } }, { status: 401 });
    };
    const made = (
      await api(`${base}/connections`, { body: { module: 'payment-stripe', values: { secret_key: goodKey } } })
    ).json as Connection;
    expect(made.status).toBe('connected');
    goodKey = 'sk_test_rolled_5678';

    model.push(
      { content: [toolUse('test_connection', { id: made.id }, 'tu_test')] },
      { content: [toolUse('connect_module', { module: 'payment-stripe', connectionId: made.id }, 'tu_replace')] },
      { content: [text('Stripe works again.')] },
    );
    const ai = `${base}/ai`;
    const conversation = (await api(`${ai}/conversations`, { body: {} })).json as { id: string };
    const events = await readChatEvents(
      await server.app.request(`${ai}/conversations/${conversation.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ content: 'Stripe stopped working' }),
      }),
    );
    const tested = events.find(
      (event): event is Extract<ChatEvent, { type: 'tool_result' }> => event.type === 'tool_result',
    );
    expect(tested?.result).toMatchObject({ ok: false, message: 'Stripe rejected the secret key' });
    const pause = events.find((event) => event.type === 'paused');
    const card = pause?.type === 'paused' ? pause.pending[0] : undefined;
    expect(card).toMatchObject({
      name: 'connect_module',
      inputRequest: {
        title: 'Connect Stripe',
        fields: [
          // What is saved can be kept, so the card asks for nothing it already has.
          expect.objectContaining({ name: 'secret_key', required: false }),
          expect.objectContaining({ name: 'webhook_secret', required: false }),
        ],
      },
    });
    const resolved = await readChatEvents(
      await server.app.request(`${ai}/conversations/${conversation.id}/tool-calls/${card?.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ approved: true, values: { secret_key: goodKey } }),
      }),
    );
    expect(resolved.find((event) => event.type === 'tool_result')).toMatchObject({
      status: 'executed',
      result: { module: 'payment-stripe', status: 'connected', saved: ['secret_key'] },
    });
    // The new key went to Stripe and nowhere else.
    const calls = await server.ai.store.toolCalls.list(conversation.id);
    expect(JSON.stringify([model.requests, calls])).not.toContain(goodKey);
  });
});

describe('OAuth providers on a server without their client', () => {
  let server: Server;
  let api: Api;
  let base: string;

  beforeAll(async () => {
    server = await createServer(loadConfig(env), {
      modules: [exampleId],
      builtin: [exampleIdManifest],
      pgliteDataDir: 'memory://',
      modelClient: null,
    });
    const owner = await signUp(server, 'owner@noclient.test');
    api = client(server, { cookie: owner.cookie });
    const ws = await createWorkspace(api, 'Bare', 'bare-oauth');
    base = `/api/workspaces/${ws.id}`;
  });
  afterAll(() => server.close());

  it('says it is not configured on this server, and refuses to start a consent', async () => {
    expect(((await api(`${base}/connections`)).json as ConnectionList).providers).toEqual([
      expect.objectContaining({
        moduleId: 'example-id',
        available: false,
        problem:
          'Not configured on this server: set DEVIAS_MOD_EXAMPLE_ID_CLIENT_ID and DEVIAS_MOD_EXAMPLE_ID_CLIENT_SECRET',
      }),
    ]);
    const refused = await api(`${base}/connections/authorize`, { body: { module: 'example-id' } });
    expect(refused.status).toBe(400);
    expect((refused.json as { error: { message: string } }).error.message).toMatch(/Not configured on this server/);
  });
});
