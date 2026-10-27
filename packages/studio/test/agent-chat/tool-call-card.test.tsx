import {
  ActionDefinitionSchema,
  type Connection,
  type DeviasClient,
  defineBlockComponent,
  type InstalledModule,
  type ToolCall,
  type WorkspaceSchema,
} from '@devias/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCallCard } from '../../src/agent-chat/chat/tool-call-card';
import { createFakeClient, recordsFixture, resolvedFixture, schemaFixture, TestProviders } from '../../src/testing';

afterEach(cleanup);

const asking: ToolCall = {
  id: 'call1',
  toolUseId: 'tu1',
  name: 'connect_module',
  input: { module: '01a1751f-5f0c-7611-94cf-03db7e1f9fa4' },
  status: 'pending',
  requiresApproval: true,
  inputRequest: {
    title: 'Resend settings',
    fields: [
      { name: 'api_key', label: 'API key', secret: true, required: true },
      { name: 'webhook_secret', label: 'Webhook signing secret', secret: true, required: false },
    ],
  },
};

/** The card reads the workspace schema to say what a call did, so it renders inside the providers. */
const show = (ui: ReactElement) =>
  render(
    <TestProviders client={createFakeClient(schemaFixture(), recordsFixture())} schema={schemaFixture()}>
      {ui}
    </TestProviders>,
  );

/** A call that has run, from the pieces that differ. */
const ran = (over: Partial<ToolCall> & Pick<ToolCall, 'name'>): ToolCall => ({
  ...asking,
  status: 'executed',
  requiresApproval: false,
  inputRequest: undefined,
  ...over,
});

