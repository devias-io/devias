import type { ActivityEntry, ActivityPage, DeviasClient } from '@devias/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ActivityEntries } from '../src/record';
import { RecordPage } from '../src/record/record-page';
import { createStaticNavigation } from '../src/router/navigation';
import { createFakeClient, installLayoutStubs, recordsFixture, schemaFixture, TestProviders } from '../src/testing';

beforeAll(installLayoutStubs);
afterEach(cleanup);

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const entries: ActivityEntry[] = [
  {
    id: '3',
    sequence: 3,
    kind: 'updated',
    changes: [{ field: 'stage', before: 'new', after: 'won' }],
    actor: { kind: 'api_key', id: 'k1' },
    occurredAt: hoursAgo(2),
  },
  {
    id: '2',
    sequence: 2,
    kind: 'updated',
    changes: [
      { field: 'first_name', before: 'Adda', after: 'Ada' },
      { field: 'email', before: null, after: 'ada@example.com' },
    ],
    actor: { kind: 'user', id: 'u1' },
    occurredAt: hoursAgo(3),
  },
  { id: '1', sequence: 1, kind: 'created', actor: { kind: 'user', id: 'u1' }, occurredAt: hoursAgo(4) },
];

const setup = (items: ActivityEntry[] = entries) => {
  const schema = schemaFixture();
  const activity = {
    list: vi.fn(async (): Promise<ActivityPage> => ({ items, nextCursor: null })),
  } satisfies DeviasClient['activity'];
  const client = createFakeClient(schema, recordsFixture(), { activity });
  const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
  render(
    <TestProviders
      client={client}
      schema={schema}
      navigation={createStaticNavigation('/workspaces/acme/records/person/p1', { tab: 'activity' })}
    >
      <RecordPage object={object} recordId="p1" />
    </TestProviders>,
  );

  return { activity };
};

