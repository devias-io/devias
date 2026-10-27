import {
  type ApplyOptions,
  type ApplyResult,
  type FieldDefinition,
  hashManifest,
  type InstalledModule,
  layoutContentOf,
  type ModuleManifest,
  type PlanChange,
  type PlanResult,
  parseManifest,
  ViewConfigSchema,
} from '@devias/core';
import { and, eq } from 'drizzle-orm';
import { actorString, type EngineContext } from '../context';
import type { DataSource } from '../datasource/interface';
import type { Db } from '../db/exec';
import * as t from '../db/schema';
import { EngineError, fromZodError } from '../errors';
import type { EventBus } from '../events/bus';
import { allocateSequences, bumpMetadataVersion, lockWorkspace, writeEvents } from '../events/feed';
import type { Logger } from '../logger';
import { mapDbError } from '../metadata/service';
import { loadSnapshot, type SnapshotCache } from '../metadata/snapshot';
import type { MetadataStore } from '../metadata/store';
import { authorize } from '../permissions/policy';
import { applyShippedWorkflow, type ShippedOutcome, shippedWorkflowsOf } from '../workflows/shipped';
import { deleteModuleRuntime } from './connections';
import { type Diff, type PlanStep, planManifest } from './reconcile';

export interface ModuleService {
  list(ctx: EngineContext): Promise<InstalledModule[]>;
  plan(ctx: EngineContext, manifest: unknown): Promise<PlanResult>;
  apply(ctx: EngineContext, manifest: unknown, options?: ApplyOptions): Promise<ApplyResult>;
  uninstall(ctx: EngineContext, moduleId: string, options?: ApplyOptions): Promise<ApplyResult>;
}

export interface ModuleServiceDeps {
  db: Db;
  cache: SnapshotCache;
  store: MetadataStore;
  dataSource: DataSource;
  bus: EventBus;
  clock: () => Date;
  logger: Logger;
}

const parseOrThrow = (input: unknown): ModuleManifest => {
  try {
    return parseManifest(input);
  } catch (error) {
    if (error && typeof error === 'object' && 'issues' in error) {
      throw fromZodError(error as never, 'Invalid manifest');
    }

    throw new EngineError('VALIDATION', error instanceof Error ? error.message : 'Invalid manifest');
  }
};

const patchOf = (diff: Diff | undefined): Record<string, unknown> =>
  Object.fromEntries(Object.entries(diff ?? {}).map(([key, { to }]) => [key, to]));

const fieldInput = (def: FieldDefinition, objectId: string) => ({
  objectId,
  name: def.name,
  type: def.type,
  label: def.label,
  description: def.description,
  icon: def.icon,
  settings: def.settings ?? {},
  isRequired: def.isRequired ?? false,
  isUnique: def.isUnique ?? false,
  defaultValue: def.defaultValue,
  position: def.position ?? 0,
});

