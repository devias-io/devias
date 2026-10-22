import type { WorkspaceEvent } from '@devias/core';
import { manifest as fixture } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { DeviasApiError, q } from '../src';
import { demoClient } from './demo-data';

const demo = () => demoClient({ workspaceId: 'ws_test', manifests: [fixture], today: '2026-06-15' });

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

describe('mock activity', () => {
  it('seeds a history for the demo records, oldest last, without touching the event feed', async () => {
    const client = demo();
    expect(client.store.events).toHaveLength(0);
    const [deal] = (
      await client.records.list(
        q('opportunity')
          .where((f) => f.eq('stage', 'customer'))
          .limit(1)
          .build(),
      )
    ).items;

    if (!deal) {
      throw new Error('no customer deal in the demo data');
    }

    const page = await client.activity.list('opportunity', deal.id);
    expect(page.items.at(-1)?.kind).toBe('created');
    const stages = page.items
      .flatMap((entry) => (entry.kind === 'updated' ? entry.changes : []))
      .filter((change) => change.field === 'stage')
      .map((change) => change.after);
    // Newest first: the deal ends on its current stage.
    expect(stages[0]).toBe('customer');
    const times = page.items.map((entry) => entry.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('tracks live changes, and a note is not part of the activity', async () => {
    const client = demo();
    const events: WorkspaceEvent[] = [];
    client.events.subscribe((event) => events.push(event));
    const person = await client.records.create('person', { first_name: 'Eve' });
    await client.records.update('person', person.id, { city: 'Oslo', first_name: 'Eve' });
    await client.notes.create('person', person.id, { title: 'Ping her on Monday' });

    const page = await client.activity.list('person', person.id);
    expect(page.items.map((entry) => entry.kind)).toEqual(['updated', 'created']);
    expect(page.items[0]).toMatchObject({ changes: [{ field: 'city', before: null, after: 'Oslo' }] });

    await flush();
    expect(events.map((event) => event.type)).toEqual(['record.created', 'record.updated', 'note.created']);
    expect((await failure(client.activity.list('person', person.id, { cursor: 'x' }))).code).toBe('INVALID_CURSOR');
  });

  it('pages with a cursor', async () => {
    const client = demo();
    const person = await client.records.create('person', { first_name: 'Pat' });

    for (const city of ['A', 'B', 'C']) {
      await client.records.update('person', person.id, { city });
    }

    const first = await client.activity.list('person', person.id, { limit: 3 });
    expect(first.items).toHaveLength(3);
    const rest = await client.activity.list('person', person.id, { limit: 3, cursor: first.nextCursor ?? '' });
    expect(rest.items.map((entry) => entry.kind)).toEqual(['created']);
    expect(rest.nextCursor).toBeNull();
  });
});
