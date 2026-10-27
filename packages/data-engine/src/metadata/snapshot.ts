import { indexSchema, type SchemaIndex, type WorkspaceSchema } from '@devias/core';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/exec';
import {
  commandItem,
  fieldMetadata,
  layout,
  module,
  navItem,
  objectMetadata,
  view,
  workspaceState,
} from '../db/schema';
import {
  toCommandItem,
  toFieldMetadata,
  toInstalledModule,
  toLayout,
  toNavItem,
  toObjectMetadata,
  toViewMetadata,
} from './rows';

/** One workspace's metadata at a given `metadata_version`, plus the derived index. */
export interface Snapshot {
  version: number;
  schema: WorkspaceSchema;
  index: SchemaIndex;
}

export const readMetadataVersion = async (db: Db, workspaceId: string): Promise<number | null> => {
  const rows = await db
    .select({ version: workspaceState.metadataVersion })
    .from(workspaceState)
    .where(eq(workspaceState.workspaceId, workspaceId));

  return rows[0]?.version ?? null;
};

export const loadSnapshot = async (db: Db, workspaceId: string): Promise<Snapshot> => {
  const version = (await readMetadataVersion(db, workspaceId)) ?? 0;
  const objects = (
    await db
      .select()
      .from(objectMetadata)
      .where(eq(objectMetadata.workspaceId, workspaceId))
      .orderBy(asc(objectMetadata.id))
  ).map(toObjectMetadata);
  const fields = (
    await db
      .select()
      .from(fieldMetadata)
      .where(eq(fieldMetadata.workspaceId, workspaceId))
      .orderBy(asc(fieldMetadata.position), asc(fieldMetadata.id))
  ).map(toFieldMetadata);
  const views = (
    await db.select().from(view).where(eq(view.workspaceId, workspaceId)).orderBy(asc(view.position), asc(view.id))
  ).map(toViewMetadata);
  const layouts = (
    await db.select().from(layout).where(eq(layout.workspaceId, workspaceId)).orderBy(asc(layout.id))
  ).map(toLayout);
  const navItems = (
    await db
      .select()
      .from(navItem)
      .where(eq(navItem.workspaceId, workspaceId))
      .orderBy(asc(navItem.position), asc(navItem.id))
  ).map(toNavItem);
  const commandItems = (
    await db.select().from(commandItem).where(eq(commandItem.workspaceId, workspaceId)).orderBy(asc(commandItem.id))
  ).map(toCommandItem);
  const modules = (
    await db.select().from(module).where(eq(module.workspaceId, workspaceId)).orderBy(asc(module.id))
  ).map(toInstalledModule);

  const schema: WorkspaceSchema = {
    workspaceId,
    version,
    objects,
    fields,
    views,
    layouts,
    navItems,
    commandItems,
    modules,
  };

  return { version, schema, index: indexSchema(schema) };
};

/** Per-process snapshot cache keyed by workspace; a one-row version read decides whether it is fresh. */
export class SnapshotCache {
  private readonly entries = new Map<string, Snapshot>();

  async get(db: Db, workspaceId: string): Promise<Snapshot> {
    const version = (await readMetadataVersion(db, workspaceId)) ?? 0;
    const cached = this.entries.get(workspaceId);

    if (cached && cached.version === version) {
      return cached;
    }

    const snapshot = await loadSnapshot(db, workspaceId);
    this.entries.set(workspaceId, snapshot);

    return snapshot;
  }

  invalidate(workspaceId: string): void {
    this.entries.delete(workspaceId);
  }
}
