import type { RichTextDoc, RichTextNode } from '@devias/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type EngineContext, EngineError, readEventsAfter } from '../src';
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

describe('documents on PGlite', () => {
  let t: TestEngine;
  let dealId: string;
  const docs = () => t.engine.documents;
  const titles = async (query = {}) => (await docs().list(t.owner, query)).items.map((item) => item.title);

  beforeAll(async () => {
    t = await createTestEngine();
    dealId = (await t.engine.records.create(t.owner, 'opportunity', { name: 'Big deal', amount: 100 })).id;
  });
  afterAll(() => t.close());

  it('writes documents as the caller and tells the change feed', async () => {
    const before = (await readEventsAfter(t.db, t.workspaceId, 0, 1000)).length;
    const doc = await docs().create(t.member, { title: '  Kickoff  ', markdown: '# Plan\n\nCall **everyone**.' });
    expect(doc).toMatchObject({
      title: 'Kickoff',
      version: 1,
      createdBy: { kind: 'user', id: 'u_member' },
      updatedBy: { kind: 'user', id: 'u_member' },
      markdown: '# Plan\n\nCall **everyone**.',
      preview: 'Plan Call everyone.',
    });
    expect(doc.body.type).toBe('doc');
    expect(await docs().get(t.owner, doc.id)).toEqual(doc);

    const events = await readEventsAfter(t.db, t.workspaceId, 0, 1000);
    expect(events.slice(before)).toEqual([
      expect.objectContaining({ type: 'document.changed', documentId: doc.id, action: 'created' }),
    ]);

    const empty = await docs().create(t.owner, { title: 'Blank' });
    expect(empty.markdown).toBe('');
    expect(empty.preview).toBe('');
  });

  it('keeps the editor document when one is sent, and refuses both forms at once', async () => {
    const body: RichTextDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    };
    const doc = await docs().create(t.owner, { title: 'Editor', body });
    expect(doc.body).toEqual(body);
    expect(doc.markdown).toBe('Hello');
    expect(await codeOf(docs().create(t.owner, { title: 'Both', body, markdown: 'x' }))).toBe('VALIDATION');
    expect(await codeOf(docs().create(t.owner, { title: '   ' }))).toBe('VALIDATION');
    expect(await codeOf(docs().create(t.owner, { title: 'Bad', body: { type: 'paragraph' } as never }))).toBe(
      'VALIDATION',
    );
  });

  it('checks the size and the depth of a body, and drops links that are not safe', async () => {
    let deep: RichTextNode = { type: 'paragraph' };

    for (let i = 0; i < 70; i += 1) {
      deep = { type: 'blockquote', content: [deep] };
    }

    expect(await codeOf(docs().create(t.owner, { title: 'Deep', body: { type: 'doc', content: [deep] } }))).toBe(
      'VALIDATION',
    );
    const huge: RichTextDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(1_100_000) }] }],
    };
    expect(await codeOf(docs().create(t.owner, { title: 'Huge', body: huge }))).toBe('VALIDATION');
    // A tree that is not made of nodes is refused, where it used to break the link cleaning.
    const broken = { type: 'doc', content: 'x' } as unknown as RichTextDoc;
    expect(await codeOf(docs().create(t.owner, { title: 'Broken', body: broken }))).toBe('VALIDATION');

    const linked = await docs().create(t.owner, {
      title: 'Links',
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
              { type: 'text', text: 'good', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
            ],
          },
        ],
      },
    });
    expect(linked.markdown).toBe('bad[good](https://example.com)');
  });

  it('updates a title or the whole text, counting versions', async () => {
    const doc = await docs().create(t.owner, { title: 'Draft', markdown: 'one' });
    const renamed = await docs().update(t.member, doc.id, { title: 'Final' });
    expect(renamed).toMatchObject({ title: 'Final', version: 2, markdown: 'one', updatedBy: { id: 'u_member' } });
    expect(renamed.createdBy).toEqual({ kind: 'user', id: 'u_owner' });
    const rewritten = await docs().update(t.owner, doc.id, { markdown: 'two', expectedVersion: 2 });
    expect(rewritten).toMatchObject({ title: 'Final', version: 3, markdown: 'two', preview: 'two' });
    expect(await codeOf(docs().update(t.owner, doc.id, {}))).toBe('VALIDATION');
    expect(await codeOf(docs().update(t.owner, doc.id, { title: 'x', body: rewritten.body, markdown: 'y' }))).toBe(
      'VALIDATION',
    );
  });

  it('refuses a change made from an old version, and overwrites when no version is named', async () => {
    const doc = await docs().create(t.owner, { title: 'Race', markdown: 'a' });
    await docs().update(t.owner, doc.id, { markdown: 'b' });
    await expect(docs().update(t.owner, doc.id, { markdown: 'c', expectedVersion: 1 })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { currentVersion: 2 },
    });
    await expect(docs().append(t.owner, doc.id, { markdown: 'c', expectedVersion: 1 })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await docs().update(t.owner, doc.id, { markdown: 'd' })).markdown).toBe('d');
  });

  it('appends after the last block, atomically', async () => {
    const doc = await docs().create(t.owner, { title: 'Log' });
    const first = await docs().append(t.owner, doc.id, { markdown: 'first' });
    expect(first).toMatchObject({ markdown: 'first', version: 2 });
    const [a, b] = await Promise.all([
      docs().append(t.owner, doc.id, { markdown: 'from A' }),
      docs().append(t.member, doc.id, { markdown: 'from B' }),
    ]);
    expect(a.version + b.version).toBe(7);
    const last = await docs().get(t.owner, doc.id);
    expect(last.version).toBe(4);
    expect(last.markdown.split('\n\n').sort()).toEqual(['first', 'from A', 'from B']);
    expect(await codeOf(docs().append(t.owner, doc.id, { markdown: '' }))).toBe('VALIDATION');
  });

  it('searches the title and the text, newest change first, and pages with a cursor', async () => {
    await docs().create(t.owner, { title: 'Pricing 100%', markdown: 'discount table' });
    await docs().create(t.owner, { title: 'Roadmap', markdown: 'the pricing page, 100% done' });
    await docs().create(t.owner, { title: 'Other', markdown: 'nothing here' });
    expect(await titles({ search: 'pricing' })).toEqual(['Roadmap', 'Pricing 100%']);
    expect(await titles({ search: '100%' })).toEqual(['Roadmap', 'Pricing 100%']);
    expect(await titles({ search: '_ricing' })).toEqual([]);

    const first = await docs().list(t.owner, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBeGreaterThan(2);
    const seen = [...first.items.map((item) => item.id)];
    let cursor = first.nextCursor;

    while (cursor) {
      const page = await docs().list(t.owner, { limit: 2, cursor });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    }

    expect(new Set(seen).size).toBe(first.total);
    expect(await codeOf(docs().list(t.owner, { cursor: 'nonsense' }))).toBe('INVALID_CURSOR');
  });

  it('picks documents by id and by time of change', async () => {
    const a = await docs().create(t.owner, { title: 'Pick A' });
    const b = await docs().create(t.owner, { title: 'Pick B' });
    expect(await titles({ ids: `${a.id},${b.id}` })).toEqual(['Pick B', 'Pick A']);
    expect(await codeOf(docs().list(t.owner, { ids: 'nope' }))).toBe('VALIDATION');
    const after = await docs().list(t.owner, { updatedAfter: a.updatedAt, limit: 100 });
    expect(after.items.map((item) => item.title)).not.toContain('Pick A');
  });

  it('finds the documents that mention a record or another document, and follows edits and deletes', async () => {
    const target = await docs().create(t.owner, { title: 'Target' });
    const mentions = await docs().create(t.owner, {
      title: 'Meeting',
      markdown: `Talked about [Big deal](record:opportunity/${dealId}) and [Target](document:${target.id}) and [Gone](record:nope/${dealId}).`,
    });
    expect(mentions.body.content?.[0]?.content?.some((node) => node.type === 'mention')).toBe(true);
    expect(await titles({ mentions: `record:opportunity/${dealId}` })).toEqual(['Meeting']);
    const opportunity = await t.engine.metadata.objects.list(t.owner);
    const objectId = opportunity.find((object) => object.nameSingular === 'opportunity')?.id;
    expect(await titles({ mentions: `record:${objectId}/${dealId}` })).toEqual(['Meeting']);
    expect(await titles({ mentions: `document:${target.id}` })).toEqual(['Meeting']);
    expect(await codeOf(docs().list(t.owner, { mentions: 'record:nope/x' }))).toBe('VALIDATION');
    expect(await codeOf(docs().list(t.owner, { mentions: 'https://example.com' }))).toBe('VALIDATION');

    await docs().update(t.owner, mentions.id, { markdown: 'No links now.' });
    expect(await titles({ mentions: `record:opportunity/${dealId}` })).toEqual([]);
    await docs().append(t.owner, mentions.id, { markdown: `Again [Big deal](record:opportunity/${dealId})` });
    expect(await titles({ mentions: `record:opportunity/${dealId}` })).toEqual(['Meeting']);
    await docs().delete(t.owner, mentions.id);
    expect(await titles({ mentions: `record:opportunity/${dealId}` })).toEqual([]);
  });

  it('removes documents softly: gone from every read, with an event', async () => {
    const doc = await docs().create(t.owner, { title: 'Doomed' });
    await docs().delete(t.member, doc.id);
    expect(await codeOf(docs().get(t.owner, doc.id))).toBe('NOT_FOUND');
    expect(await codeOf(docs().update(t.owner, doc.id, { title: 'x' }))).toBe('NOT_FOUND');
    expect(await codeOf(docs().delete(t.owner, doc.id))).toBe('NOT_FOUND');
    expect(await titles({ search: 'Doomed' })).toEqual([]);
    const events = await readEventsAfter(t.db, t.workspaceId, 0, 1000);
    expect(events.at(-1)).toMatchObject({ type: 'document.changed', documentId: doc.id, action: 'deleted' });
    expect(await codeOf(docs().get(t.owner, 'not-a-uuid'))).toBe('VALIDATION');
  });

  it('checks permissions: members write, keys need a document grant, workflows and modules may', async () => {
    const key = (permissions?: Record<string, string[]>): EngineContext => ({
      workspaceId: t.workspaceId,
      actor: { kind: 'api_key', id: 'k' },
      role: null,
      ...(permissions ? { apiKeyPermissions: permissions } : {}),
    });
    const workflow: EngineContext = {
      workspaceId: t.workspaceId,
      actor: { kind: 'workflow', id: 'wf_1' },
      role: null,
    };
    const stranger: EngineContext = { ...t.member, role: null };
    expect(await codeOf(docs().list(key()))).toBe('FORBIDDEN');
    expect(await codeOf(docs().list(key({ record: ['read'] })))).toBe('FORBIDDEN');
    expect(await codeOf(docs().list(key({ document: ['read'] })))).toBe('ok');
    expect(await codeOf(docs().create(key({ document: ['read'] }), { title: 'x' }))).toBe('FORBIDDEN');
    expect(await codeOf(docs().create(key({ document: ['write'] }), { title: 'From a key' }))).toBe('ok');
    expect(await codeOf(docs().create(workflow, { title: 'From a workflow' }))).toBe('ok');
    const readable = await docs().create(t.owner, { title: 'Commentable' });
    expect(await codeOf(docs().activity(key({ document: ['read'] }), readable.id))).toBe('ok');
    expect(await codeOf(docs().comment(key({ document: ['read'] }), readable.id, { markdown: 'x' }))).toBe('FORBIDDEN');
    expect(await codeOf(docs().comment(key({ document: ['write'] }), readable.id, { markdown: 'x' }))).toBe('ok');
    expect(await codeOf(docs().list(stranger))).toBe('FORBIDDEN');
  });

  it('keeps a timeline: when it was made, one line per stretch of editing, and the comments', async () => {
    const doc = await docs().create(t.owner, { title: 'Timeline', markdown: 'one' });
    await docs().update(t.owner, doc.id, { markdown: 'two' });
    await docs().append(t.owner, doc.id, { markdown: 'three' });
    // The same person, moments after making it: no new line for each save.
    expect((await docs().activity(t.owner, doc.id)).items.map((entry) => entry.kind)).toEqual(['created']);
    // Someone else editing is a line of their own, saying what they changed.
    await docs().update(t.member, doc.id, { title: 'Timeline 2' });
    await docs().update(t.member, doc.id, { title: 'Timeline 3', markdown: 'four' });
    const comment = await docs().comment(t.member, doc.id, { markdown: 'Looks **good**' });
    expect(comment).toMatchObject({
      parentId: null,
      anchor: null,
      body: 'Looks **good**',
      documentId: doc.id,
      actor: { kind: 'user', id: 'u_member' },
    });
    const before = await docs().get(t.owner, doc.id);
    const { items } = await docs().activity(t.owner, doc.id);
    expect(items.map((entry) => entry.kind)).toEqual(['comment', 'edited', 'created']);
    expect(items[1]).toMatchObject({ actor: { id: 'u_member' }, data: { changes: ['title'] } });
    // A comment changes neither the document nor when it was last edited.
    expect((await docs().get(t.owner, doc.id)).version).toBe(before.version);
    expect((await docs().get(t.owner, doc.id)).updatedAt).toBe(before.updatedAt);
    const events = await readEventsAfter(t.db, t.workspaceId, 0, 1000);
    expect(events.at(-1)).toMatchObject({ type: 'document.changed', documentId: doc.id, action: 'commented' });

    // It pages, newest first, and a task's timeline is another timeline.
    const first = await docs().activity(t.owner, doc.id, { limit: 2 });
    expect(first.items.map((entry) => entry.kind)).toEqual(['comment', 'edited']);
    const second = await docs().activity(t.owner, doc.id, { limit: 2, cursor: first.nextCursor as string });
    expect(second.items.map((entry) => entry.kind)).toEqual(['created']);
    expect(second.nextCursor).toBeNull();
    const task = await t.engine.tasks.create(t.owner, { title: 'Not the same timeline' });
    expect((await t.engine.tasks.activity(t.owner, task.id)).items.map((entry) => entry.kind)).toEqual(['created']);
    expect(await codeOf(docs().activity(t.owner, doc.id, { cursor: 'junk' }))).toBe('INVALID_CURSOR');
    expect(await codeOf(docs().comment(t.owner, doc.id, { markdown: '  ' }))).toBe('VALIDATION');
    expect(await codeOf(docs().comment(t.owner, task.id, { markdown: 'wrong entity' }))).toBe('NOT_FOUND');
    expect(await codeOf(docs().activity(t.owner, '00000000-0000-7000-8000-000000000000'))).toBe('NOT_FOUND');
  });

  it('comments on a selection of the text, with replies, resolving and deleting', async () => {
    const doc = await docs().create(t.owner, {
      title: 'Offer',
      markdown: 'The price list is attached.\n\nSee the price list again before Friday.',
    });
    const version = doc.version;
    // The engine finds the quote, takes its context, and tells repeats apart by the hint the studio sends.
    const first = await docs().comment(t.member, doc.id, {
      markdown: 'Is this the **current** one?',
      anchor: { quote: 'price  list' },
    });
    expect(first.anchor).toMatchObject({ quote: 'price list', prefix: 'The ', hint: 4 });
    const second = await docs().comment(t.owner, doc.id, {
      markdown: 'And here?',
      anchor: { quote: 'price list', hint: 40 },
    });
    expect(second.anchor?.quote).toBe('price list');
    expect(second.anchor?.hint).toBe(40);
    expect(await codeOf(docs().comment(t.owner, doc.id, { markdown: 'x', anchor: { quote: 'not in the text' } }))).toBe(
      'VALIDATION',
    );

    // Replies: to a top-level comment, not to a reply, and not on a selection of their own.
    const reply = await docs().comment(t.owner, doc.id, { markdown: 'Yes, from today.', parent: first.id });
    expect(reply).toMatchObject({ parentId: first.id, anchor: null });
    expect(await codeOf(docs().comment(t.owner, doc.id, { markdown: 'x', parent: reply.id }))).toBe('VALIDATION');
    expect(
      await codeOf(docs().comment(t.owner, doc.id, { markdown: 'x', parent: '00000000-0000-7000-8000-000000000000' })),
    ).toBe('NOT_FOUND');
    expect(
      await codeOf(docs().comment(t.owner, doc.id, { markdown: 'x', parent: first.id, anchor: { quote: 'price' } })),
    ).toBe('VALIDATION');

    // Threads: oldest first, replies under their first comment, open ones by default.
    const open = await docs().comments(t.owner, doc.id);
    expect(open.items.map((thread) => [thread.comment.id, thread.replies.map((r) => r.id)])).toEqual([
      [first.id, [reply.id]],
      [second.id, []],
    ]);

    // Resolving is for any writer, on a thread's first comment.
    const resolved = await docs().updateComment(t.owner, doc.id, first.id, { resolved: true });
    expect(resolved).toMatchObject({ resolvedBy: { id: 'u_owner' } });
    expect(resolved.resolvedAt).not.toBeNull();
    expect(await codeOf(docs().updateComment(t.owner, doc.id, reply.id, { resolved: true }))).toBe('VALIDATION');
    expect((await docs().comments(t.owner, doc.id)).items.map((thread) => thread.comment.id)).toEqual([second.id]);
    expect(
      (await docs().comments(t.owner, doc.id, { status: 'resolved' })).items.map((thread) => thread.comment.id),
    ).toEqual([first.id]);
    expect((await docs().comments(t.owner, doc.id, { status: 'all' })).items).toHaveLength(2);
    expect((await docs().updateComment(t.member, doc.id, first.id, { resolved: false })).resolvedAt).toBeNull();

    // The text of a comment is its author's (or an admin's).
    expect(await codeOf(docs().updateComment(t.owner, doc.id, first.id, { markdown: 'edited by the owner' }))).toBe(
      'ok',
    );
    const member = (id: string) => docs().updateComment(t.member, doc.id, id, { markdown: 'mine?' });
    expect(await codeOf(member(second.id))).toBe('FORBIDDEN');
    expect((await docs().comments(t.owner, doc.id)).items[0]?.comment.editedAt).not.toBeNull();
    expect(await codeOf(docs().updateComment(t.owner, doc.id, first.id, {} as never))).toBe('VALIDATION');

    // Deleting a thread's first comment takes its replies; a stranger cannot delete.
    expect(await codeOf(docs().deleteComment(t.member, doc.id, second.id))).toBe('FORBIDDEN');
    await docs().deleteComment(t.member, doc.id, first.id);
    expect(
      (await docs().comments(t.owner, doc.id, { status: 'all' })).items.map((thread) => thread.comment.id),
    ).toEqual([second.id]);
    expect(await codeOf(docs().deleteComment(t.member, doc.id, reply.id))).toBe('NOT_FOUND');

    // None of this touched the document, and the timeline still lists the comments.
    const after = await docs().get(t.owner, doc.id);
    expect(after.version).toBe(version);
    expect((await docs().activity(t.owner, doc.id)).items.filter((entry) => entry.kind === 'comment')).toHaveLength(1);
  });

  it('is emptied with the workspace', async () => {
    const other = await createTestEngine();

    try {
      const doc = await other.engine.documents.create(other.owner, {
        title: 'Linked',
        markdown: `[x](document:${(await other.engine.documents.create(other.owner, { title: 'T' })).id})`,
      });
      expect(doc.version).toBe(1);
      await other.engine.workspaces.purge(other.workspaceId);
      const rows = await other.client.query<{ n: number }>(
        'SELECT (SELECT count(*) FROM document)::int + (SELECT count(*) FROM mention)::int + (SELECT count(*) FROM comment)::int AS n',
      );
      expect(rows.rows[0]?.n).toBe(0);
    } finally {
      await other.close();
    }
  });
});
