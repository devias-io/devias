import { coreIds, defineField, defineModule, defineObject } from '@devias/core';
import { createMockClient } from '@devias/sdk/mock';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChatInput, type ChatInputHandle, lookupEntities } from '../src/editor';
import { installLayoutStubs, TestProviders } from '../src/testing';

beforeAll(installLayoutStubs);
afterEach(cleanup);

type MessageEditor = {
  chain: () => { focus: (at: 'end') => { insertContent: (content: unknown) => { run: () => boolean } } };
};

const setup = async (props: { disabled?: boolean } = {}) => {
  const client = createMockClient({ workspaceId: 'ws1', manifests: [] });
  const schema = await client.metadata.getSchema();
  const onSubmit = vi.fn();
  const onEmptyChange = vi.fn();
  const handle = createRef<ChatInputHandle | null>() as { current: ChatInputHandle | null };
  render(
    <TestProviders client={client} schema={schema}>
      <ChatInput
        ariaLabel="Message"
        placeholder="Ask…"
        onSubmit={onSubmit}
        onEmptyChange={onEmptyChange}
        handleRef={handle}
        {...props}
      />
    </TestProviders>,
  );
  const box = screen.getByRole('textbox', { name: 'Message' });
  const insert = (content: unknown) =>
    act(() => {
      (box as HTMLElement & { editor: MessageEditor }).editor.chain().focus('end').insertContent(content).run();
    });
  const enter = () => fireEvent.keyDown(box, { key: 'Enter', keyCode: 13 });

  return { box, insert, enter, onSubmit, onEmptyChange, handle };
};

const mention = { type: 'mention', attrs: { object: 'person', id: 'p1', label: 'Ana Pop' } };

describe('chat input', () => {
  it('sends a message with a mentioned record as a record link, on Enter', async () => {
    const { insert, enter, onSubmit } = await setup();
    insert([{ type: 'text', text: 'Compare ' }, mention, { type: 'text', text: ' with last year' }]);
    enter();
    expect(onSubmit).toHaveBeenCalledWith('Compare [Ana Pop](record:person/p1) with last year');
  });

  it('sends nothing while empty, keeps what is typed until the caller clears it, and starts empty', async () => {
    const { insert, enter, onSubmit, onEmptyChange, handle } = await setup();
    enter();
    expect(onSubmit).not.toHaveBeenCalled();
    insert('hello');
    expect(onEmptyChange).toHaveBeenLastCalledWith(false);
    expect(handle.current?.markdown()).toBe('hello');
    act(() => handle.current?.clear());
    expect(handle.current?.markdown()).toBe('');
    expect(onEmptyChange).toHaveBeenLastCalledWith(true);
  });

  it('keeps Markdown the person types as the text they typed, with no blocks or formatting of its own', async () => {
    const { box, insert, enter, onSubmit } = await setup();
    insert('# not a heading, **not bold**');
    enter();
    expect(onSubmit).toHaveBeenCalledWith('# not a heading, **not bold**');
    expect(box.querySelector('h1, strong')).toBeNull();
  });

  it('shows its hint while empty, and takes no input while disabled', async () => {
    const { box } = await setup({ disabled: true });
    expect(box.getAttribute('contenteditable')).toBe('false');
    expect(box.querySelector('[data-placeholder]')).toBeNull();
    cleanup();
    const enabled = await setup();
    expect(enabled.box.querySelector('[data-placeholder="Ask…"]')).toBeTruthy();
  });
});

describe('mentioning a workflow', () => {
  it('goes out as a workflow link, next to record links', async () => {
    const { insert, enter, onSubmit } = await setup();
    insert([
      { type: 'text', text: 'Why did ' },
      { type: 'mention', attrs: { object: 'workflow', id: 'wf-1', label: 'Nightly cleanup' } },
      { type: 'text', text: ' skip ' },
      mention,
    ]);
    enter();
    expect(onSubmit).toHaveBeenCalledWith('Why did [Nightly cleanup](workflow:wf-1) skip [Ana Pop](record:person/p1)');
  });

  it('is offered by @ after the records, when its name matches, and only a few of them', async () => {
    const thing = defineObject({
      id: '01a1751f-5f0b-70b0-8818-9bfce0f2c870',
      nameSingular: 'thing',
      namePlural: 'things',
      labelSingular: 'Thing',
      labelPlural: 'Things',
      fields: [defineField({ id: '01a1751f-5f0b-70b0-8818-9e5b3824d8e9', name: 'name', label: 'Name', type: 'text' })],
    });
    const client = createMockClient({
      workspaceId: 'ws1',
      manifests: [defineModule({ id: '01a1751f-5f08-717d-a428-446a0ff330a8', version: '0.1.0', objects: [thing] })],
    });
    const input = (name: string) => ({
      title: name,
      trigger: { kind: 'schedule' as const, cron: '0 * * * *' },
      steps: [
        {
          kind: 'action' as const,
          actionId: coreIds.actions.create_record,
          input: { object: 'thing', values: { name: 'x' } },
        },
      ],
    });

    for (const name of ['Nightly cleanup', 'Welcome email', 'Cleanup of stale deals', 'Clean the inbox', 'Cleanse']) {
      await client.workflows.create(input(name));
    }

    const hits = await lookupEntities(client, 'clean', { workflows: true });
    expect(hits.map((hit) => [hit.object, hit.title, hit.subtitle])).toEqual([
      ['workflow', 'Nightly cleanup', 'Workflow'],
      ['workflow', 'Cleanup of stale deals', 'Workflow'],
      ['workflow', 'Clean the inbox', 'Workflow'],
    ]);
    expect(hits[0]).toMatchObject({ objectId: 'workflow', recordId: expect.any(String) });
  });

  it('offers documents whose title matches, and workflows only when asked', async () => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [] });
    const plan = await client.documents.create({ title: 'Clean-up plan', markdown: 'Steps.' });
    await client.documents.create({ title: 'Other' });
    const hits = await lookupEntities(client, 'clean');
    expect(hits.map((hit) => [hit.object, hit.recordId, hit.title, hit.subtitle])).toEqual([
      ['document', plan.id, 'Clean-up plan', 'Document'],
    ]);
  });

  it('offers no workflows to someone who cannot read them', async () => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [] });
    client.workflows.list = async () => {
      throw new Error('forbidden');
    };
    expect(await lookupEntities(client, 'anything', { workflows: true })).toEqual([]);
  });
});
