#!/usr/bin/env node
/**
 * End-to-end API smoke test against a running server (default http://localhost:3000).
 *   node scripts/smoke-api.mjs [baseUrl]
 * Signs up a fresh user, creates a workspace, verifies the seeded CRM metadata, writes and
 * queries records, exercises an API key, and reads the SSE change feed. Exits non-zero on failure.
 */
const base = (process.argv[2] ?? process.env.DEVIAS_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const stamp = Date.now().toString(36);
const email = `smoke-${stamp}@example.com`;
const password = 'password123!';
let cookie = '';
const ORIGIN = process.env.DEVIAS_ORIGIN ?? 'http://localhost:5173';

const step = (name) => process.stdout.write(`\n▸ ${name} `);
const ok = (msg = 'ok') => process.stdout.write(`… ${msg}`);
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

const call = async (method, path, body, extraHeaders = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    const jar = new Map(
      cookie
        .split('; ')
        .filter(Boolean)
        .map((c) => c.split('=')),
    );
    for (const c of setCookie) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      jar.set(k, v.join('='));
    }
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
};

const expect = (cond, msg) => (cond ? ok() : fail(msg));

step('health');
{
  const r = await call('GET', '/api/health');
  expect(r.status === 200 && r.json?.ok === true, `health failed: ${r.status} ${JSON.stringify(r.json)}`);
  ok(`db=${r.json.db}`);
}

step('sign up');
{
  const r = await call('POST', '/api/auth/sign-up/email', { name: 'Smoke Tester', email, password });
  expect(r.status === 200 && cookie.length > 0, `sign-up failed: ${r.status} ${JSON.stringify(r.json)}`);
}

step('me');
{
  const r = await call('GET', '/api/me');
  expect(r.status === 200 && r.json?.user?.email === email, `me failed: ${r.status} ${JSON.stringify(r.json)}`);
}

step('create workspace');
let ws;
{
  const r = await call('POST', '/api/workspaces', { name: `Smoke ${stamp}`, slug: `smoke-${stamp}` });
  expect(r.status === 200 || r.status === 201, `create workspace failed: ${r.status} ${JSON.stringify(r.json)}`);
  ws = r.json.id;
  ok(ws);
}

step('metadata seeded by crm');
{
  const r = await call('GET', `/api/workspaces/${ws}/metadata`);
  expect(r.status === 200, `metadata failed: ${r.status}`);
  const names = r.json.objects.map((o) => o.nameSingular).sort();
  expect(
    ['company', 'note', 'opportunity', 'person', 'task'].every((n) => names.includes(n)),
    `expected seeded objects, got ${names.join(',')}`,
  );
  expect(
    r.json.modules.some((e) => e.moduleId === 'crm'),
    'crm not listed as installed',
  );
  ok(`${r.json.objects.length} objects, ${r.json.fields.length} fields, ${r.json.views.length} views`);
}

step('create records');
let companyId;
let personId;
{
  const c = await call('POST', `/api/workspaces/${ws}/records/company`, {
    name: `Acme ${stamp}`,
    industry: 'software',
    employees: 42,
  });
  expect(c.status === 201 || c.status === 200, `create company failed: ${c.status} ${JSON.stringify(c.json)}`);
  companyId = c.json.id;
  const p = await call('POST', `/api/workspaces/${ws}/records/person`, {
    firstName: 'Jane',
    lastName: 'Doe',
    email: `Jane.${stamp}@Example.com`,
    company: companyId,
  });
  expect(p.status === 201 || p.status === 200, `create person failed: ${p.status} ${JSON.stringify(p.json)}`);
  personId = p.json.id;
  expect(p.json.email === `jane.${stamp}@example.com`, `email not normalized: ${p.json.email}`);
  const dup = await call('POST', `/api/workspaces/${ws}/records/person`, {
    firstName: 'Dup',
    email: `JANE.${stamp}@example.com`,
  });
  expect(dup.status === 409, `duplicate email should be 409, got ${dup.status}`);
  const bad = await call('POST', `/api/workspaces/${ws}/records/person`, { lastName: 'NoFirst' });
  expect(bad.status === 400, `missing required field should be 400, got ${bad.status}`);
}

