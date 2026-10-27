import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

/**
 * Ids are stable, opaque identifiers that survive re-installs and are shared between a module's source code and
 * workspace metadata. The platform reads nothing out of one: who owns a row is its `moduleId`, and what a thing is
 * called is its `name`. What a module declares is a uuid by convention, what a workspace makes is a uuid v7, and the
 * platform's own constants are in `coreIds`, uuids like the rest.
 */
export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export const IdSchema = z
  .string()
  .min(3)
  .max(200)
  .regex(ID_PATTERN, 'Ids are lowercase letters, digits, "." "_" and "-"')
  .meta({ id: 'Id', description: 'Stable, opaque identifier shared by module source and workspace metadata' });

export type Id = z.infer<typeof IdSchema>;

export const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
/** What the platform's own constants are owned by: no module can use it as its id. */
export const CORE_OWNER = 'core';

export const ModuleIdSchema = z
  .string()
  .regex(MODULE_ID_PATTERN)
  .refine((id) => id !== CORE_OWNER, `"${CORE_OWNER}" is reserved for the platform's own constants`)
  .meta({ id: 'ModuleId' });
export type ModuleId = z.infer<typeof ModuleIdSchema>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether a value is a uuid: what a module's `ids.ts` holds (`devias id` makes them). */
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);

export const isId = (value: unknown): value is Id => typeof value === 'string' && ID_PATTERN.test(value);

/** Time-ordered UUID (v7) for every server-generated id: records, metadata rows, what a workspace makes. */
export const newId = (): string => uuidv7();
