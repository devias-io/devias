import type { RichTextDoc, WorkspaceEvent } from '@devias/core';
import { manifest as fixture } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { DeviasApiError } from '../src';
import { createMockClient } from '../src/mock';

const mock = () => createMockClient({ workspaceId: 'ws_test', manifests: [fixture] });

const failure = async (promise: Promise<unknown>): Promise<DeviasApiError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DeviasApiError) {
      return error;
    }

    throw error;
  }

  throw new Error('expected a failure');
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mock documents', () => {
  it('creates, reads, changes and removes documents like the server, and tells the feed', async () => {
    const client = mock();
    const events: WorkspaceEvent[] = [];
    client.events.subscribe((event) => events.push(event));
    const doc = await client.documents.create({ title: '  Plan  ', markdown: '# Goals\n\nShip **it**.' });
    expect(doc).toMatchObject({
      title: 'Plan',
      version: 1,
      markdown: '# Goals\n\nShip **it**.',
      preview: 'Goals Ship it.',
      createdBy: { kind: 'user' },
    });
    expect(await client.documents.get(doc.id)).toEqual(doc);
    const renamed = await client.documents.update(doc.id, { title: 'Roadmap' });
    expect(renamed).toMatchObject({ title: 'Roadmap', version: 2, markdown: doc.markdown });
    await client.documents.delete(doc.id);
    expect((await failure(client.documents.get(doc.id))).status).toBe(404);
    expect((await failure(client.documents.delete(doc.id))).status).toBe(404);
    await flush();
    expect(
      events.filter((event) => event.type === 'document.changed').map((event) => 'action' in event && event.action),
    ).toEqual(['created', 'updated', 'deleted']);
  });

  it('validates input like the engine', async () => {
    const client = mock();
    const body: RichTextDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect((await failure(client.documents.create({ title: ' ' }))).code).toBe('VALIDATION');
    expect((await failure(client.documents.create({ title: 'x', markdown: 'y', body }))).code).toBe('VALIDATION');
    expect((await failure(client.documents.create({ title: 'x', body: { type: 'paragraph' } as never }))).code).toBe(
      'VALIDATION',
    );
    expect((await failure(client.documents.get('nope'))).code).toBe('VALIDATION');
    const doc = await client.documents.create({ title: 'x' });
    expect((await failure(client.documents.update(doc.id, {}))).code).toBe('VALIDATION');
    const linked = await client.documents.create({
      title: 'Links',
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
          },
        ],
      },
    });
    expect(linked.markdown).toBe('bad');
  });

  it('refuses a change from an old version and appends to the end', async () => {
    const client = mock();
    const doc = await client.documents.create({ title: 'Log' });
    const first = await client.documents.append(doc.id, { markdown: 'first' });
    expect(first).toMatchObject({ markdown: 'first', version: 2 });
    const second = await client.documents.append(doc.id, { markdown: 'second', expectedVersion: 2 });
    expect(second).toMatchObject({ markdown: 'first\n\nsecond', version: 3 });
    const stale = await failure(client.documents.update(doc.id, { markdown: 'x', expectedVersion: 1 }));
    expect(stale).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect((await client.documents.update(doc.id, { markdown: 'x' })).markdown).toBe('x');
  });

  it('searches, picks, pages and finds what mentions a record or a document', async () => {
    const client = mock();
    const person = await client.records.create('person', { first_name: 'Ana' });
    const target = await client.documents.create({ title: 'Target' });
    await client.documents.create({ title: 'Pricing 100%', markdown: 'discount table' });
    const meeting = await client.documents.create({
      title: 'Meeting',
      markdown: `Met [Ana](record:person/${person.id}) about [Target](document:${target.id}).`,
    });
    expect((await client.documents.list({ search: 'pricing' })).items.map((item) => item.title)).toEqual([
      'Pricing 100%',
    ]);
    expect((await client.documents.list({ search: 'DISCOUNT' })).total).toBe(1);
    expect(
      (await client.documents.list({ mentions: `record:person/${person.id}` })).items.map((item) => item.id),
    ).toEqual([meeting.id]);
    expect((await client.documents.list({ mentions: `document:${target.id}` })).items.map((item) => item.id)).toEqual([
      meeting.id,
    ]);
    expect((await failure(client.documents.list({ mentions: `record:ghost/${person.id}` }))).code).toBe('VALIDATION');
    expect((await client.documents.list({ ids: `${target.id},${meeting.id}` })).total).toBe(2);

    const first = await client.documents.list({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    const second = await client.documents.list({ limit: 2, cursor: first.nextCursor ?? '' });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect((await failure(client.documents.list({ cursor: 'nonsense' }))).code).toBe('INVALID_CURSOR');
    await client.documents.delete(meeting.id);
    expect((await client.documents.list({ mentions: `record:person/${person.id}` })).total).toBe(0);
  });

  it('keeps documents in a saved snapshot', async () => {
    const client = mock();
    await client.documents.create({ title: 'Kept', markdown: 'text' });
    const other = mock();
    other.store.restore(client.store.snapshot());
    expect((await other.documents.list()).items.map((item) => item.title)).toEqual(['Kept']);
  });

  it('keeps a timeline like the server: made, one line per stretch of editing, and comments', async () => {
    const client = mock();
    const events: WorkspaceEvent[] = [];
    client.events.subscribe((event) => events.push(event));
    const doc = await client.documents.create({ title: 'Plan', markdown: 'one' });
    await client.documents.update(doc.id, { markdown: 'two' });
    await client.documents.append(doc.id, { markdown: 'three' });
    expect((await client.documents.activity(doc.id)).items.map((entry) => entry.kind)).toEqual(['created']);
    const entry = await client.documents.comment(doc.id, { markdown: 'Nice' });
    expect(entry).toMatchObject({ body: 'Nice', documentId: doc.id, parentId: null, anchor: null });
    expect((await failure(client.documents.comment(doc.id, { markdown: '  ' }))).code).toBe('VALIDATION');
    expect((await failure(client.documents.activity('00000000-0000-4000-8000-000000000009'))).code).toBe('NOT_FOUND');
    const page = await client.documents.activity(doc.id, { limit: 1 });
    expect(page.items.map((item) => item.kind)).toEqual(['comment']);
    expect(
      (await client.documents.activity(doc.id, { limit: 1, cursor: page.nextCursor as string })).items[0]?.kind,
    ).toBe('created');
    expect((await client.documents.get(doc.id)).version).toBe(3);
    await flush();
    expect(events.filter((event) => event.type === 'document.changed').at(-1)).toMatchObject({ action: 'commented' });
  });

  it('comments on a selection, with replies, resolving and deleting, like the server', async () => {
    const client = mock();
    const doc = await client.documents.create({
      title: 'Offer',
      markdown: 'The price list is attached.\n\nSee the price list again.',
    });
    const first = await client.documents.comment(doc.id, { markdown: 'Current?', anchor: { quote: 'price list' } });
    expect(first.anchor).toMatchObject({ quote: 'price list', prefix: 'The ', hint: 4 });
    expect((await failure(client.documents.comment(doc.id, { markdown: 'x', anchor: { quote: 'nope' } }))).code).toBe(
      'VALIDATION',
    );
    const reply = await client.documents.comment(doc.id, { markdown: 'Yes.', parent: first.id });
    expect(reply).toMatchObject({ parentId: first.id, anchor: null });
    expect((await failure(client.documents.comment(doc.id, { markdown: 'x', parent: reply.id }))).code).toBe(
      'VALIDATION',
    );
    expect((await client.documents.comments(doc.id)).items.map((t) => [t.comment.id, t.replies.length])).toEqual([
      [first.id, 1],
    ]);
    expect((await failure(client.documents.updateComment(doc.id, reply.id, { resolved: true }))).code).toBe(
      'VALIDATION',
    );
    const resolved = await client.documents.updateComment(doc.id, first.id, { resolved: true });
    expect(resolved.resolvedAt).not.toBeNull();
    expect((await client.documents.comments(doc.id)).items).toHaveLength(0);
    expect((await client.documents.comments(doc.id, { status: 'resolved' })).items).toHaveLength(1);
    expect((await client.documents.updateComment(doc.id, first.id, { markdown: 'Edited' })).editedAt).not.toBeNull();
    await client.documents.deleteComment(doc.id, first.id);
    expect((await client.documents.comments(doc.id, { status: 'all' })).items).toHaveLength(0);
    expect((await client.documents.get(doc.id)).version).toBe(1);
  });
});
