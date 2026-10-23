import type { AiAgent } from '@devias/core';
import { createMockClient } from '@devias/sdk/mock';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AgentEditorPage } from '../src/pages/agents/agent-editor';
import { SkillPage, SkillsPage, skillsPages } from '../src/pages/skills';
import { createStaticNavigation } from '../src/router/navigation';
import { createFakeClient, installLayoutStubs, recordsFixture, schemaFixture, TestProviders } from '../src/testing';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(installLayoutStubs);
afterEach(cleanup);

/** The SDK's mock backend as the client: skills and agents that behave as the server's do. */
const backend = () => {
  const mock = createMockClient({ workspaceId: 'ws1', manifests: [] });
  const client = createFakeClient(schemaFixture(), recordsFixture(), { ai: mock.ai });

  return { mock, client };
};

const input = (title: string) => ({ title, description: `When asked about ${title}`, body: `1. Do ${title}` });

const show = (
  client: ReturnType<typeof backend>['client'],
  ui: React.ReactNode,
  options: { search?: Record<string, unknown>; params?: Record<string, string>; navigate?: () => void } = {},
) => {
  const navigation = {
    ...createStaticNavigation('/workspaces/acme/agents', options.search ?? {}, options.params ?? {}),
    ...(options.navigate ? { navigate: options.navigate } : {}),
  };

  return render(
    <TestProviders client={client} navigation={navigation}>
      {ui}
    </TestProviders>,
  );
};

describe('the skills page', () => {
  it('is a page of its own, at /skills, with a page for each skill', () => {
    expect(skillsPages.map((page) => page.path)).toEqual(['skills', 'skills/new', 'skills/$skillId']);
    expect(skillsPages[0]).toMatchObject({ id: 'studio.skills' });
  });

  it('lists skills with when to use each', async () => {
    const { mock, client } = backend();
    await mock.ai.skills.create(input('Qualify a lead'));
    await mock.ai.skills.create(input('Invoice a client'));
    show(client, <SkillsPage />);

    const rows = await screen.findAllByRole('link', { name: /^Edit / });
    expect(rows.map((row) => row.textContent)).toEqual(['Edit Invoice a client', 'Edit Qualify a lead']);
    const row = document.querySelector('[data-slot="skill-row"]') as HTMLElement;
    expect(row.textContent).toContain('When asked about Invoice a client');
    expect(row.textContent).toContain('Workspace');
  });

  it('says there are none, and archives and restores one from its row', async () => {
    const { mock, client } = backend();
    show(client, <SkillsPage />);
    expect(await screen.findByText('No skills yet')).toBeTruthy();
    cleanup();

    const skill = await mock.ai.skills.create(input('Qualify a lead'));
    show(client, <SkillsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Archive Qualify a lead' }));
    await waitFor(async () => expect((await mock.ai.skills.get(skill.id)).archivedAt).not.toBeNull());
    // Archived skills leave the list until asked for.
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Edit Qualify a lead' })).toBeNull());
    fireEvent.click(await screen.findByRole('switch'));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Qualify a lead' }));
    await waitFor(async () => expect((await mock.ai.skills.get(skill.id)).archivedAt).toBeNull());
  });

  it('is locked to people who cannot manage agents', async () => {
    const { mock, client } = backend();
    const status = mock.ai.status.bind(mock.ai);
    mock.ai.status = async () => ({ ...(await status()), canManage: false });
    show(client, <SkillsPage />);
    expect(await screen.findByText('Skills are written by owners and admins')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /New skill/ })).toBeNull();
  });
});

describe('a skill’s page', () => {
  it('writes a new one, and goes to its page', async () => {
    const { mock, client } = backend();
    const navigate = vi.fn();
    show(client, <SkillPage />, { navigate });
    const write = (await screen.findByRole('button', { name: 'Write skill' })) as HTMLButtonElement;
    expect(write.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Qualify a lead' } });
    fireEvent.change(screen.getByLabelText('When to use it'), { target: { value: 'When a lead arrives' } });
    expect(write.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Procedure'), { target: { value: '1. Look it up' } });
    expect(screen.getByText(/13 \/ 20,000/)).toBeTruthy();
    expect(write.disabled).toBe(false);
    fireEvent.click(write);

    await waitFor(async () => expect(await mock.ai.skills.list()).toHaveLength(1));
    expect((await mock.ai.skills.list())[0]).toMatchObject({
      title: 'Qualify a lead',
      description: 'When a lead arrives',
    });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/\/skills\/workspace\./), { replace: true }),
    );
  });

  it('changes an existing one, saving only when something differs, and tells a clash', async () => {
    const { mock, client } = backend();
    const skill = await mock.ai.skills.create(input('Qualify a lead'));
    await mock.ai.skills.create(input('Invoice a client'));
    show(client, <SkillPage />, { params: { skillId: skill.id } });
    const save = (await screen.findByRole('button', { name: 'Save' })) as HTMLButtonElement;
    expect((screen.getByLabelText('Procedure') as HTMLTextAreaElement).value).toBe('1. Do Qualify a lead');
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Procedure'), { target: { value: '1. Do it better' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(async () => expect((await mock.ai.skills.get(skill.id)).body).toBe('1. Do it better'));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true),
    );

    // A title another skill has is refused by the server, and said.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'invoice a client' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A skill called "invoice a client" already exists'));
    expect((await mock.ai.skills.get(skill.id)).title).toBe('Qualify a lead');
  });

  it('shows a skill that comes with a module as read-only, with its module named', async () => {
    const { mock, client } = backend();
    const skill = await mock.ai.skills.create(input('Qualify a lead'));
    const get = mock.ai.skills.get.bind(mock.ai.skills);
    mock.ai.skills.get = async (id) => ({ ...(await get(id)), moduleId: 'crm' });
    show(client, <SkillPage />, { params: { skillId: skill.id } });
    expect(await screen.findByText(/Comes with the module crm/)).toBeTruthy();
    expect(screen.getByLabelText('Title').matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
  });

  it('says when the skill is not there', async () => {
    const { client } = backend();
    show(client, <SkillPage />, { params: { skillId: 'workspace.nope' } });
    expect(await screen.findByText('Skill not found')).toBeTruthy();
  });
});