describe('tool call card', () => {
  it("is a quiet row once it has run, with the tool's input and result behind technical details", () => {
    const call = ran({
      name: 'aggregate_records',
      input: { object: 'quote', measures: [{ fn: 'count' }] },
      result: { object: 'quote', truncated: false, groups: [] },
    });
    const { container } = show(<ToolCallCard call={call} />);
    const card = container.querySelector('[data-slot="tool-call"]') as HTMLElement;
    expect(card.getAttribute('data-status')).toBe('executed');
    expect(screen.getByText('Aggregate records')).toBeTruthy();
    // Nothing to decide, so nothing but the row: no buttons, and the details stay closed.
    expect(container.querySelector('[data-action]')).toBeNull();
    expect(screen.queryByText('Input')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Aggregate records/ }));
    // The tool's own input and result are behind a link of their own, not the first thing shown.
    expect(screen.queryByText('Input')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));
    expect(screen.getByText('Input')).toBeTruthy();
    expect(screen.getByText('Result')).toBeTruthy();
    // An object is label and value pairs; a nested value is JSON on one line.
    const [input, result] = Array.from(container.querySelectorAll('[data-slot="tool-call-details"]')) as [
      HTMLElement,
      HTMLElement,
    ];
    expect(within(input).getByText('object').nextElementSibling?.textContent).toBe('quote');
    expect(within(input).getByText('measures').nextElementSibling?.textContent).toBe('[{"fn":"count"}]');
    expect(within(result).getByText('groups').nextElementSibling?.textContent).toBe('None');
  });

  it('says what an update did as a sentence, with the record as a link and the fields as the app shows them', () => {
    const call = ran({
      name: 'update_record',
      input: { object: 'person', id: 'p1', patch: { stage: 'won', email: null } },
      result: { updated: true, object: 'person', id: 'p1', label: 'Ada Lovelace', link: 'record:person/p1' },
    });
    const { container } = show(<ToolCallCard call={call} />);
    const row = screen.getByRole('button', { name: /Updated/ });
    expect(row.textContent).toContain('Updated Ada Lovelace');
    fireEvent.click(row);
    const changes = container.querySelector('[data-slot="tool-call-changes"]') as HTMLElement;
    // The select's label, not its stored value; a cleared field says so.
    expect(within(changes).getByText('Stage').nextElementSibling?.textContent).toBe('Won');
    expect(within(changes).getByText('Email').nextElementSibling?.textContent).toBe('Cleared');
    const link = container.querySelector('[data-slot="tool-call-record"]') as HTMLAnchorElement;
    expect(link.textContent).toBe('Ada Lovelace');
    expect(link.getAttribute('href')).toContain('/person/p1');
    // None of it is JSON until asked for.
    expect(container.querySelector('pre')).toBeNull();
    expect(screen.queryByText('Result')).toBeNull();
  });

  it('says what a lookup found, with a link to each record', () => {
    const call = ran({
      name: 'lookup_records',
      input: { text: 'ada', objects: ['person'] },
      result: { hits: [{ object: 'person', id: 'p1', label: 'Ada Lovelace', subtitle: 'Engineer' }] },
    });
    const { container } = show(<ToolCallCard call={call} />);
    const row = screen.getByRole('button', { name: /Searched/ });
    expect(row.textContent).toContain('Searched people for “ada” · 1 match');
    fireEvent.click(row);
    const found = container.querySelector('[data-slot="tool-call-found"]') as HTMLElement;
    expect(found.textContent).toContain('Ada Lovelace');
    expect(found.textContent).toContain('Engineer');
    expect(found.querySelector('a')?.getAttribute('href')).toContain('/person/p1');
  });

  it('counts in the singular and the plural', () => {
    const none = ran({ name: 'other_tool', result: { hits: [{}] } });
    show(<ToolCallCard call={none} />);
    expect(screen.getByRole('button', { name: /Other tool/ }).textContent).toContain('1 hit');
    expect(screen.getByRole('button', { name: /Other tool/ }).textContent).not.toContain('1 hits');
  });

  it('gives the whole answer of a call with no plain version, still without its raw data', () => {
    const call = ran({
      name: 'send_email',
      input: { to: 'ada@example.com' },
      result: { message: 'Email sent to ada@example.com, from the sales address.' },
    });
    show(<ToolCallCard call={call} />);
    fireEvent.click(screen.getByRole('button', { name: /Send email/ }));
    expect(screen.getAllByText(/from the sales address/).length).toBe(2);
    expect(screen.queryByText('Input')).toBeNull();
    expect(screen.getByRole('button', { name: 'Technical details' })).toBeTruthy();
  });

  it('names the module of a module’s tool, which it finds by the action’s name', () => {
    const resend: InstalledModule = {
      id: '01a1751f-5f0c-7611-94cf-03db7e1f9fa4',
      version: '0.1.0',
      manifestHash: 'h',
      installedAt: '2026-10-25T00:00:00.000Z',
      updatedAt: '2026-10-25T00:00:00.000Z',
      label: 'Resend',
      core: false,
      blocks: [],
      agents: [],
      skills: [],
      connections: [],
      variables: [],
      actions: [
        ActionDefinitionSchema.parse({
          id: '01a1751f-5f0c-7611-94ce-f47a49eb9b39',
          name: 'send_email',
          label: 'Send an email',
        }),
      ],
      events: [],
    };
    const schema: WorkspaceSchema = { ...schemaFixture(), modules: [resend] };
    const call = ran({ name: 'send_email', result: { message: 'Email sent.' } });
    render(
      <TestProviders client={createFakeClient(schema, recordsFixture())} schema={schema}>
        <ToolCallCard call={call} />
      </TestProviders>,
    );
    expect(screen.getByRole('button', { name: /Send email/ }).textContent).toContain(
      '01a1751f-5f0c-7611-94cf-03db7e1f9fa4 · Email sent.',
    );
    cleanup();
    // A tool of no module's action has none to name.
    show(<ToolCallCard call={call} />);
    expect(screen.getByRole('button', { name: /Send email/ }).textContent).not.toContain(
      '01a1751f-5f0c-7611-94cf-03db7e1f9fa4',
    );
  });

  it('shows what a call waiting for approval will do, with its reason, before it is answered', () => {
    const onResolve = vi.fn();
    const call: ToolCall = {
      ...asking,
      name: 'delete_records',
      inputRequest: undefined,
      input: { object: 'person', ids: ['p1', 'p2'], limit: 20 },
      reason: 'Deleting records cannot be undone.',
    };
    const { container } = show(<ToolCallCard call={call} onResolve={onResolve} />);
    expect(screen.getByText('Needs approval')).toBeTruthy();
    expect(screen.getByText('Deleting records cannot be undone.')).toBeTruthy();
    // What is about to run is a sentence, then, without asking, as it was given.
    expect(screen.getByRole('button', { name: /Delete/ }).textContent).toContain('Delete 2 people');
    expect(screen.getByText('Details')).toBeTruthy();
    expect(screen.getByText('limit').nextElementSibling?.textContent).toBe('20');
    expect(screen.queryByText('Technical details')).toBeNull();
    fireEvent.click(container.querySelector('[data-action="approve"]') as HTMLButtonElement);
    expect(onResolve).toHaveBeenCalledWith(true);
  });

  it('does not say a call needs approval while it streams in, before the server has asked anyone', () => {
    const { container } = show(
      <ToolCallCard call={{ ...asking, inputRequest: undefined, requiresApproval: false, input: '{"obj' }} />,
    );
    expect(screen.queryByText('Needs approval')).toBeNull();
    expect(container.querySelector('[data-slot="tool-call"][data-status="running"]')).toBeTruthy();
    cleanup();
    // The same call once the server has asked is a card waiting for the person.
    show(
      <ToolCallCard
        call={{ ...asking, inputRequest: undefined, input: { module: '01a1751f-5f0c-7611-94cf-03db7e1f9fa4' } }}
        onResolve={() => {}}
      />,
    );
    expect(screen.getByText('Needs approval')).toBeTruthy();
  });

  it('asks a question with options as one-click answers, an own-answer box and Skip', () => {
    const question: ToolCall = {
      ...asking,
      name: 'ask_user',
      input: { question: 'Which pipeline?' },
      inputRequest: {
        title: 'Which pipeline?',
        fields: [{ name: 'answer', label: 'Your answer', secret: false, required: true }],
        question: {
          options: [
            { value: 'Sales', label: 'Sales', description: 'New deals' },
            { value: 'Renewals', label: 'Renewals' },
          ],
          other: true,
        },
      },
    };
    const onResolve = vi.fn();
    show(<ToolCallCard call={question} onResolve={onResolve} />);
    // A card of its own, not a row that opens: no status chip, the question is the sentence.
    expect(screen.queryByText('Needs your answer')).toBeNull();
    const form = within(document.querySelector('[data-slot="question"]') as HTMLElement);
    expect(form.getByText('Which pipeline?')).toBeTruthy();
    expect(form.getByText('New deals')).toBeTruthy();
    // The agent sees the answer, so this is not the secure form that says it won't.
    expect(screen.queryByText(/won't see/)).toBeNull();
    fireEvent.click(form.getByRole('button', { name: /Sales/ }));
    expect(onResolve).toHaveBeenLastCalledWith(true, { answer: 'Sales' });
    // The number keys answer too, from the card but not while typing an answer of their own.
    fireEvent.keyDown(form.getByRole('button', { name: /Renewals/ }), { key: '2' });
    expect(onResolve).toHaveBeenLastCalledWith(true, { answer: 'Renewals' });
    onResolve.mockClear();
    fireEvent.keyDown(form.getByLabelText('Your own answer'), { key: '1' });
    expect(onResolve).not.toHaveBeenCalled();
    // An answer of their own, only once something is typed.
    const send = form.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(form.getByLabelText('Your own answer'), { target: { value: ' Partners ' } });
    fireEvent.click(send);
    expect(onResolve).toHaveBeenLastCalledWith(true, { answer: 'Partners' });
    fireEvent.click(form.getByRole('button', { name: 'Skip' }));
    expect(onResolve).toHaveBeenLastCalledWith(false);
  });

  it('shows only the options when the agent allows no answer of their own, and a box for an open question', () => {
    const base: ToolCall = {
      ...asking,
      name: 'ask_user',
      input: { question: 'Send it?' },
      inputRequest: {
        title: 'Send it?',
        fields: [{ name: 'answer', label: 'Your answer', secret: false, required: true }],
        question: { options: [{ value: 'Yes', label: 'Yes' }], other: false },
      },
    };
    show(<ToolCallCard call={base} onResolve={() => {}} />);
    expect(screen.queryByLabelText('Your own answer')).toBeNull();
    cleanup();
    show(
      <ToolCallCard
        call={{
          ...base,
          inputRequest: {
            ...base.inputRequest,
            title: 'Name?',
            fields: [],
            question: { options: [], other: true },
          } as never,
        }}
        onResolve={() => {}}
      />,
    );
    expect(screen.getByLabelText('Your answer')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Options' })).toBeNull();
  });

  it('reads a question as a quiet row once answered or skipped', () => {
    const { container } = show(
      <ToolCallCard
        call={{
          ...asking,
          name: 'ask_user',
          input: { question: 'Which pipeline?' },
          inputRequest: undefined,
          status: 'executed',
          requiresApproval: true,
          result: { answer: 'Sales' },
        }}
      />,
    );
    expect(container.textContent).toContain('Which pipeline?');
    expect(container.textContent).toContain('Answered: Sales');
    cleanup();
    const skipped = show(
      <ToolCallCard
        call={{
          ...asking,
          name: 'ask_user',
          input: { question: 'Which pipeline?' },
          inputRequest: undefined,
          status: 'rejected',
        }}
      />,
    );
    expect(skipped.container.textContent).toContain('Skipped');
  });

  it('says why a call failed under its name', () => {
    const call = ran({
      name: 'update_record',
      status: 'failed',
      isError: true,
      input: { object: 'person', id: 'p9', patch: {} },
      result: { error: { message: 'Person p9 not found in this workspace.' } },
    });
    show(<ToolCallCard call={call} />);
    expect(screen.getByRole('button', { name: /Update/ }).textContent).toContain('Update a person');
    expect(screen.getByText('Person p9 not found in this workspace.')).toBeTruthy();
  });

  it('asks for the values in a form instead of a plain approval, and sends only what was typed', () => {
    const onResolve = vi.fn();
    const { container } = show(<ToolCallCard call={asking} onResolve={onResolve} />);
    expect(screen.getByText('Resend settings')).toBeTruthy();
    expect(screen.getByText(/won't see what you type/)).toBeTruthy();
    const key = screen.getByLabelText('API key') as HTMLInputElement;
    expect(key.type).toBe('password');
    const save = container.querySelector('[data-action="approve"]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(key, { target: { value: 're_secret' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onResolve).toHaveBeenCalledWith(true, { api_key: 're_secret' });
    expect(key.value).toBe('');

    fireEvent.click(container.querySelector('[data-action="reject"]') as HTMLButtonElement);
    expect(onResolve).toHaveBeenLastCalledWith(false);
  });

  it('shows a value produced for the person once, with a way to copy it', () => {
    const call: ToolCall = {
      ...asking,
      name: 'create_api_key',
      status: 'executed',
      inputRequest: undefined,
      result: { id: 'k1', name: 'ci' },
      revealed: [{ label: 'API key "ci"', value: 'devias_abc123' }],
    };
    const { container } = show(<ToolCallCard call={call} />);
    const revealed = container.querySelector('[data-slot="revealed"]');

    if (!revealed) {
      throw new Error('nothing revealed');
    }

    expect(revealed.textContent).toContain('API key "ci"');
    expect((revealed.querySelector('input') as HTMLInputElement).value).toBe('devias_abc123');
    expect(revealed.textContent).toContain('shown only once');
  });

  it('shows what installing a module allows, and installing is the approval', () => {
    const onResolve = vi.fn();
    const call: ToolCall = {
      ...asking,
      name: 'install_module',
      input: { module: '01a1751f-5f0b-70b0-8818-9290a78dd45b' },
      inputRequest: {
        title: 'Install Ledger',
        description: 'Work orders and sites for trades.',
        fields: [],
        consent: {
          module: '01a1751f-5f0b-70b0-8818-9290a78dd45b',
          label: 'Ledger',
          version: '0.1.0',
          fromVersion: null,
          policies: [{ description: 'Entries over 5,000 need review.', decision: 'review' }],
          changes: ['Adds 2 objects, 13 fields'],
          manifestHash: 'h1',
        },
      },
    };
    const { container } = render(
      <TestProviders client={createFakeClient(schemaFixture(), recordsFixture())} schema={schemaFixture()}>
        <ToolCallCard call={call} onResolve={onResolve} />
      </TestProviders>,
    );
    const card = container.querySelector('[data-slot="consent-request"]') as HTMLElement;
    expect(card.textContent).toContain('Install Ledger');
    expect(card.textContent).toContain('v0.1.0');
    expect(card.textContent).toContain('Adds 2 objects, 13 fields');
    expect(card.textContent).toContain('Entries over 5,000 need review.');
    // No form: nothing is typed, the card itself is the consent.
    expect(container.querySelector('[data-slot="input-request"]')).toBeNull();
    // The header is a button too, named after the call, so the install button is the one named exactly that.
    fireEvent.click(screen.getByRole('button', { name: /^Install$/ }));
    expect(onResolve).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(onResolve).toHaveBeenLastCalledWith(false);
  });

  it('opens the consent page for an account and approves once the account is connected', async () => {
    const connected: Connection = {
      id: 'conn-1',
      moduleId: '01a1751f-5f0c-7611-94cf-04aad0105afe',
      providerId: '01a1751f-5f0c-7611-94cf-04aad0105afe',
      kind: 'oauth2',
      visibility: 'user',
      ownerUserId: 'u1',
      label: null,
      account: 'ada@example.com',
      status: 'connected',
      hints: {},
      scopes: ['email'],
      expiresAt: null,
      lastError: null,
      authFailedAt: null,
      lastTestedAt: null,
      lastUsedAt: null,
      webhookPath: null,
      createdBy: 'user:u1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    let made = false;
    const connections = {
      list: vi.fn(async () => ({ providers: [], connections: made ? [connected] : [] })),
      authorize: vi.fn(async () => {
        made = true;

        return { url: 'https://accounts.example/consent?state=s1' };
      }),
    };
    const base = createFakeClient(schemaFixture(), recordsFixture());
    const client = {
      ...base,
      modules: { ...base.modules, connections: { ...base.modules.connections, ...connections } },
    } as DeviasClient;
    const popup = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const onResolve = vi.fn();
    const call: ToolCall = {
      ...asking,
      input: { module: '01a1751f-5f0c-7611-94cf-04aad0105afe' },
      inputRequest: {
        title: 'Connect your Google account',
        fields: [],
        connect: {
          module: '01a1751f-5f0c-7611-94cf-04aad0105afe',
          provider: '01a1751f-5f0c-7611-94cf-04aad0105afe',
          visibility: 'user',
          label: 'Google account',
        },
      },
    };
    render(
      <TestProviders client={client} schema={schemaFixture()}>
        <ToolCallCard call={call} onResolve={onResolve} />
      </TestProviders>,
    );
    expect(screen.getByText(/the agent never\s+sees it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Connect Google account/ }));
    await waitFor(() => expect(popup.location.href).toBe('https://accounts.example/consent?state=s1'));
    expect(connections.authorize).toHaveBeenCalledWith({
      module: '01a1751f-5f0c-7611-94cf-04aad0105afe',
      provider: '01a1751f-5f0c-7611-94cf-04aad0105afe',
      visibility: 'user',
    });
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(true), { timeout: 4000 });
    open.mockRestore();
  });
});

describe("a module's approval widget", () => {
  const waiting: ToolCall = {
    ...asking,
    name: 'delete_records',
    inputRequest: undefined,
    input: { object: 'person', ids: ['p1'] },
    reason: 'It read content from outside the workspace.',
  };

  /** A widget for `delete_records` that draws the call's input and its own two buttons. */
  const widget = (tools: string[] = ['delete_records']) =>
    defineBlockComponent({
      id: '01a1751f-5f0c-7611-94ce-fb1955487cc1',
      label: 'Confirm delete',
      icon: 'trash-2',
      surfaces: { approval: { tools } },
      component: ({ call, busy, approve, reject }) => (
        <div data-slot="widget">
          <span>About to delete {String((call.input as { ids: string[] }).ids.length)} person</span>
          <button type="button" disabled={busy} onClick={approve}>
            Yes, delete
          </button>
          <button type="button" disabled={busy} onClick={reject}>
            No
          </button>
        </div>
      ),
    });

  const showWith = (blocks: ReturnType<typeof widget>[], ui: ReactElement) =>
    render(
      <TestProviders
        client={createFakeClient(schemaFixture(), recordsFixture())}
        schema={schemaFixture()}
        config={resolvedFixture({ blocks })}
      >
        {ui}
      </TestProviders>,
    );

  it('is drawn instead of the Approve / Reject card, and answers through the two functions it is given', () => {
    const onResolve = vi.fn();
    const { container } = showWith([widget()], <ToolCallCard call={waiting} onResolve={onResolve} />);
    expect(container.querySelector('[data-slot="widget"]')).toBeTruthy();
    expect(screen.getByText('About to delete 1 person')).toBeTruthy();
    // The default card's buttons are not there.
    expect(container.querySelector('[data-action]')).toBeNull();
    // Why it asks and the call's raw data stay the studio's, whatever the widget draws.
    expect(screen.getByText('It read content from outside the workspace.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Technical details' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(onResolve).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onResolve).toHaveBeenLastCalledWith(false);
  });

  it('is only used for the tools it names, and only while the call waits and can be answered', () => {
    const onResolve = vi.fn();
    // Another tool's widget: the default card.
    const other = showWith([widget(['update_record'])], <ToolCallCard call={waiting} onResolve={onResolve} />);
    expect(other.container.querySelector('[data-slot="widget"]')).toBeNull();
    expect(other.container.querySelector('[data-action="approve"]')).toBeTruthy();
    other.unmount();

    // Nothing to answer with (a read-only view): the default card.
    const readOnly = showWith([widget()], <ToolCallCard call={waiting} />);
    expect(readOnly.container.querySelector('[data-slot="widget"]')).toBeNull();
    readOnly.unmount();

    // Already answered: the row.
    const done = showWith([widget()], <ToolCallCard call={{ ...waiting, status: 'executed' }} onResolve={onResolve} />);
    expect(done.container.querySelector('[data-slot="widget"]')).toBeNull();
  });

  it('leaves a call that asks for secrets or consent to its own form', () => {
    const asksForKey = { ...asking, name: 'delete_records' };
    const { container } = showWith([widget()], <ToolCallCard call={asksForKey} onResolve={vi.fn()} />);
    expect(container.querySelector('[data-slot="widget"]')).toBeNull();
    expect(container.querySelector('[data-slot="input-request"]')).toBeTruthy();
  });

  it('falls back to the Approve / Reject card when the widget fails, so the call is never stuck', () => {
    const broken = defineBlockComponent({
      id: '01a1751f-5f0c-7611-94ce-fdc819d0bdf4',
      label: 'Broken',
      icon: 'bug',
      surfaces: { approval: { tools: ['delete_records'] } },
      component: () => {
        throw new Error('widget bug');
      },
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onResolve = vi.fn();
    const { container } = showWith([broken], <ToolCallCard call={waiting} onResolve={onResolve} />);
    fireEvent.click(container.querySelector('[data-action="approve"]') as HTMLButtonElement);
    expect(onResolve).toHaveBeenCalledWith(true);
    log.mockRestore();
  });
});
