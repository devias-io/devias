import {
  CommandActionSchema,
  type CommandItem,
  declarationsOf,
  type FieldMetadata,
  type InstalledModule,
  type Layout,
  LayoutActionSchema,
  ModuleManifestSchema,
  makeLayout,
  type NavItem,
  NavOverridesSchema,
  NavTargetSchema,
  type ObjectMetadata,
  RecordShellSchema,
  ViewConfigSchema,
  type ViewMetadata,
} from '@devias/core';
import { z } from 'zod';
import type { commandItem, fieldMetadata, layout, module, navItem, objectMetadata, view } from '../db/schema';

const opt = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

export const toObjectMetadata = (row: typeof objectMetadata.$inferSelect): ObjectMetadata => ({
  workspaceId: row.workspaceId,
  id: row.id,
  nameSingular: row.nameSingular,
  namePlural: row.namePlural,
  labelSingular: row.labelSingular,
  labelPlural: row.labelPlural,
  icon: opt(row.icon),
  description: opt(row.description),
  primaryFieldId: opt(row.primaryFieldId),
  isSystem: row.isSystem,
  readOnly: row.readOnly,
  deleteWhen: opt(row.deleteWhen),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  moduleId: row.moduleId,
});

export const toFieldMetadata = (row: typeof fieldMetadata.$inferSelect): FieldMetadata => ({
  workspaceId: row.workspaceId,
  objectId: row.objectId,
  id: row.id,
  name: row.name,
  type: row.type,
  label: row.label,
  description: opt(row.description),
  icon: opt(row.icon),
  settings: row.settings ?? {},
  isRequired: row.isRequired,
  isUnique: row.isUnique,
  defaultValue: row.defaultValue === null ? undefined : row.defaultValue,
  position: row.position,
  moduleId: row.moduleId,
});

export const toViewMetadata = (row: typeof view.$inferSelect): ViewMetadata => ({
  workspaceId: row.workspaceId,
  objectId: row.objectId,
  id: row.id,
  label: row.label,
  type: row.type,
  icon: opt(row.icon),
  isDefault: row.isDefault,
  position: row.position,
  config: ViewConfigSchema.parse(row.config ?? {}),
  moduleId: row.moduleId,
});

const ActionsSchema = z.array(LayoutActionSchema);

export const toLayout = (row: typeof layout.$inferSelect): Layout =>
  makeLayout(
    {
      workspaceId: row.workspaceId,
      objectId: row.objectId,
      id: row.id,
      label: row.label,
      kind: 'record',
      isDefault: row.isDefault,
      actions: ActionsSchema.parse(row.actions),
      moduleId: row.moduleId,
    },
    RecordShellSchema.parse(row.shell),
    row.content,
  );

export const toNavItem = (row: typeof navItem.$inferSelect): NavItem => ({
  workspaceId: row.workspaceId,
  id: row.id,
  label: row.label,
  icon: opt(row.icon),
  target: NavTargetSchema.parse(row.target),
  position: row.position,
  parentId: row.parentId,
  pinned: row.pinned,
  overrides: row.overrides ? NavOverridesSchema.parse(row.overrides) : null,
  moduleId: row.moduleId,
});

export const toCommandItem = (row: typeof commandItem.$inferSelect): CommandItem => ({
  workspaceId: row.workspaceId,
  id: row.id,
  label: row.label,
  icon: opt(row.icon),
  group: opt(row.groupName),
  shortcut: opt(row.shortcut),
  action: CommandActionSchema.parse(row.action),
  moduleId: row.moduleId,
});

/** The parts of a stored manifest the workspace schema shows (see `declarationsOf`). */
const InstalledDeclarationsSchema = ModuleManifestSchema.pick({
  name: true,
  description: true,
  icon: true,
  logo: true,
  website: true,
  publisher: true,
  engines: true,
  core: true,
  blocks: true,
  agents: true,
  connections: true,
  variables: true,
  actions: true,
  events: true,
  webhookHelp: true,
  policies: true,
});

export const toInstalledModule = (row: typeof module.$inferSelect): InstalledModule => {
  const parsed = InstalledDeclarationsSchema.safeParse(row.manifest);

  return {
    moduleId: row.moduleId,
    version: row.version,
    manifestHash: row.manifestHash,
    installedAt: row.installedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(parsed.success
      ? declarationsOf(parsed.data)
      : {
          name: row.moduleId,
          core: false,
          blocks: [],
          agents: [],
          connections: [],
          variables: [],
          actions: [],
          events: [],
        }),
  };
};
