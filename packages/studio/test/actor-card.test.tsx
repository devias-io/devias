import type { Member } from '@devias/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioConfigProvider } from '../src/providers/studio-config';
import { ActorName, actorOf } from '../src/record/activity/shared';
import { resolvedFixture } from '../src/testing';

afterEach(cleanup);

const ada: Member = {
  id: 'm1',
  userId: 'u1',
  role: 'admin',
  user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', image: null } as Member['user'],
};
const members = new Map([['u1', ada]]);
const agents = new Map([['a1', { name: 'Note taker', icon: 'notebook', description: 'Writes down what happens.' }]]);
const modules = new Map([['invoicing', 'Invoicing']]);

describe('who acted', () => {
  it('describes a member: their name, email and role', () => {
    expect(actorOf({ kind: 'user', id: 'u1' }, members, agents, modules)).toMatchObject({
      name: 'Ada Lovelace',
      parts: [{ name: 'Ada Lovelace', card: { kind: 'member', email: 'ada@example.com', role: 'admin' } }],
    });
  });

  it('splits an agent acting for a member in two: the agent, and the member, each with its own card', () => {
    const person = actorOf(
      { kind: 'agent', id: 'a1', onBehalfOf: { kind: 'user', id: 'u1' } },
      members,
      agents,
      modules,
    );
    expect(person.name).toBe('Note taker for Ada Lovelace');
    expect(person.parts).toMatchObject([
      { name: 'Note taker', card: { kind: 'agent', icon: 'notebook', description: 'Writes down what happens.' } },
      { name: 'Ada Lovelace', card: { kind: 'member', email: 'ada@example.com' } },
    ]);
  });

  it('describes a module’s code, and leaves a key or a workflow without a card', () => {
    expect(
      actorOf({ kind: 'module', id: 'invoicing', onBehalfOf: { kind: 'user', id: 'u1' } }, members, agents, modules)
        .parts,
    ).toMatchObject([
      { name: 'Invoicing', card: { kind: 'module' } },
      { name: 'Ada Lovelace', card: { kind: 'member' } },
    ]);
    expect(actorOf({ kind: 'workflow', id: 'w' }, members, agents, modules).parts).toEqual([{ name: 'A workflow' }]);
  });
});

const show = (person: ReturnType<typeof actorOf>) =>
  render(
    <StudioConfigProvider value={resolvedFixture()}>
      <ActorName person={person} />
    </StudioConfigProvider>,
  );

describe('the hover card', () => {
  const agentFor = () =>
    actorOf({ kind: 'agent', id: 'a1', onBehalfOf: { kind: 'user', id: 'u1' } }, members, agents, modules);

  it('shows a different card on each name: the agent’s on its name, the member’s on theirs', async () => {
    show(agentFor());
    fireEvent.pointerEnter(screen.getByText('Note taker'), { pointerType: 'mouse' });
    fireEvent.mouseMove(screen.getByText('Note taker'));
    fireEvent.mouseEnter(screen.getByText('Note taker'));
    expect(await screen.findByText('Writes down what happens.', undefined, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
    cleanup();
    show(agentFor());
    fireEvent.pointerEnter(screen.getByText('Ada Lovelace'), { pointerType: 'mouse' });
    fireEvent.mouseMove(screen.getByText('Ada Lovelace'));
    fireEvent.mouseEnter(screen.getByText('Ada Lovelace'));
    expect(await screen.findByText('ada@example.com', undefined, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
    expect(screen.queryByText('Writes down what happens.')).toBeNull();
  });

  it('reads as one sentence, and leaves a workflow without a card', () => {
    show(agentFor());
    expect(document.body.textContent).toBe('Note taker for Ada Lovelace');
    cleanup();
    show(actorOf({ kind: 'workflow', id: 'w' }, members, agents, modules));
    expect(document.querySelector('[data-slot="hover-card-trigger"]')).toBeNull();
  });
});