describe('the skills of an agent', () => {
  const editor = async (skills: AiAgent['skills']) => {
    const { mock, client } = backend();
    const qualify = await mock.ai.skills.create(input('Qualify a lead'));
    const invoice = await mock.ai.skills.create(input('Invoice a client'));
    const refund = await mock.ai.skills.create(input('Refund an order'));
    const agent = await mock.ai.agents.create({ name: 'Sales', skills: skills === null ? null : [qualify.id] });
    show(client, <AgentEditorPage agent={agent} tools={[]} />, { search: { tab: 'skills' } });

    return { mock, qualify, invoice, refund, agent };
  };
  const saved = async (mock: ReturnType<typeof backend>['mock'], id: string) =>
    (await mock.ai.agents.list()).find((a) => a.id === id)?.skills;

  it('are every skill by default, with how many there are, and no list to pick from', async () => {
    await editor(null);
    expect(await screen.findByText('3 skills today, and any written later.')).toBeTruthy();
    expect((screen.getByRole('radio', { name: /All skills/ }) as HTMLInputElement).checked).toBe(true);
    expect(document.querySelector('[data-slot="chosen-skills"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add skills' })).toBeNull();
  });

  it('are the ones added, listed with when each is for, and added from a dialog with a search', async () => {
    const { mock, invoice, agent } = await editor([]);
    expect(await screen.findByText('1 skill')).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Chosen skills/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('tab', { name: /Skills1/ })).toBeTruthy();
    const chosen = within(document.querySelector('[data-slot="chosen-skills"]') as HTMLElement);
    expect(chosen.getByText('When asked about Qualify a lead')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add skills' }));
    const dialog = within(await screen.findByRole('dialog'));
    // Only the skills the agent lacks are offered, and the search narrows them.
    expect(dialog.queryByText('Qualify a lead')).toBeNull();
    expect(dialog.getByText('Invoice a client')).toBeTruthy();
    expect(dialog.getByText('Refund an order')).toBeTruthy();
    fireEvent.change(dialog.getByLabelText('Search skills'), { target: { value: 'invoice' } });
    expect(dialog.queryByText('Refund an order')).toBeNull();
    fireEvent.change(dialog.getByLabelText('Search skills'), { target: { value: 'nothing like it' } });
    expect(dialog.getByText('No skill matches.')).toBeTruthy();
    fireEvent.change(dialog.getByLabelText('Search skills'), { target: { value: 'invoice' } });
    expect((dialog.getByRole('button', { name: /^Add/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Invoice a client' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Add 1 skill' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('2 skills')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await saved(mock, agent.id))?.length).toBe(2));
    expect(await saved(mock, agent.id)).toContain(invoice.id);
  });

  it('are taken away one at a time', async () => {
    const { mock, agent } = await editor([]);
    await screen.findByText('1 skill');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Qualify a lead' }));
    expect(await screen.findByText('No skills yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await saved(mock, agent.id)).toEqual([]));
  });

  it('are chosen by switching to chosen skills and adding some', async () => {
    const { mock, refund, agent } = await editor(null);
    fireEvent.click(await screen.findByRole('radio', { name: /Chosen skills/ }));
    expect(await screen.findByText('No skills yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add skills' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Refund an order' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Add 1 skill' }));
    expect(await screen.findByText('1 skill')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await saved(mock, agent.id)).toEqual([refund.id]));
  });

  it('are every skill again by switching back to all skills', async () => {
    const { mock, agent } = await editor([]);
    fireEvent.click(await screen.findByRole('radio', { name: /All skills/ }));
    expect(await screen.findByText('3 skills today, and any written later.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await saved(mock, agent.id)).toBeNull());
  });
});
