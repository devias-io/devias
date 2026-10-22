import { describe, expect, it } from 'vitest';
import {
  actorString,
  agentContext,
  authorize,
  can,
  type EngineContext,
  moduleActorContext,
  PERMISSIONS,
  type Permission,
} from '../src';

const ws = 'ws1';
const user = (role: EngineContext['role']): EngineContext => ({
  workspaceId: ws,
  actor: { kind: 'user', id: 'u' },
  role,
});
const apiKey = (permissions?: Record<string, string[]>): EngineContext => ({
  workspaceId: ws,
  actor: { kind: 'api_key', id: 'k' },
  role: null,
  apiKeyPermissions: permissions,
});
const fn: EngineContext = { workspaceId: ws, actor: { kind: 'function', id: 'ext/function/f' }, role: null };
const system: EngineContext = { workspaceId: ws, actor: { kind: 'system', id: 'seed' }, role: null };

const allowed = (ctx: EngineContext): Permission[] => PERMISSIONS.filter((a) => can(ctx, a));

describe('permission policy', () => {
  it('owner and admin may do everything', () => {
    expect(allowed(user('owner'))).toEqual([...PERMISSIONS]);
    expect(allowed(user('admin'))).toEqual([...PERMISSIONS]);
  });

  it('member has record, metadata.read, event.read, member.read, notifications, may see and run modules and workflows, and connect their own accounts', () => {
    expect(allowed(user('member'))).toEqual([
      'record.read',
      'record.write',
      'metadata.read',
      'module.read',
      'module.run',
      'module.connect',
      'event.read',
      'member.read',
      'workflow.read',
      'workflow.run',
      'document.read',
      'document.write',
      'task.read',
      'task.write',
      'task.control',
      'notification.read',
      'notification.send',
    ]);
  });

  it('non-members may do nothing', () => {
    expect(allowed(user(null))).toEqual([]);
    expect(() => authorize(user(null), 'record.read')).toThrow(/Non-member/);
  });

  it('api keys follow their permission map and default to record:read', () => {
    expect(allowed(apiKey())).toEqual(['record.read']);
    expect(
      allowed(apiKey({ record: ['read', 'write'], metadata: ['read', 'write'], module: ['manage'], event: ['read'] })),
    ).toEqual(['record.read', 'record.write', 'metadata.read', 'metadata.write', 'module.manage', 'event.read']);
    expect(can(apiKey({ record: ['*'] }), 'record.write')).toBe(true);
    expect(can(apiKey({ record: ['read', 'write'] }), 'apikey.manage')).toBe(false);
    // A key is not a person: it can notify people but has no inbox, whatever its map says.
    expect(allowed(apiKey({ notification: ['send'] }))).toEqual(['notification.send']);
    expect(can(apiKey({ notification: ['read', '*'] }), 'notification.read')).toBe(false);
    // Documents need their own grant: the default key reads records only.
    expect(allowed(apiKey({ document: ['read'] }))).toEqual(['document.read']);
    expect(allowed(apiKey({ document: ['*'] }))).toEqual(['document.read', 'document.write']);
    expect(allowed(apiKey({ task: ['read'] }))).toEqual(['task.read']);
    expect(allowed(apiKey({ task: ['*'] }))).toEqual(['task.read', 'task.write', 'task.control']);
    expect(allowed(apiKey({ task: ['control'] }))).toEqual(['task.control']);
  });

  it('functions may do everything except managing keys, modules, the agent and workflows, connecting accounts or controlling task runs; system may do everything', () => {
    expect(allowed(fn)).toEqual(
      PERMISSIONS.filter((a) => !a.endsWith('.manage') && a !== 'module.connect' && a !== 'task.control'),
    );
    expect(allowed(system)).toEqual([...PERMISSIONS]);
  });

  it('workflows read and write records, run module actions and notify people, nothing else', () => {
    const workflow: EngineContext = { workspaceId: ws, actor: { kind: 'workflow', id: 'wf_1' }, role: null };
    expect(allowed(workflow)).toEqual([
      'record.read',
      'record.write',
      'metadata.read',
      'module.run',
      'event.read',
      'document.read',
      'document.write',
      'task.read',
      'task.write',
      'notification.send',
    ]);
    expect(can(apiKey({ workflow: ['read', 'run'] }), 'workflow.run')).toBe(true);
    expect(can(apiKey({ workflow: ['read', 'run'] }), 'workflow.manage')).toBe(false);
    expect(() => authorize(workflow, 'workflow.manage')).toThrow(/Workflow wf_1/);
  });

  it('read-only objects deny writes for members and api keys but not admins, functions or the system', () => {
    const object = { readOnly: true, nameSingular: 'audit', id: 'acme.audit' };
    expect(can(user('member'), 'record.write', { object })).toBe(false);
    expect(can(apiKey({ record: ['read', 'write'] }), 'record.write', { object })).toBe(false);
    expect(can(user('admin'), 'record.write', { object })).toBe(true);
    expect(can(fn, 'record.write', { object })).toBe(true);
    expect(can(system, 'record.write', { object })).toBe(true);
    expect(can(user('member'), 'record.read', { object })).toBe(true);
    expect(() => authorize(user('member'), 'record.write', { object })).toThrow(/audit/);
  });

  it('lets module code do what function code does, and records who it acts for', () => {
    const person = { readOnly: false, nameSingular: 'person', id: 'crm.person' };
    const module = moduleActorContext(ws, 'invoicing');
    expect(module.actor).toEqual({ kind: 'module', id: 'invoicing' });
    expect(allowed(module)).toEqual(
      PERMISSIONS.filter((a) => !a.endsWith('.manage') && a !== 'module.connect' && a !== 'task.control'),
    );
    expect(can(module, 'record.write', { object: person })).toBe(true);
    expect(can(module, 'module.manage')).toBe(false);
    // Acting for someone records them and changes nothing else.
    const onBehalf = moduleActorContext(ws, 'reports', 'u_ada');
    expect(onBehalf.actor).toEqual({ kind: 'module', id: 'reports', onBehalfOf: { kind: 'user', id: 'u_ada' } });
    expect(allowed(onBehalf)).toEqual(allowed(module));
  });

  it('lets an agent act with the role of the person it acts for, nothing narrower', () => {
    expect(allowed(agentContext(user('owner'), 'agent-1'))).toEqual([...PERMISSIONS]);
    expect(allowed(agentContext(user('member'), 'agent-1'))).toEqual(allowed(user('member')));
    expect(() => authorize(agentContext(user('member'), 'agent-1'), 'metadata.write')).toThrow(
      /agent acting for a workspace member/i,
    );
    const orphan: EngineContext = { workspaceId: ws, actor: { kind: 'agent', id: 'agent-1' }, role: 'owner' };
    expect(allowed(orphan)).toEqual([]);
    const object = { readOnly: true, nameSingular: 'audit', id: 'acme.audit' };
    expect(can(agentContext(user('member'), 'agent-1'), 'record.write', { object })).toBe(false);
  });

  it('only builds agents for signed-in people, and records both in history', () => {
    expect(() => agentContext(apiKey(), 'agent-1')).toThrow(/signed-in/);
    expect(actorString(agentContext(user('admin'), 'agent-1').actor)).toBe('agent:agent-1@user:u');
    expect(actorString({ kind: 'user', id: 'u' })).toBe('user:u');
    expect(actorString(moduleActorContext(ws, 'google', 'u').actor)).toBe('module:google@user:u');
  });
});
