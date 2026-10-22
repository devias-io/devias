import { afterEach, describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/prompt/system';
import { text, toolUse } from '../src/testing';
import { createHarness, eventsOf, type Harness, lastUserText, resolve, send } from './helpers';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('the agent and documents', () => {
  it('teaches the documents tools and the Markdown rules only to agents that have them', () => {
    const documents = buildSystemPrompt(new Set(['documents']));
    expect(documents).toContain('## Documents');
    expect(documents).toContain('append_to_document');
    expect(documents).toContain('## Writing Markdown');
    expect(documents).toContain('[Label](document:<id>)');
    expect(documents).not.toContain('## How the workspace is organised');
    const records = buildSystemPrompt(new Set(['records']));
    expect(records).not.toContain('## Documents');
    expect(records).toContain('## Writing Markdown');
    expect(records).not.toContain('create_record on the document object');
    expect(buildSystemPrompt(new Set(['people']))).not.toContain('## Writing Markdown');
  });

  it('creates, reads, adds to and lists documents in Markdown, and asks before replacing or deleting', async () => {
    h = await createHarness();
    const company = await h.engine.records.create(h.owner, 'company', { name: 'Initech' });
    h.model.push(
      {
        content: [
          toolUse(
            'create_document',
            { title: 'Visit', markdown: `# Notes\n\nMet [Initech](record:company/${company.id}).` },
            'tu_1',
          ),
        ],
      },
      { content: [toolUse('list_documents', { mentions: `record:company/${company.id}` }, 'tu_2')] },
      { content: [text('Done.')] },
    );
    const conversation = (await h.service.conversations.create(h.owner, {})).id;
    const events = await send(h, h.owner, conversation, 'write up the visit');
    const [created, listed] = eventsOf(events, 'tool_result');
    expect(created?.status).toBe('executed');
    const document = created?.result as { id: string; link: string; markdown: string; version: number };
    expect(document.link).toBe(`document:${document.id}`);
    expect(document.markdown).toContain('# Notes');
    const found = listed?.result as { documents: { id: string }[] };
    expect(found.documents.map((item) => item.id)).toEqual([document.id]);
    // The stored document keeps the mention as an editor node.
    const stored = await h.engine.documents.get(h.owner, document.id);
    expect(stored.createdBy).toMatchObject({ kind: 'agent', onBehalfOf: { id: 'u_owner' } });
    expect(JSON.stringify(stored.body)).toContain('"type":"mention"');

    h.model.push(
      { content: [toolUse('append_to_document', { id: document.id, markdown: 'Follow up Friday.' }, 'tu_3')] },
      { content: [toolUse('get_document', { id: document.id }, 'tu_4')] },
      { content: [toolUse('update_document', { id: document.id, markdown: 'Replaced.' }, 'tu_5')] },
    );
    const second = await send(h, h.owner, conversation, 'add a follow-up and replace the rest');
    const [appended, read] = eventsOf(second, 'tool_result');
    expect(appended?.status).toBe('executed');
    const reread = read?.result as { markdown: string };
    expect(reread.markdown).toContain('Follow up Friday.');
    // Replacing a text asks first; nothing changed yet.
    const paused = eventsOf(second, 'paused')[0];
    expect(paused?.pending.map((call) => [call.name, call.requiresApproval])).toEqual([['update_document', true]]);
    expect((await h.engine.documents.get(h.owner, document.id)).markdown).toContain('Follow up Friday.');
    h.model.push({ content: [text('Replaced.')] });
    await resolve(h, h.owner, conversation, paused?.pending[0]?.id ?? '', true);
    expect((await h.engine.documents.get(h.owner, document.id)).markdown).toBe('Replaced.');

    h.model.push({ content: [toolUse('delete_document', { id: document.id }, 'tu_6')] });
    const third = await send(h, h.owner, conversation, 'delete it');
    expect(eventsOf(third, 'paused')[0]?.pending.map((call) => call.name)).toEqual(['delete_document']);
  });

  it('comments on a document without changing it', async () => {
    h = await createHarness();
    const document = await h.engine.documents.create(h.owner, { title: 'Brief', markdown: 'Text.' });
    h.model.push(
      { content: [toolUse('comment_on_document', { id: document.id, markdown: 'Is this final?' }, 'tu_1')] },
      { content: [text('Asked.')] },
    );
    const conversation = (await h.service.conversations.create(h.owner, {})).id;
    const events = await send(h, h.owner, conversation, 'ask whether the brief is final');
    expect(eventsOf(events, 'tool_result')[0]).toMatchObject({ status: 'executed' });
    const timeline = await h.engine.documents.activity(h.owner, document.id);
    expect(timeline.items[0]).toMatchObject({
      kind: 'comment',
      body: 'Is this final?',
      actor: { kind: 'agent', onBehalfOf: { id: 'u_owner' } },
    });
    expect((await h.engine.documents.get(h.owner, document.id)).version).toBe(1);
  });

  it('comments on a passage and answers a thread, and refuses text that is not in the document', async () => {
    h = await createHarness();
    const document = await h.engine.documents.create(h.owner, {
      title: 'Offer',
      markdown: 'The price list is attached.',
    });
    h.model.push(
      {
        content: [
          toolUse('comment_on_document', { id: document.id, markdown: 'Is it current?', quote: 'price list' }, 'tu_1'),
        ],
      },
      { content: [text('Asked.')] },
    );
    const conversation = (await h.service.conversations.create(h.owner, {})).id;
    await send(h, h.owner, conversation, 'ask about the price list');
    const [thread] = (await h.engine.documents.comments(h.owner, document.id)).items;
    expect(thread?.comment).toMatchObject({
      anchor: { quote: 'price list' },
      actor: { kind: 'agent', onBehalfOf: { id: 'u_owner' } },
    });

    h.model.push(
      {
        content: [
          toolUse('comment_on_document', { id: document.id, markdown: 'Yes.', replyTo: thread?.comment.id }, 'tu_2'),
        ],
      },
      { content: [text('Answered.')] },
    );
    const answered = await send(h, h.owner, conversation, 'answer it');
    expect(eventsOf(answered, 'tool_result')[0]).toMatchObject({ status: 'executed' });
    const [after] = (await h.engine.documents.comments(h.owner, document.id)).items;
    expect(after?.replies.map((reply) => reply.body)).toEqual(['Yes.']);

    h.model.push(
      { content: [toolUse('comment_on_document', { id: document.id, markdown: 'x', quote: 'not in it' }, 'tu_3')] },
      { content: [text('Failed.')] },
    );
    const failed = await send(h, h.owner, conversation, 'comment on missing text');
    expect(eventsOf(failed, 'tool_result')[0]).toMatchObject({ status: 'failed' });
    expect((await h.engine.documents.get(h.owner, document.id)).version).toBe(1);
  });

  it('reads the threads and resolves one through tools generated from the actions', async () => {
    h = await createHarness();
    const document = await h.engine.documents.create(h.owner, {
      title: 'Offer',
      markdown: 'The price list is attached.',
    });
    const made = await h.engine.documents.comment(h.owner, document.id, {
      markdown: 'Is it current?',
      anchor: { quote: 'price list' },
    });
    h.model.push(
      { content: [toolUse('list_document_comments', { id: document.id }, 'tu_1')] },
      {
        content: [toolUse('update_document_comment', { id: document.id, commentId: made.id, resolved: true }, 'tu_2')],
      },
      { content: [text('Resolved.')] },
    );
    const conversation = (await h.service.conversations.create(h.owner, {})).id;
    const events = await send(h, h.owner, conversation, 'resolve the open comment');
    const results = eventsOf(events, 'tool_result');
    expect(results.map((event) => event.status)).toEqual(['executed', 'executed']);
    expect(JSON.stringify(results[0]?.result)).toContain('price list');
    expect((await h.engine.documents.comments(h.owner, document.id)).items).toHaveLength(0);
    expect((await h.engine.documents.comments(h.owner, document.id, { status: 'resolved' })).items).toHaveLength(1);
  });

  it('refuses a stale expectedVersion with a conflict the model can read', async () => {
    h = await createHarness();
    const document = await h.engine.documents.create(h.owner, { title: 'Race', markdown: 'one' });
    await h.engine.documents.update(h.owner, document.id, { markdown: 'two' });
    h.model.push(
      { content: [toolUse('append_to_document', { id: document.id, markdown: 'x', expectedVersion: 1 }, 'tu_1')] },
      { content: [text('Conflict.')] },
    );
    const conversation = (await h.service.conversations.create(h.owner, {})).id;
    const events = await send(h, h.owner, conversation, 'add to it');
    expect(eventsOf(events, 'tool_result')[0]).toMatchObject({ status: 'failed' });
  });

  it('reads a linked document for the model, as data, and says when one is gone', async () => {
    h = await createHarness([{ content: [text('Noted.')] }]);
    const document = await h.engine.documents.create(h.owner, { title: 'Plan', markdown: 'Ship it.' });
    const conversation = (await h.service.conversations.create(h.owner, {})).id;
    await send(
      h,
      h.owner,
      conversation,
      `Summarise [Plan](document:${document.id}) and [Gone](document:00000000-0000-4000-8000-000000000009).`,
    );
    const seen = lastUserText(h.model);
    expect(seen).toContain(`- document:${document.id}: {`);
    expect(seen).toContain('"markdown":"Ship it."');
    expect(seen).toContain('- document:00000000-0000-4000-8000-000000000009: not found, or not readable by the person');
  });

  it('hides the tools from people who cannot use them', async () => {
    h = await createHarness();
    const ctx = {
      ...h.owner,
      actor: { kind: 'api_key' as const, id: 'k' },
      role: null,
      apiKeyPermissions: { document: ['read'] },
    };
    const snapshot = await h.engine.metadata.getSnapshot(h.workspaceId);
    const names = h.service.registry.toolsFor(ctx, snapshot).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['list_documents', 'get_document']));
    expect(names).not.toContain('create_document');
  });
});
