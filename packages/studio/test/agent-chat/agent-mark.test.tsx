import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AgentMark } from '../../src/agent-chat/agent-mark';
import { AgentEditorPage } from '../../src/pages/agents/agent-editor';
import { AgentsView } from '../../src/pages/agents/agents-view';
import { createStaticNavigation } from '../../src/router/navigation';
import {
  agentFixture,
  createFakeClient,
  installLayoutStubs,
  recordsFixture,
  resolvedFixture,
  schemaFixture,
  TestProviders,
} from '../../src/testing';

beforeAll(installLayoutStubs);
afterEach(cleanup);

const images = { 'avatar-1': '/agents/agent-avatar-1.png', 'avatar-2': '/agents/agent-avatar-2.png' };

const inStudio = (ui: React.ReactNode, agentImages: Record<string, string> = images) => (
  <TestProviders client={createFakeClient(schemaFixture(), recordsFixture())} config={resolvedFixture({ agentImages })}>
    {ui}
  </TestProviders>
);

describe('AgentMark', () => {
  it('shows the image the app maps the icon name to, and the line icon for any other', () => {
    const { container } = render(
      inStudio(
        <>
          <AgentMark icon="avatar-1" className="size-11 rounded-sm" />
          <AgentMark icon="mail" className="size-11 rounded-sm" />
        </>,
      ),
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/agents/agent-avatar-1.png');
    expect(img?.className).toContain('size-11');
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('[data-icon="mail"]')).toBeTruthy();
  });

  it('puts the line icon on a tile when asked, and reads an empty icon as the default one', () => {
    const { container } = render(
      inStudio(<AgentMark tile icon="" className="size-11" />, { bot: '/agents/agent-avatar-9.png' }),
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/agents/agent-avatar-9.png');
    cleanup();
    const bare = render(inStudio(<AgentMark tile icon="" className="size-11" />, {}));
    expect(bare.container.querySelector('[data-icon="bot"]')).toBeTruthy();
    expect(bare.container.querySelector('img')).toBeNull();
  });
});

describe('agent rows with images', () => {
  it('draw the image in place of the icon when the app maps one', async () => {
    const sales = agentFixture({ id: 'a1', name: 'Billing', icon: 'avatar-1' });
    const client = createFakeClient(schemaFixture(), recordsFixture(), {
      ai: { agents: { list: async () => [sales] } } as never,
    });
    render(
      <TestProviders
        client={client}
        config={resolvedFixture({ agentImages: images })}
        navigation={createStaticNavigation('/workspaces/acme/agents')}
      >
        <AgentsView canManage />
      </TestProviders>,
    );
    const row = (await screen.findByText('Billing')).closest('[data-slot="agent-row"]') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'Edit Billing' })).toBeTruthy();
    expect(row.querySelector('img')?.getAttribute('src')).toBe('/agents/agent-avatar-1.png');
    expect(within(row).getByRole('button', { name: 'Archive Billing' })).toBeTruthy();
  });
});

describe('the icon picker of an agent', () => {
  const page = (agentImages: Record<string, string>) =>
    render(
      <TestProviders
        client={createFakeClient(schemaFixture(), recordsFixture())}
        config={resolvedFixture({ agentImages })}
        navigation={createStaticNavigation('/workspaces/acme/agents/new')}
      >
        <AgentEditorPage agent={null} tools={[]} />
      </TestProviders>,
    );

  it("offers the app's images as the icons, and picking one shows it as the agent's", () => {
    const { container } = page(images);
    expect(screen.getByRole('button', { name: 'Use the avatar-1 icon' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use the avatar-2 icon' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use the bot icon' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use the avatar-2 icon' }));
    expect((screen.getByLabelText('Icon') as HTMLInputElement).value).toBe('avatar-2');
    const header = container.querySelector('[data-slot="agent-header"] img');
    expect(header?.getAttribute('src')).toBe('/agents/agent-avatar-2.png');
  });

  it("shows the general agent's image under its own icon name, and offers it like any other", () => {
    const { container } = render(
      <TestProviders
        client={createFakeClient(schemaFixture(), recordsFixture())}
        config={resolvedFixture({ agentImages: { ...images, agent: '/agents/agent-avatar-12.png' } })}
        navigation={createStaticNavigation('/workspaces/acme/agents/new')}
      >
        <AgentEditorPage agent={null} tools={[]} />
        <AgentMark icon="agent" className="size-5" />
      </TestProviders>,
    );
    expect(screen.getByRole('button', { name: 'Use the agent icon' })).toBeTruthy();
    const mark = [...container.querySelectorAll('img')].find((img) => img.className.includes('size-5'));
    expect(mark?.getAttribute('src')).toBe('/agents/agent-avatar-12.png');
  });

  it('offers a few line icons when the app maps no images', () => {
    page({});
    expect(screen.getByRole('button', { name: 'Use the bot icon' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use the avatar-1 icon' })).toBeNull();
  });
});
