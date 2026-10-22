import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

/**
 * Ids are stable, human-readable identifiers that survive re-installs and are shared between a module's source code
 * and workspace metadata. An id is `<owner>.<key>`; the owner is a module id, `core` or `workspace`.
 *
 * Module-owned:  `acme.person`, `acme.person.email`, `acme.person.all`, `acme.sendEmail`
 * Platform operations:  `core.update_record`
 * Workspace-owned:  `workspace.<uuidv7>` (created from the settings UI)
 */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9_-]+)+$/;

export const IdSchema = z
  .string()
  .min(3)
  .max(200)
  .regex(ID_PATTERN, 'Ids look like "<module>.<key>" or "workspace.<uuid>"')
  .meta({ id: 'Id', description: 'Stable identifier shared by module source and workspace metadata' });

export type Id = z.infer<typeof IdSchema>;

export const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
/** The owner prefix of workspace-owned ids; no module can use it as its id. */
export const WORKSPACE_OWNER = 'workspace';
/** The owner of the platform's own operations (`core.update_record`); no module can use it as its id either. */
export const CORE_OWNER = 'core';

export const ModuleIdSchema = z
  .string()
  .regex(MODULE_ID_PATTERN)
  .refine((id) => id !== WORKSPACE_OWNER, `"${WORKSPACE_OWNER}" is reserved for workspace-owned entities`)
  .refine((id) => id !== CORE_OWNER, `"${CORE_OWNER}" is reserved for the platform's own operations`)
  .meta({ id: 'ModuleId' });
export type ModuleId = z.infer<typeof ModuleIdSchema>;

export const isId = (value: unknown): value is Id => typeof value === 'string' && ID_PATTERN.test(value);

/** Time-ordered UUID (v7) for every server-generated id: records, metadata rows, workspace-owned ids. */
export const newId = (): string => uuidv7();

/** Id for an entity created from the settings UI rather than a module. */
export const newWorkspaceId = (): Id => `${WORKSPACE_OWNER}.${newId()}`;

/** Which module owns an id, or `null` for workspace-owned ids. */
export const moduleOfId = (id: Id): ModuleId | null => {
  const prefix = id.slice(0, id.indexOf('.'));

  return prefix === WORKSPACE_OWNER ? null : prefix;
};