export const createModuleService = (deps: ModuleServiceDeps): ModuleService => {
  const { db, cache, store, dataSource, bus, clock } = deps;

  const applyManifest = async (
    ctx: EngineContext,
    manifest: ModuleManifest,
    options: ApplyOptions & { uninstall?: boolean },
  ): Promise<ApplyResult> => {
    authorize(ctx, 'module.manage');
    const workspaceId = ctx.workspaceId;
    const own = (id: string) => ({ id, moduleId: manifest.id });

    const outcome = await db
      .transaction(async (tx) => {
        const state = await lockWorkspace(tx, workspaceId);
        const snapshot = await loadSnapshot(tx, workspaceId);
        const recordCounts = await dataSource.countRecordsByObject(tx, workspaceId);
        const shipped = await shippedWorkflowsOf(tx, workspaceId, manifest.id);
        const plan = planManifest({ manifest, snapshot, recordCounts, workflows: shipped });

        if (options.expectedPlanHash && options.expectedPlanHash !== plan.result.planHash) {
          throw new EngineError('PLAN_MISMATCH', 'The workspace changed since the plan was computed; plan again', {
            expected: options.expectedPlanHash,
            actual: plan.result.planHash,
          });
        }

        if (plan.result.hasConflicts) {
          const conflicts = plan.result.changes.filter((c) => c.action === 'conflict');

          throw new EngineError(
            'CONFLICT',
            `${conflicts.length} entit${conflicts.length === 1 ? 'y' : 'ies'} conflict with existing metadata`,
            {
              conflicts,
            },
          );
        }

        if (plan.result.hasDestructive && !options.allowDestructive) {
          const destructive = plan.result.changes.filter((c) => c.destructive);

          throw new EngineError(
            'DESTRUCTIVE_CHANGE',
            'The plan contains destructive changes; re-run with allowDestructive',
            {
              destructive,
            },
          );
        }

        const objectIds = new Map(snapshot.schema.objects.map((o) => [o.id, o.id]));
        const objectIdOf = (uid: string): string => {
          const id = objectIds.get(uid);

          if (!id) {
            throw new EngineError('MISSING_DEPENDENCY', `Object "${uid}" is not available`, { id: uid });
          }

          return id;
        };
        const applied: PlanChange[] = [];

        const execute = async (step: PlanStep) => {
          const { change } = step;

          switch (step.kind) {
            case 'object': {
              if (change.action === 'create' && step.desired) {
                const row = await store.insertObject(tx, workspaceId, step.desired, own(change.id));
                objectIds.set(change.id, row.id);
              } else if (change.action === 'update' && step.current) {
                await store.updateObject(tx, workspaceId, step.current, patchOf(change.diff));
              } else if (change.action === 'delete' && step.current) {
                await store.deleteObject(tx, workspaceId, step.current);
              }

              return;
            }
            case 'field': {
              if (change.action === 'create' && step.desired) {
                await store.insertField(
                  tx,
                  workspaceId,
                  fieldInput(step.desired, objectIdOf(step.desired.objectId)),
                  own(change.id),
                );
              } else if (change.action === 'update' && step.current && step.desired) {
                if (change.diff?.objectId) {
                  await store.deleteField(tx, workspaceId, step.current);
                  await store.insertField(
                    tx,
                    workspaceId,
                    fieldInput(step.desired, objectIdOf(step.desired.objectId)),
                    own(change.id),
                  );
                } else {
                  await store.updateField(tx, workspaceId, step.current, patchOf(change.diff), { force: true });
                }
              } else if (change.action === 'delete' && step.current) {
                await store.deleteField(tx, workspaceId, step.current);
              }

              return;
            }
            case 'view': {
              if (change.action === 'create' && step.desired) {
                const v = step.desired;
                await store.insertView(
                  tx,
                  workspaceId,
                  {
                    objectId: objectIdOf(v.objectId),
                    label: v.label,
                    type: v.type,
                    icon: v.icon,
                    isDefault: v.isDefault,
                    position: v.position,
                    config: ViewConfigSchema.parse({
                      fields: v.fields ?? [],
                      filter: v.filter,
                      sorts: v.sorts ?? [],
                      groupById: v.groupById,
                      settings: v.settings ?? {},
                    }),
                  },
                  own(change.id),
                );
              } else if (change.action === 'update' && step.current) {
                const { object, ...rest } = patchOf(change.diff);
                await store.updateView(tx, workspaceId, step.current, {
                  ...rest,
                  ...(object !== undefined ? { objectId: objectIdOf(String(object)) } : {}),
                });
              } else if (change.action === 'delete' && step.current) {
                await store.deleteView(tx, workspaceId, step.current);
              }

              return;
            }
            case 'layout': {
              if (change.action === 'create' && step.desired) {
                const l = step.desired;
                await store.insertLayout(
                  tx,
                  workspaceId,
                  {
                    objectId: objectIdOf(l.objectId),
                    label: l.label,
                    isDefault: l.isDefault,
                    actions: l.actions ?? [],
                    shell: l.shell,
                    ...layoutContentOf(l),
                  },
                  own(change.id),
                );
              } else if (change.action === 'update' && step.current) {
                const { object, ...rest } = patchOf(change.diff);
                await store.updateLayout(tx, workspaceId, step.current, {
                  ...rest,
                  ...(object !== undefined ? { objectId: objectIdOf(String(object)) } : {}),
                });
              } else if (change.action === 'delete' && step.current) {
                await store.deleteLayout(tx, workspaceId, step.current);
              }

              return;
            }
            case 'nav_item': {
              if (change.action === 'create' && step.desired) {
                const n = step.desired;
                const parentId = n.parentId ? await store.navItemIdOf(tx, workspaceId, n.parentId) : null;
                await store.insertNavItem(
                  tx,
                  workspaceId,
                  { label: n.label, icon: n.icon, target: n.target, position: n.position, parentId, pinned: n.pinned },
                  own(change.id),
                );
              } else if (change.action === 'update' && step.current) {
                // The diff speaks of the parent by its id; make sure it exists.
                const { parentId, ...rest } = patchOf(change.diff);
                const patch: Record<string, unknown> = { ...rest };

                if ('parentId' in patchOf(change.diff)) {
                  patch.parentId =
                    typeof parentId === 'string' ? await store.navItemIdOf(tx, workspaceId, parentId) : null;
                }

                await store.updateNavItem(tx, workspaceId, step.current, patch);
              } else if (change.action === 'delete' && step.current) {
                await store.deleteNavItem(tx, workspaceId, step.current);
              }

              return;
            }
            case 'command_item': {
              if (change.action === 'create' && step.desired) {
                const c = step.desired;
                await store.insertCommandItem(
                  tx,
                  workspaceId,
                  { label: c.label, icon: c.icon, group: c.group, shortcut: c.shortcut, action: c.action },
                  own(change.id),
                );
              } else if (change.action === 'update' && step.current) {
                await store.updateCommandItem(tx, workspaceId, step.current, patchOf(change.diff));
              } else if (change.action === 'delete' && step.current) {
                await store.deleteCommandItem(tx, workspaceId, step.current);
              }

              return;
            }
            default:
              return;
          }
        };

        // Workflows go in once the module's own row and metadata are in place, since they may name them.
        const workflowSteps: Extract<PlanStep, { kind: 'workflow' }>[] = [];

        for (const step of plan.steps) {
          if (step.change.action === 'noop' || step.change.action === 'conflict') {
            continue;
          }

          if (step.kind === 'workflow') {
            workflowSteps.push(step);
            continue;
          }

          await execute(step);
          applied.push(step.change);
        }

        const installed = snapshot.schema.modules.find((e) => e.id === manifest.id);

        if (options.uninstall && installed?.core) {
          throw new EngineError('CONFLICT', `"${manifest.id}" is part of the product and cannot be uninstalled`);
        }

        const manifestHash = hashManifest(manifest);
        const rowChanged =
          !installed || installed.manifestHash !== manifestHash || installed.version !== manifest.version;

        if (applied.length === 0 && workflowSteps.length === 0 && !rowChanged && !options.uninstall) {
          return {
            result: {
              moduleId: manifest.id,
              version: manifest.version,
              manifestHash,
              metadataVersion: state.metadataVersion,
              applied,
            },
            sequence: null,
          };
        }

        const now = clock();

        if (options.uninstall) {
          await tx.delete(t.module).where(and(eq(t.module.workspaceId, workspaceId), eq(t.module.id, manifest.id)));
          await deleteModuleRuntime(tx, workspaceId, manifest.id);
        } else {
          await tx
            .insert(t.module)
            .values({
              workspaceId,
              id: manifest.id,
              version: manifest.version,
              manifestHash,
              manifest: manifest as unknown as Record<string, unknown>,
              installedAt: now,
              updatedAt: now,
              installedBy: actorString(ctx.actor),
            })
            .onConflictDoUpdate({
              target: [t.module.workspaceId, t.module.id],
              set: {
                version: manifest.version,
                manifestHash,
                manifest: manifest as unknown as Record<string, unknown>,
                updatedAt: now,
              },
            });
        }

        // The workspace as the install leaves it, for a workflow to be checked against.
        const installedSnapshot = workflowSteps.some((step) => step.change.action !== 'delete')
          ? await loadSnapshot(tx, workspaceId)
          : snapshot;
        const workflowOutcomes: ShippedOutcome[] = [];

        for (const step of workflowSteps) {
          const outcome = await applyShippedWorkflow(tx, {
            workspaceId,
            moduleId: manifest.id,
            change: step.change,
            desired: step.desired,
            current: step.current,
            snapshot: installedSnapshot,
            eventSeq: state.eventSeq,
            now,
            actor: actorString(ctx.actor),
          });

          if (outcome) {
            workflowOutcomes.push(outcome);
            applied.push(step.change);
          }
        }

        const metadataVersion = await bumpMetadataVersion(tx, workspaceId);
        const first = await allocateSequences(tx, workspaceId, 1 + workflowOutcomes.length);
        const sequence = first + workflowOutcomes.length;
        await writeEvents(tx, workspaceId, [
          {
            sequence: first,
            type: 'module.applied',
            actor: ctx.actor,
            occurredAt: now,
            moduleId: manifest.id,
            version: manifest.version,
            metadataVersion,
          },
          ...workflowOutcomes.map((outcome, i) => ({
            sequence: first + 1 + i,
            type: 'workflow.changed' as const,
            actor: ctx.actor,
            occurredAt: now,
            entity: 'workflow',
            entityId: outcome.workflowId,
            payload: { action: outcome.action },
          })),
        ]);
        await bus.publish(tx, workspaceId, { seq: sequence });

        return {
          result: { moduleId: manifest.id, version: manifest.version, manifestHash, metadataVersion, applied },
          sequence,
        };
      })
      .catch(mapDbError);

    cache.invalidate(workspaceId);

    if (outcome.sequence !== null) {
      bus.emitLocal(workspaceId, { seq: outcome.sequence });
    }

    return outcome.result;
  };

  return {
    list: async (ctx) => {
      authorize(ctx, 'metadata.read');

      return (await cache.get(db, ctx.workspaceId)).schema.modules;
    },
    plan: async (ctx, input) => {
      authorize(ctx, 'module.manage');
      const manifest = parseOrThrow(input);
      const snapshot = await cache.get(db, ctx.workspaceId);
      const recordCounts = await dataSource.countRecordsByObject(db, ctx.workspaceId);

      const workflows = await shippedWorkflowsOf(db, ctx.workspaceId, manifest.id);

      return planManifest({ manifest, snapshot, recordCounts, workflows }).result;
    },
    apply: (ctx, input, options = {}) => applyManifest(ctx, parseOrThrow(input), options),
    uninstall: (ctx, moduleId, options = {}) =>
      applyManifest(ctx, parseOrThrow({ id: moduleId, version: '0.0.0' }), { ...options, uninstall: true }),
  };
};
