import { defineField, defineModule, defineObject } from '@devias/core';
import { createMockClient } from '@devias/sdk/mock';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRecordAutosave } from '../src/hooks/use-record-autosave';
import { TestProviders } from '../src/testing';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const page = defineObject({
  id: '01a1751f-5f08-717d-a428-3eaf59d7b313',
  nameSingular: 'page',
  namePlural: 'pages',
  labelSingular: 'Page',
  labelPlural: 'Pages',
  primaryField: '01a1751f-5f08-717d-a428-428761ffe456',
  fields: [defineField({ id: '01a1751f-5f08-717d-a428-428761ffe456', name: 'title', label: 'Title', type: 'text' })],
});

const setup = async (delayMs?: number) => {
  const client = createMockClient({
    workspaceId: 'ws1',
    manifests: [defineModule({ id: '01a1751f-5f08-717d-a428-446a0ff330a8', version: '0.1.0', objects: [page] })],
  });
  const schema = await client.metadata.getSchema();
  const record = await client.records.create('page', { title: 'Before' });
  let handle: ReturnType<typeof useRecordAutosave> | undefined;
  function Probe() {
    handle = useRecordAutosave('page', record.id, delayMs === undefined ? {} : { delayMs });

    return null;
  }
  render(
    <TestProviders client={client} schema={schema}>
      <Probe />
    </TestProviders>,
  );
  const title = async () => (await client.records.get('page', record.id)).title;

  return { queue: (patch: Record<string, unknown>) => handle?.queue(patch), flush: () => void handle?.flush(), title };
};

describe('record autosave', () => {
  it('saves after the delay it is given, counted from the last edit', async () => {
    const { queue, title } = await setup(3000);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => queue({ title: 'First' }));
    await vi.advanceTimersByTimeAsync(2000);
    // Typing again starts the wait over.
    act(() => queue({ title: 'Second' }));
    await vi.advanceTimersByTimeAsync(2999);
    expect(await title()).toBe('Before');
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await vi.waitFor(async () => expect(await title()).toBe('Second'));
  });

  it('saves at once when flushed, whatever the delay, and waits 0.8 seconds by default', async () => {
    const flushed = await setup(3000);
    act(() => flushed.queue({ title: 'Now' }));
    act(() => flushed.flush());
    await vi.waitFor(async () => expect(await flushed.title()).toBe('Now'));
    cleanup();
    const normal = await setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => normal.queue({ title: 'Soon' }));
    await vi.advanceTimersByTimeAsync(799);
    expect(await normal.title()).toBe('Before');
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await vi.waitFor(async () => expect(await normal.title()).toBe('Soon'));
  });
});