describe('record activity', () => {
  it('adds an Activity tab with who changed what and the values as the fields show them, and nothing to write in', async () => {
    setup();
    expect(await screen.findByRole('tab', { name: 'Activity' })).toBeTruthy();
    await screen.findByText(/An API key/);
    const kinds = [...document.querySelectorAll('[data-activity]')].map((el) => el.getAttribute('data-activity'));
    expect(kinds).toEqual(['updated', 'updated', 'created']);
    // Writing about a record is for its comments: there is no box to comment in.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelector('[data-slot="activity-composer"]')).toBeNull();
    const [stage, several, created] = [...document.querySelectorAll('[data-activity]')];
    // One change reads as a sentence, with the select's labels; several fold under a headline.
    expect(stage?.textContent).toContain('An API key changed Stage');
    expect(stage?.textContent).toContain('New');
    expect(stage?.textContent).toContain('Won');
    expect(several?.textContent).toContain('Test User renamed this person to Ada and changed 1 other field');
    // The fields it touched besides the name are named, not shown, until it is opened.
    expect(several?.textContent).not.toContain('ada@example.com');
    expect(created?.textContent).toContain('Test User created this person');
  });

  it('shows when a change happened under it, as a full date and time', async () => {
    setup();
    const stage = (await screen.findByText(/An API key/)).closest('[data-activity]') as HTMLElement;
    const stamp = stage.querySelector('time') as HTMLTimeElement;
    // "Oct 16, 2024, 12:34 AM": date, then time; how long ago on hover.
    expect(stamp.textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} (AM|PM)$/);
    expect(stamp.title).toMatch(/ago$|just now$/);
    // It sits under the sentence, not beside it.
    expect(stamp.previousElementSibling?.textContent).toContain('An API key changed Stage');
  });

  it('folds an update of several fields under a headline, the fields it touched named below', async () => {
    setup();
    const several = (await screen.findByText(/renamed this person to/)).closest('[data-activity]') as HTMLElement;
    expect(within(several).getByText('Email')).toBeTruthy();
    expect(several.querySelector('table')).toBeNull();
    const toggle = within(several).getByRole('button', { name: 'Show changes' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Hide changes');
    // Open, the names are the table's rows, so the quiet line goes.
    expect(within(several).queryByText('Email')?.tagName).not.toBe('P');
    fireEvent.click(toggle);
    expect(within(several).getByText('Email').tagName).toBe('P');
  });

  it('opens the changes as a table of field, before and after, the new value in plain text', async () => {
    setup();
    const several = (await screen.findByText(/renamed this person to/)).closest('[data-activity]') as HTMLElement;
    fireEvent.click(within(several).getByRole('button', { name: 'Show changes' }));
    const table = within(several).getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Field', 'Before', 'After']);
    const [name, email] = within(table).getAllByRole('row').slice(1);
    expect(name?.textContent).toBe('First nameAddaAda');
    // A field that had no value shows a dash before; nothing struck through in a column that says "Before".
    expect(email?.textContent).toBe('Email–ada@example.com');
    expect(table.querySelector('.line-through')).toBeNull();
    // The old value is quieter than the new one.
    const [before, after] = [...(name?.querySelectorAll('td') ?? [])];
    expect(before?.querySelector('.text-muted-foreground')?.textContent).toBe('Adda');
    expect(after?.className).toContain('text-foreground');
  });

  it('counts the fields of an update that did not touch the name, and names them', async () => {
    setup([
      {
        id: '7',
        sequence: 7,
        kind: 'updated',
        changes: [
          { field: 'email', before: null, after: 'ada@example.com' },
          { field: 'stage', before: 'new', after: 'won' },
        ],
        actor: { kind: 'user', id: 'u1' },
        occurredAt: hoursAgo(1),
      },
    ]);
    const entry = (await screen.findByText(/updated 2 fields/)).closest('[data-activity]') as HTMLElement;
    expect(entry.textContent).toContain('Test User updated 2 fields');
    expect(within(entry).getByText('Email, Stage')).toBeTruthy();
  });

  it('says what happened to one field in a word: set, cleared or changed', async () => {
    setup([
      {
        id: '9',
        sequence: 9,
        kind: 'updated',
        changes: [{ field: 'email', before: null, after: 'ada@example.com' }],
        actor: { kind: 'user', id: 'u1' },
        occurredAt: hoursAgo(1),
      },
      {
        id: '8',
        sequence: 8,
        kind: 'updated',
        changes: [{ field: 'email', before: 'ada@example.com', after: null }],
        actor: { kind: 'user', id: 'u1' },
        occurredAt: hoursAgo(2),
      },
    ]);
    await waitFor(() => expect(document.querySelectorAll('[data-activity]')).toHaveLength(2));
    const [added, removed] = [...document.querySelectorAll<HTMLElement>('[data-activity]')];
    expect(added?.textContent).toContain('Test User set Email to');
    expect(added?.textContent).toContain('ada@example.com');
    expect(removed?.textContent).toContain('Test User cleared Email');
    // Cleared: what it was, struck through, and no arrow to an "empty".
    expect(removed?.querySelector('span.line-through')?.textContent).toBe('ada@example.com');
    expect(removed?.textContent).not.toContain('empty');
  });

  it('folds a burst of updates by one actor into a row that opens into the updates', async () => {
    const user = { kind: 'user', id: 'u1' } as const;
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    setup([
      {
        id: '5',
        sequence: 5,
        kind: 'updated',
        changes: [{ field: 'email', before: null, after: 'a@b.co' }],
        actor: user,
        occurredAt: minutesAgo(1),
      },
      {
        id: '4',
        sequence: 4,
        kind: 'updated',
        changes: [{ field: 'stage', before: 'new', after: 'won' }],
        actor: user,
        occurredAt: minutesAgo(2),
      },
      {
        id: '3',
        sequence: 3,
        kind: 'updated',
        changes: [{ field: 'stage', before: null, after: 'new' }],
        actor: { kind: 'api_key', id: 'k1' },
        occurredAt: minutesAgo(3),
      },
      {
        id: '2',
        sequence: 2,
        kind: 'updated',
        changes: [{ field: 'email', before: null, after: 'x@y.co' }],
        actor: user,
        occurredAt: minutesAgo(4),
      },
      { id: '1', sequence: 1, kind: 'created', actor: user, occurredAt: minutesAgo(5) },
    ]);
    const run = (await screen.findByText(/Show 2 updates/)).closest('[data-activity]') as HTMLElement;
    // A different actor in between, or a creation, breaks the run.
    expect([...document.querySelectorAll('[data-activity]')].map((el) => el.getAttribute('data-activity'))).toEqual([
      'run',
      'updated',
      'updated',
      'created',
    ]);
    // One quiet line: how many, and which fields.
    const toggle = within(run).getByRole('button', { name: 'Show 2 updates: Email, Stage' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('[data-activity="updated"]')).toHaveLength(2);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Hide 2 updates');
    // Open, the updates follow it in the list, not indented under it.
    const kinds = [...document.querySelectorAll('[data-activity]')].map((el) => el.getAttribute('data-activity'));
    expect(kinds).toEqual(['run', 'updated', 'updated', 'updated', 'updated', 'created']);
    expect(document.body.textContent).toContain('Test User set Email to');
    expect(document.body.textContent).toContain('Test User changed Stage');
  });

  it('does not fold updates by one actor that are far apart', async () => {
    const user = { kind: 'user', id: 'u1' } as const;
    setup([
      {
        id: '2',
        sequence: 2,
        kind: 'updated',
        changes: [{ field: 'email', before: null, after: 'a@b.co' }],
        actor: user,
        occurredAt: hoursAgo(1),
      },
      {
        id: '1',
        sequence: 1,
        kind: 'updated',
        changes: [{ field: 'stage', before: null, after: 'new' }],
        actor: user,
        occurredAt: hoursAgo(3),
      },
    ]);
    await waitFor(() => expect(document.querySelectorAll('[data-activity="updated"]')).toHaveLength(2));
    expect(document.querySelector('[data-activity="run"]')).toBeNull();
  });

  it('lists entries on their own as sentences with the date under them', async () => {
    const schema = schemaFixture();
    const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    const record = { id: 'p1', created_at: '', updated_at: '', first_name: 'Ada' };
    render(
      <TestProviders
        client={createFakeClient(schema, recordsFixture())}
        schema={schema}
        navigation={createStaticNavigation('/workspaces/acme/records/person/p1')}
      >
        <ActivityEntries object={object} record={record} entries={entries} />
      </TestProviders>,
    );
    const items = [...document.querySelectorAll('[data-slot="recent-activity"] [data-activity]')];
    expect(items.map((item) => item.getAttribute('data-activity'))).toEqual(['updated', 'updated', 'created']);
    expect(items[2]?.textContent).toContain('Test User created this person');

    for (const item of items) {
      expect(item.querySelector('time')?.textContent).toMatch(/, \d{4}, /);
    }

    // The headline folds the same way as in the timeline.
    fireEvent.click(within(items[1] as HTMLElement).getByRole('button', { name: 'Show changes' }));
    expect(within(items[1] as HTMLElement).getByRole('table')).toBeTruthy();
  });
});