step('query with filter, sort, include');
{
  const r = await call('POST', `/api/workspaces/${ws}/records/person/query`, {
    object: 'person',
    filter: {
      and: [
        { field: 'company', op: 'eq', value: companyId },
        { field: 'firstName', op: 'startsWith', value: 'ja' },
      ],
    },
    sort: [{ field: 'lastName', direction: 'asc' }],
    include: { company: true },
    limit: 10,
    count: true,
  });
  expect(r.status === 200 && r.json.items.length === 1, `query failed: ${r.status} ${JSON.stringify(r.json)}`);
  expect(r.json.included?.company?.[0]?.id === companyId, 'include did not return the company');
  expect(r.json.totalCount === 1, `totalCount expected 1, got ${r.json.totalCount}`);
}

step('update + get');
{
  const u = await call('PATCH', `/api/workspaces/${ws}/records/person/${personId}`, { jobTitle: 'CTO' });
  expect(u.status === 200 && u.json.jobTitle === 'CTO', `update failed: ${u.status}`);
  const g = await call('GET', `/api/workspaces/${ws}/records/person/${personId}`);
  expect(g.status === 200 && g.json.jobTitle === 'CTO' && g.json.updatedAt >= g.json.createdAt, 'get failed');
}

step('search');
{
  const r = await call('POST', `/api/workspaces/${ws}/search`, { text: 'jane' });
  expect(r.status === 200 && r.json.some((h) => h.recordId === personId), `search failed: ${JSON.stringify(r.json)}`);
}

