import type { Conversation } from '@devias/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newThread } from '../../src/agent-chat/chat/store';
import { Thread } from '../../src/agent-chat/chat/thread';
import { createStaticNavigation } from '../../src/router/navigation';
import { createFakeClient, installLayoutStubs, recordsFixture, schemaFixture, TestProviders } from '../../src/testing';

beforeAll(installLayoutStubs);
afterEach(cleanup);

describe('a sent message', () => {
  it('shows a mentioned record as a link to it, in the text as it was written', () => {
    const schema = schemaFixture();
    const client = createFakeClient(schema, recordsFixture());
    const navigation = createStaticNavigation('/workspaces/acme/records/person');
    window.history.replaceState(null, '', '/');
    const thread = newThread({ id: 'c1' } as Conversation);
    thread.messages.push({
      id: 'm1',
      conversationId: 'c1',
      turnId: 't1',
      seq: 1,
      role: 'user',
      blocks: [],
      createdAt: '2026-10-14T09:00:00.000Z',
      text: 'Compare [Ana Pop](record:person/p1) with\nlast year',
    });
    render(
      <TestProviders client={client} schema={schema} navigation={navigation}>
        <Thread thread={thread} streaming={false} onResolve={() => {}} onSuggestion={() => {}} />
      </TestProviders>,
    );
    const link = screen.getByRole('link', { name: '@Ana Pop' });
    expect(link.getAttribute('href')).toContain('/records/person/p1');
    expect(link.closest('[data-role="user"]')?.textContent).toBe('Compare @Ana Pop with\nlast year');
    fireEvent.click(link);
    expect(window.location.pathname).toContain('/records/person/p1');
  });

  it('shows a mentioned workflow as a link to its editor', () => {
    const schema = schemaFixture();
    const client = createFakeClient(schema, recordsFixture());
    window.history.replaceState(null, '', '/');
    const thread = newThread({ id: 'c1' } as Conversation);
    thread.messages.push({
      id: 'm2',
      conversationId: 'c1',
      turnId: 't1',
      seq: 1,
      role: 'user',
      blocks: [],
      createdAt: '2026-10-14T09:00:00.000Z',
      text: 'Why did [Nightly cleanup](workflow:wf-1) skip Ada?',
    });
    render(
      <TestProviders
        client={client}
        schema={schema}
        navigation={createStaticNavigation('/workspaces/acme/records/person')}
      >
        <Thread thread={thread} streaming={false} onResolve={() => {}} onSuggestion={() => {}} />
      </TestProviders>,
    );
    const link = screen.getByRole('link', { name: '@Nightly cleanup' });
    expect(link.getAttribute('href')).toContain('wf-1');
    fireEvent.click(link);
    expect(window.location.pathname).toContain('wf-1');
  });
});
