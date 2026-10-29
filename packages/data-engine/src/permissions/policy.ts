import { type ObjectMetadata, PERMISSIONS, type Permission, WORKFLOW_PERMISSIONS } from '@devias/core';
import type { EngineContext, WorkspaceRole } from '../context';
import { EngineError } from '../errors';

export { PERMISSIONS, type Permission };

const ALL = new Set<Permission>(PERMISSIONS);

const ROLE_PERMISSIONS: Record<WorkspaceRole, Set<Permission>> = {
  owner: ALL,
  admin: ALL,
  member: new Set<Permission>([
    'record.read',
    'record.write',
    'metadata.read',
    'event.read',
    'member.read',
    'workflow.read',
    'workflow.run',
    'document.read',
    'document.write',
    'asset.read',
    'asset.write',
    'task.read',
    'task.write',
    'task.control',
    'module.read',
    'module.run',
    'module.connect',
    'notification.read',
    'notification.send',
  ]),
};

const MANAGE_ONLY = new Set<Permission>([
  'apikey.manage',
  'module.manage',
  'ai.manage',
  'workflow.manage',
  'member.manage',
  'task.control',
]);

/** Module code and functions act as themselves, never as a person, so they connect no accounts. */
const FUNCTION_PERMISSIONS = new Set<Permission>(
  PERMISSIONS.filter((a) => !MANAGE_ONLY.has(a) && a !== 'module.connect'),
);

/** Workflow steps read and write records and run modules' actions; see `WORKFLOW_PERMISSIONS` in core. */
const WORKFLOW_ALLOWED = new Set<Permission>(WORKFLOW_PERMISSIONS);

/** Api key permission maps look like `{ record: ['read', 'write'], module: ['manage'] }`. */
const API_KEY_GRANTS: Record<Permission, [resource: string, verb: string] | null> = {
  'record.read': ['record', 'read'],
  'record.write': ['record', 'write'],
  'metadata.read': ['metadata', 'read'],
  'metadata.write': ['metadata', 'write'],
  'module.read': ['module', 'read'],
  'module.run': ['module', 'run'],
  'module.connect': ['module', 'connect'],
  'module.manage': ['module', 'manage'],
  'event.read': ['event', 'read'],
  'member.read': ['member', 'read'],
  'member.manage': null,
  'apikey.manage': null,
  'ai.manage': null,
  'workflow.read': ['workflow', 'read'],
  'workflow.run': ['workflow', 'run'],
  'workflow.manage': ['workflow', 'manage'],
  'document.read': ['document', 'read'],
  'document.write': ['document', 'write'],
  'asset.read': ['asset', 'read'],
  'asset.write': ['asset', 'write'],
  'task.read': ['task', 'read'],
  'task.write': ['task', 'write'],
  'task.control': ['task', 'control'],
  // Notifications belong to a person; a key is not one, so it reads none and can only send.
  'notification.read': null,
  'notification.send': ['notification', 'send'],
};

export const DEFAULT_API_KEY_PERMISSIONS: Record<string, string[]> = { record: ['read'] };

export interface AuthorizeOptions {
  /**
   * The object a record operation targets: `readOnly` objects deny writes for members and api keys.
   */
  object?: Pick<ObjectMetadata, 'readOnly' | 'nameSingular' | 'id'> | undefined;
}

/** Pure decision: may this caller perform `permission`? */
export const can = (ctx: EngineContext, permission: Permission, options: AuthorizeOptions = {}): boolean => {
  const { actor } = ctx;

  if (permission === 'record.write' && options.object?.readOnly) {
    if (actor.kind === 'api_key') {
      return false;
    }

    if ((actor.kind === 'user' || actor.kind === 'agent') && ctx.role === 'member') {
      return false;
    }
  }

  switch (actor.kind) {
    case 'system':
      return true;
    case 'function':
      return FUNCTION_PERMISSIONS.has(permission);
    case 'module':
      return FUNCTION_PERMISSIONS.has(permission);
    case 'workflow':
      return WORKFLOW_ALLOWED.has(permission);
    case 'user':
      return ctx.role !== null && ROLE_PERMISSIONS[ctx.role].has(permission);
    case 'agent':
      // An agent acts for a person, with their role.
      return actor.onBehalfOf !== undefined && ctx.role !== null && ROLE_PERMISSIONS[ctx.role].has(permission);
    case 'api_key': {
      const grant = API_KEY_GRANTS[permission];

      if (!grant) {
        return false;
      }

      const permissions = ctx.apiKeyPermissions ?? DEFAULT_API_KEY_PERMISSIONS;
      const verbs = permissions[grant[0]] ?? [];

      return verbs.includes(grant[1]) || verbs.includes('*');
    }
    default:
      return false;
  }
};

/** The single choke point: throws FORBIDDEN when the caller may not perform `permission`. */
export const authorize = (ctx: EngineContext, permission: Permission, options: AuthorizeOptions = {}): void => {
  if (can(ctx, permission, options)) {
    return;
  }

  const target = options.object ? ` on "${options.object.nameSingular}"` : '';

  throw new EngineError('FORBIDDEN', `${describeActor(ctx)} may not perform ${permission}${target}`);
};

const describeActor = (ctx: EngineContext): string => {
  switch (ctx.actor.kind) {
    case 'user':
      return ctx.role ? `Workspace ${ctx.role}` : 'Non-member';
    case 'api_key':
      return 'Api key';
    case 'function':
      return `Function ${ctx.actor.id}`;
    case 'module':
      return `Module ${ctx.actor.id}`;
    case 'workflow':
      return `Workflow ${ctx.actor.id}`;
    case 'agent':
      return `An agent acting for a workspace ${ctx.role}`;
    default:
      return 'System';
  }
};