step('events backlog');
{
  const res = await fetch(`${base}/api/workspaces/${ws}/events?after=0`, {
    headers: { cookie, origin: ORIGIN, accept: 'text/event-stream' },
  });
  expect(res.status === 200, `events status ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + 5000;
  let sawCreated = false;
  while (Date.now() < deadline && !sawCreated) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise((r) => setTimeout(() => r({ done: true }), 1500)),
    ]);
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    sawCreated = buffer.includes('event: record.created');
  }
  await reader.cancel().catch(() => {});
  expect(sawCreated, `no record.created event in backlog:\n${buffer.slice(0, 500)}`);
}

step('api key');
{
  const k = await call('POST', `/api/workspaces/${ws}/api-keys`, {
    name: 'smoke',
    permissions: { record: ['read', 'write'] },
  });
  expect(
    (k.status === 200 || k.status === 201) && typeof k.json.key === 'string',
    `api key create failed: ${k.status} ${JSON.stringify(k.json)}`,
  );
  const saved = cookie;
  cookie = '';
  const q = await call(
    'POST',
    `/api/workspaces/${ws}/records/company/query`,
    { object: 'company', limit: 5 },
    { 'x-api-key': k.json.key },
  );
  cookie = saved;
  expect(q.status === 200 && q.json.items.length >= 1, `api key query failed: ${q.status} ${JSON.stringify(q.json)}`);
}

step('module plan is a noop after seeding');
{
  const { manifest } = await import('../modules/crm/src/manifest.ts').catch(() => ({ manifest: null }));
  if (!manifest) {
    ok('skipped (run with tsx to load the manifest)');
  } else {
    const r = await call('POST', `/api/workspaces/${ws}/modules/plan`, { manifest });
    expect(
      r.status === 200 && r.json.changes.every((c) => c.action === 'noop'),
      `plan not noop: ${JSON.stringify(r.json?.changes?.filter((c) => c.action !== 'noop')?.slice(0, 3))}`,
    );
  }
}

step('workflows: manual run updates the record, runs are listed');
{
  const w = await call('POST', `/api/workspaces/${ws}/workflows`, {
    name: 'Smoke: mark as software',
    trigger: { kind: 'manual', objectId: 'company' },
    steps: [
      {
        kind: 'action',
        actionId: 'core.update_record',
        input: {
          object: 'company',
          id: '{{record.id}}',
          values: { industry: 'software', city: 'Smoke {{record.name}}' },
        },
      },
    ],
  });
  expect(w.status === 201, `create workflow failed: ${w.status} ${JSON.stringify(w.json)}`);
  const run = await call('POST', `/api/workspaces/${ws}/workflows/${w.json.id}/run`, { recordId: companyId });
  expect(
    run.status === 201 && run.json.status === 'succeeded',
    `workflow run failed: ${run.status} ${JSON.stringify(run.json)}`,
  );
  const company = await call('GET', `/api/workspaces/${ws}/records/company/${companyId}`);
  expect(company.json.city === `Smoke Acme ${stamp}`, `workflow did not update the record: ${company.json.city}`);
  const runs = await call('GET', `/api/workspaces/${ws}/workflows/${w.json.id}/runs`);
  expect(runs.status === 200 && runs.json.items.length === 1, `runs not listed: ${JSON.stringify(runs.json)}`);
  const bad = await call('POST', `/api/workspaces/${ws}/workflows`, {
    name: 'Broken',
    trigger: { kind: 'manual', objectId: 'ghost' },
    steps: [
      {
        kind: 'action',
        actionId: 'core.update_record',
        input: { object: 'company', id: '{{record.id}}', values: {} },
      },
    ],
  });
  expect(bad.status === 400, `invalid workflow should be 400, got ${bad.status}`);
  const d = await call('DELETE', `/api/workspaces/${ws}/workflows/${w.json.id}`);
  expect(d.status === 204, `delete workflow failed: ${d.status}`);
}

step('agents: owners shape them, conversations pick them, deleting archives');
{
  const bad = await call('POST', `/api/workspaces/${ws}/ai/agents`, { name: 'Sales', tools: ['query_records', 'fly'] });
  expect(bad.status === 400, `agent with an unknown tool should fail: ${bad.status} ${JSON.stringify(bad.json)}`);
  const created = await call('POST', `/api/workspaces/${ws}/ai/agents`, {
    name: 'Sales',
    description: 'Pipeline only',
    instructions: 'Talk about opportunities.',
    tools: ['query_records', 'search_records'],
    starterPrompts: ['see my open deals'],
  });
  expect(created.status === 201 && created.json.tools.length === 2, `agent create failed: ${created.status}`);
  const listed = await call('GET', `/api/workspaces/${ws}/ai/agents`);
  expect(listed.status === 200 && listed.json.some((a) => a.id === created.json.id), 'agent not listed');
  expect(
    listed.json.some((a) => a.tools === null && a.archivedAt === null),
    'the workspace has no general agent',
  );
  const conversation = await call('POST', `/api/workspaces/${ws}/ai/conversations`, { agentId: created.json.id });
  expect(conversation.status === 201 && conversation.json.agentId === created.json.id, 'conversation lacks agent');
  const renamed = await call('PATCH', `/api/workspaces/${ws}/ai/agents/${created.json.id}`, { name: 'Pipeline' });
  expect(renamed.status === 200 && renamed.json.name === 'Pipeline', `agent rename failed: ${renamed.status}`);
  const removed = await call('DELETE', `/api/workspaces/${ws}/ai/agents/${created.json.id}`);
  expect(removed.status === 204, `agent delete failed: ${removed.status}`);
  const thread = await call('GET', `/api/workspaces/${ws}/ai/conversations/${conversation.json.id}`);
  expect(
    thread.status === 200 && thread.json.conversation.agentId === created.json.id,
    'an archived agent lost its conversation',
  );
  const after = await call('GET', `/api/workspaces/${ws}/ai/agents`);
  expect(!after.json.some((a) => a.id === created.json.id), 'an archived agent is still listed');
  const refused = await call('POST', `/api/workspaces/${ws}/ai/conversations`, { agentId: created.json.id });
  expect(refused.status === 409, `a conversation with an archived agent should be refused: ${refused.status}`);
}

step('delete');
{
  const d = await call('DELETE', `/api/workspaces/${ws}/records/person/${personId}`);
  expect(d.status === 204, `delete failed: ${d.status}`);
  const g = await call('GET', `/api/workspaces/${ws}/records/person/${personId}`);
  expect(g.status === 404, `deleted record should be 404, got ${g.status}`);
}

console.log('\n\n✓ API smoke test passed');
