import {
  ACTIONS,
  availableBlocks,
  blockRefProblem,
  type CommandItem,
  type CommandItemDefinition,
  type FieldDefinition,
  type FieldMetadata,
  filterFieldRefs,
  flattenSteps,
  hashManifest,
  hashValue,
  type Layout,
  LayoutActionSchema,
  type LayoutContentKey,
  type LayoutDefinition,
  layoutCells,
  layoutContentOf,
  type ManifestEntityKind,
  type ModuleManifest,
  manifestFields,
  type NavItem,
  type NavItemDefinition,
  type ObjectDefinition,
  type ObjectMetadata,
  type PlanChange,
  type PlanResult,
  type RecordShell,
  SYSTEM_FIELD_IDS,
  stableStringify,
  triggerObjectIdOf,
  ViewConfigSchema,
  type ViewDefinition,
  type ViewMetadata,
  type WorkflowDefinition,
} from '@devias/core';
import { z } from 'zod';
import { EngineError } from '../errors';
import type { Snapshot } from '../metadata/snapshot';
import { isCompatibleTypeChange, relationTargetOf } from '../metadata/store';
import { canonWorkflow, type ShippedWorkflow } from '../workflows/shipped';

/**
 * Pure reconciliation of a manifest against a metadata snapshot. Entities match by id;
 * only rows owned by the manifest's module are ever updated or deleted.
 */

export interface PlanInput {
  manifest: ModuleManifest;
  snapshot: Snapshot;
  /** The workflows this module already has in the workspace (they are not part of the metadata snapshot). */
  workflows?: ShippedWorkflow[];
  /** Live record count per object id; used for the destructive reason of object deletes. */
  recordCounts?: Map<string, number>;
}

export type Diff = Record<string, { from: unknown; to: unknown }>;

export type PlanStep =
  | { kind: 'object'; change: PlanChange; desired?: ObjectDefinition; current?: ObjectMetadata }
  | { kind: 'field'; change: PlanChange; desired?: FieldDefinition & { objectId: string }; current?: FieldMetadata }
  | { kind: 'view'; change: PlanChange; desired?: ViewDefinition; current?: ViewMetadata }
  | { kind: 'layout'; change: PlanChange; desired?: LayoutDefinition; current?: Layout }
  | { kind: 'nav_item'; change: PlanChange; desired?: NavItemDefinition; current?: NavItem }
  | { kind: 'command_item'; change: PlanChange; desired?: CommandItemDefinition; current?: CommandItem }
  | { kind: 'workflow'; change: PlanChange; desired?: WorkflowDefinition; current?: ShippedWorkflow };

export interface DetailedPlan {
  result: PlanResult;
  steps: PlanStep[];
}

const ActionsSchema = z.array(LayoutActionSchema);

export const diffCanonical = (from: Record<string, unknown>, to: Record<string, unknown>): Diff => {
  const diff: Diff = {};

  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (stableStringify(from[key] ?? null) !== stableStringify(to[key] ?? null)) {
      diff[key] = { from: from[key], to: to[key] };
    }
  }

  return diff;
};

// --- canonical (comparable) forms ------------------------------------------------------------

const canonObject = (
  o: Pick<
    ObjectDefinition,
    | 'nameSingular'
    | 'namePlural'
    | 'labelSingular'
    | 'labelPlural'
    | 'icon'
    | 'description'
    | 'primaryFieldId'
    | 'deleteWhen'
  >,
) => ({
  nameSingular: o.nameSingular,
  namePlural: o.namePlural,
  labelSingular: o.labelSingular,
  labelPlural: o.labelPlural,
  icon: o.icon,
  description: o.description,
  primaryFieldId: o.primaryFieldId,
  deleteWhen: o.deleteWhen,
});

const canonField = (objectUid: string, f: Omit<FieldDefinition, 'id' | 'object'>) => ({
  objectId: objectUid,
  name: f.name,
  label: f.label,
  type: f.type,
  settings: f.settings ?? {},
  description: f.description,
  icon: f.icon,
  isRequired: f.isRequired ?? false,
  isUnique: f.isUnique ?? false,
  defaultValue: f.defaultValue,
  position: f.position ?? 0,
});

const canonView = (
  objectUid: string,
  v: { label: string; type?: string; icon?: string; isDefault?: boolean; position?: number; config: unknown },
) => ({
  objectId: objectUid,
  label: v.label,
  type: v.type ?? 'table',
  icon: v.icon,
  isDefault: v.isDefault ?? false,
  position: v.position ?? 0,
  config: ViewConfigSchema.parse(v.config),
});

const viewConfigOf = (v: ViewDefinition) => ({
  fields: v.fields ?? [],
  filter: v.filter,
  sorts: v.sorts ?? [],
  groupById: v.groupById,
  settings: v.settings ?? {},
});

/** What makes two layouts the same: what every layout has, and the content its shape holds. */
const canonLayout = (
  objectUid: string,
  l: { label: string; shell: RecordShell; isDefault?: boolean; actions?: unknown } & {
    [K in LayoutContentKey]?: unknown;
  },
) => ({
  objectId: objectUid,
  label: l.label,
  shell: l.shell,
  isDefault: l.isDefault ?? false,
  actions: ActionsSchema.parse(l.actions ?? []),
  ...layoutContentOf(l),
});

/** A manifest that leaves `position` out lets the workspace order the row: it is appended on create, then not compared. */
const canonNav = (n: Pick<NavItemDefinition, 'label' | 'icon' | 'target' | 'position' | 'parentId' | 'pinned'>) => ({
  label: n.label,
  icon: n.icon,
  target: n.target,
  position: n.position,
  parentId: n.parentId ?? null,
  pinned: n.pinned ?? false,
});

const canonCommand = (c: Pick<CommandItemDefinition, 'label' | 'icon' | 'group' | 'shortcut' | 'action'>) => ({
  label: c.label,
  icon: c.icon,
  group: c.group,
  shortcut: c.shortcut,
  action: c.action,
});

// --- generic reconciliation of one entity kind ------------------------------------------------

interface Owned {
  id: string;
  moduleId: string | null;
}

interface KindSpec<D, C extends Owned> {
  kind: ManifestEntityKind;
  desired: { id: string; def: D }[];
  current: C[];
  canonDesired: (def: D) => Record<string, unknown>;
  /** `def` is the manifest's entry for the same row, for fields the manifest may leave to the workspace. */
  canonCurrent: (row: C, def: D) => Record<string, unknown>;
  labelDesired: (def: D) => string;
  labelCurrent: (row: C) => string;
  /** Extra conflict check for creates, e.g. API name collisions with rows we do not own. */
  createConflict?: (def: D) => string | undefined;
  destructiveUpdate?: (diff: Diff, def: D, row: C) => string | undefined;
  destructiveDelete?: (row: C) => string | undefined;
  toStep: (change: PlanChange, def: D | undefined, row: C | undefined) => PlanStep;
}

const reconcileKind = <D, C extends Owned>(moduleId: string, spec: KindSpec<D, C>) => {
  const upserts: PlanStep[] = [];
  const deletes: PlanStep[] = [];
  const currentByUid = new Map(spec.current.map((row) => [row.id, row]));
  const desiredUids = new Set(spec.desired.map((d) => d.id));

  for (const { id, def } of spec.desired) {
    const row = currentByUid.get(id);
    const base = { kind: spec.kind, id, label: spec.labelDesired(def) };

    if (!row) {
      const conflict = spec.createConflict?.(def);
      upserts.push(
        conflict
          ? spec.toStep({ ...base, action: 'conflict', destructive: false, reason: conflict }, def, undefined)
          : spec.toStep({ ...base, action: 'create', destructive: false }, def, undefined),
      );
      continue;
    }

    if (row.moduleId !== moduleId) {
      const owner = row.moduleId ? `module "${row.moduleId}"` : 'the workspace';
      upserts.push(
        spec.toStep(
          { ...base, action: 'conflict', destructive: false, reason: `Already exists and is owned by ${owner}` },
          def,
          row,
        ),
      );
      continue;
    }

    const diff = diffCanonical(spec.canonCurrent(row, def), spec.canonDesired(def));

    if (Object.keys(diff).length === 0) {
      upserts.push(spec.toStep({ ...base, action: 'noop', destructive: false }, def, row));
      continue;
    }

    const reason = spec.destructiveUpdate?.(diff, def, row);
    upserts.push(spec.toStep({ ...base, action: 'update', destructive: reason !== undefined, reason, diff }, def, row));
  }

  for (const row of spec.current) {
    if (row.moduleId !== moduleId || desiredUids.has(row.id)) {
      continue;
    }

    const reason = spec.destructiveDelete?.(row);
    deletes.push(
      spec.toStep(
        {
          kind: spec.kind,
          id: row.id,
          label: spec.labelCurrent(row),
          action: 'delete',
          destructive: reason !== undefined,
          reason,
        },
        undefined,
        row,
      ),
    );
  }

  return { upserts, deletes };
};

// --- the plan --------------------------------------------------------------------------------

export const planManifest = ({
  manifest,
  snapshot,
  recordCounts,
  workflows: shipped = [],
}: PlanInput): DetailedPlan => {
  const { index, schema } = snapshot;
  const moduleId = manifest.id;
  const knownObjects = new Set([...schema.objects.map((o) => o.id), ...manifest.objects.map((o) => o.id)]);
  const objectNameOf = (uid: string): string =>
    index.objectsById.get(uid)?.nameSingular ?? manifest.objects.find((o) => o.id === uid)?.nameSingular ?? uid;

  const requireObjectRef = (uid: string, what: string) => {
    if (!knownObjects.has(uid)) {
      throw new EngineError(
        'MISSING_DEPENDENCY',
        `${what} references object "${uid}", which is neither installed nor declared`,
        {
          id: uid,
        },
      );
    }
  };

  const fields = manifestFields(manifest);

  for (const f of fields) {
    requireObjectRef(f.objectId, `Field "${f.id}"`);

    if (f.type === 'relation') {
      const target = relationTargetOf(f.settings);

      if (target) {
        requireObjectRef(target, `Relation field "${f.id}"`);
      }
    }
  }

  for (const v of manifest.views) {
    requireObjectRef(v.objectId, `View "${v.id}"`);
  }

  for (const l of manifest.layouts) {
    requireObjectRef(l.objectId, `Layout "${l.id}"`);
  }

  // Each layout cell names a record block this manifest or another installed module declares.
  const blocks = availableBlocks([...schema.modules.filter((m) => m.id !== moduleId), manifest]);

  for (const l of manifest.layouts) {
    for (const { cell } of layoutCells(l)) {
      const problem = blockRefProblem(cell.blockId, blocks, undefined, cell.optional);

      if (problem) {
        throw new EngineError('MISSING_DEPENDENCY', `Layout "${l.id}": ${problem}`, {
          id: l.id,
          blockId: cell.blockId,
        });
      }
    }
  }

  // What a declaration points at by id is this manifest's or another module's: it has to be one or the other.
  const requireRef = (kind: string, id: string, known: ReadonlySet<string>, what: string) => {
    if (!known.has(id)) {
      throw new EngineError(
        'MISSING_DEPENDENCY',
        `${what} references ${kind} "${id}", which is neither installed nor declared`,
        {
          id,
        },
      );
    }
  };
  const others = (rows: { id: string; moduleId: string | null }[]) =>
    rows.filter((row) => row.moduleId !== moduleId).map((row) => row.id);
  const knownFields = new Set([
    ...others(schema.fields),
    ...fields.map((f) => f.id),
    ...Object.values(SYSTEM_FIELD_IDS),
  ]);
  const knownViews = new Set([...others(schema.views), ...manifest.views.map((v) => v.id)]);
  const knownNavItems = new Set([...others(schema.navItems), ...manifest.navItems.map((n) => n.id)]);
  const knownActions = new Set([
    ...schema.modules.filter((m) => m.id !== moduleId).flatMap((m) => m.actions.map((a) => a.id)),
    ...manifest.actions.map((a) => a.id),
  ]);

  for (const v of manifest.views) {
    const refs = [
      ...(v.fields ?? []).map((f) => f.fieldId),
      ...(v.sorts ?? []).map((sort) => sort.fieldId),
      ...(v.groupById ? [v.groupById] : []),
      ...filterFieldRefs(v.filter),
    ];

    for (const ref of refs) {
      requireRef('field', ref, knownFields, `View "${v.id}"`);
    }
  }

  for (const n of manifest.navItems) {
    const what = `Nav item "${n.id}"`;

    if (n.parentId) {
      requireRef('nav item', n.parentId, knownNavItems, what);
    }

    if (n.target.kind === 'object') {
      requireObjectRef(n.target.objectId, what);

      if (n.target.viewId) {
        requireRef('view', n.target.viewId, knownViews, what);
      }
    }
  }

  for (const c of manifest.commandItems) {
    const target = c.action.kind === 'navigate' ? c.action.target : undefined;

    if (c.action.kind === 'create_record') {
      requireObjectRef(c.action.objectId, `Command "${c.id}"`);
    } else if (target?.kind === 'object') {
      requireObjectRef(target.objectId, `Command "${c.id}"`);
    }
  }

  for (const l of manifest.layouts) {
    for (const entry of l.actions ?? []) {
      requireRef('action', entry.actionId, knownActions, `Layout "${l.id}"`);
    }
  }

  // A workflow names objects, fields, actions and a module's events by id; they have to be there when it is made.
  const coreActionIds = new Set<string>(ACTIONS.map((action) => action.id));

  for (const w of manifest.workflows) {
    const what = `Workflow "${w.id}"`;
    const objectId = triggerObjectIdOf(w.trigger);

    if (objectId) {
      requireObjectRef(objectId, what);
    }

    if (w.trigger.kind === 'record_event') {
      for (const fieldId of w.trigger.fieldIds ?? []) {
        requireRef('field', fieldId, knownFields, what);
      }
    }

    if (w.trigger.kind === 'record_event' || w.trigger.kind === 'schedule') {
      for (const ref of filterFieldRefs(w.trigger.condition)) {
        requireRef('field', ref, knownFields, what);
      }
    }

    if (w.trigger.kind === 'module_event' && w.trigger.moduleId !== moduleId) {
      requireRef('module', w.trigger.moduleId, new Set(schema.modules.map((m) => m.id)), what);
    }

    for (const step of flattenSteps(w.steps)) {
      if (step.kind === 'action' && !coreActionIds.has(step.actionId)) {
        requireRef('action', step.actionId, knownActions, what);
      }
    }
  }

  const objects = reconcileKind<ObjectDefinition, ObjectMetadata>(moduleId, {
    kind: 'object',
    desired: manifest.objects.map((o) => ({ id: o.id, def: o })),
    current: schema.objects,
    canonDesired: canonObject,
    canonCurrent: canonObject,
    labelDesired: (o) => `Object "${o.labelSingular}" (${o.nameSingular})`,
    labelCurrent: (o) => `Object "${o.labelSingular}" (${o.nameSingular})`,
    createConflict: (o) => {
      const taken = schema.objects.find((x) => x.nameSingular === o.nameSingular);

      return taken ? `Object name "${o.nameSingular}" is already used by "${taken.id}"` : undefined;
    },
    destructiveDelete: (o) => `Deletes object "${o.nameSingular}" and ${recordCounts?.get(o.id) ?? 0} record(s)`,
    toStep: (change, desired, current) => ({ kind: 'object', change, desired, current }),
  });

  const fieldSteps = reconcileKind<FieldDefinition & { objectId: string }, FieldMetadata>(moduleId, {
    kind: 'field',
    desired: fields.map((f) => ({ id: f.id, def: f })),
    current: schema.fields,
    canonDesired: (f) => canonField(f.objectId, f),
    canonCurrent: (f) => canonField(f.objectId, f),
    labelDesired: (f) => `Field "${objectNameOf(f.objectId)}.${f.name}"`,
    labelCurrent: (f) => `Field "${objectNameOf(f.objectId)}.${f.name}"`,
    createConflict: (f) => {
      const object = index.objectsById.get(f.objectId);

      if (!object) {
        return undefined;
      }

      const taken = (index.fieldsByObjectId.get(object.id) ?? []).find((x) => x.name === f.name);

      return taken ? `Field name "${f.name}" on "${object.nameSingular}" is already used by "${taken.id}"` : undefined;
    },
    destructiveUpdate: (diff, def, row) => {
      const reasons: string[] = [];

      if (diff.type && !isCompatibleTypeChange(row.type, def.type)) {
        reasons.push(`changing type ${row.type} → ${def.type} drops existing values`);
      }

      if (
        diff.settings &&
        row.type === 'relation' &&
        def.type === 'relation' &&
        relationTargetOf(row.settings) !== relationTargetOf(def.settings)
      ) {
        reasons.push('changing the relation target drops existing values');
      }

      if (diff.isUnique && def.isUnique) {
        reasons.push('enabling uniqueness fails if duplicate values exist');
      }

      if (diff.objectId) {
        reasons.push('moving the field to another object drops existing values');
      }

      return reasons.length > 0 ? reasons.join('; ') : undefined;
    },
    destructiveDelete: (f) => `Deletes field "${objectNameOf(f.objectId)}.${f.name}" and its values`,
    toStep: (change, desired, current) => ({ kind: 'field', change, desired, current }),
  });

  const views = reconcileKind<ViewDefinition, ViewMetadata>(moduleId, {
    kind: 'view',
    desired: manifest.views.map((v) => ({ id: v.id, def: v })),
    current: schema.views,
    canonDesired: (v) => canonView(v.objectId, { ...v, config: viewConfigOf(v) }),
    canonCurrent: (v) => canonView(v.objectId, v),
    labelDesired: (v) => `View "${v.label}" on ${objectNameOf(v.objectId)}`,
    labelCurrent: (v) => `View "${v.label}" on ${objectNameOf(v.objectId)}`,
    toStep: (change, desired, current) => ({ kind: 'view', change, desired, current }),
  });

  const layouts = reconcileKind<LayoutDefinition, Layout>(moduleId, {
    kind: 'layout',
    desired: manifest.layouts.map((l) => ({ id: l.id, def: l })),
    current: schema.layouts,
    canonDesired: (l) => canonLayout(l.objectId, l),
    canonCurrent: (l) => canonLayout(l.objectId, l),
    labelDesired: (l) => `Layout "${l.label}" on ${objectNameOf(l.objectId)}`,
    labelCurrent: (l) => `Layout "${l.label}" on ${objectNameOf(l.objectId)}`,
    toStep: (change, desired, current) => ({ kind: 'layout', change, desired, current }),
  });

  const navs = reconcileKind<NavItemDefinition, NavItem>(moduleId, {
    kind: 'nav_item',
    // Parents first, so a child always finds the item it sits under.
    desired: [...manifest.navItems]
      .sort((a, b) => Number(a.parentId !== undefined) - Number(b.parentId !== undefined))
      .map((n) => ({ id: n.id, def: n })),
    current: schema.navItems,
    canonDesired: canonNav,
    canonCurrent: (n, def) =>
      canonNav({
        ...n,
        position: def.position === undefined ? undefined : n.position,
        parentId: n.parentId ? schema.navItems.find((candidate) => candidate.id === n.parentId)?.id : undefined,
      }),
    labelDesired: (n) => `Nav item "${n.label}"`,
    labelCurrent: (n) => `Nav item "${n.label}"`,
    toStep: (change, desired, current) => ({ kind: 'nav_item', change, desired, current }),
  });

  const commands = reconcileKind<CommandItemDefinition, CommandItem>(moduleId, {
    kind: 'command_item',
    desired: manifest.commandItems.map((c) => ({ id: c.id, def: c })),
    current: schema.commandItems,
    canonDesired: canonCommand,
    canonCurrent: canonCommand,
    labelDesired: (c) => `Command "${c.label}"`,
    labelCurrent: (c) => `Command "${c.label}"`,
    toStep: (change, desired, current) => ({ kind: 'command_item', change, desired, current }),
  });

  const workflowSteps = reconcileKind<WorkflowDefinition, ShippedWorkflow>(moduleId, {
    kind: 'workflow',
    desired: manifest.workflows.map((w) => ({ id: w.id, def: w })),
    current: shipped,
    canonDesired: canonWorkflow,
    canonCurrent: canonWorkflow,
    labelDesired: (w) => `Workflow "${w.title}"`,
    labelCurrent: (w) => `Workflow "${w.title}"`,
    toStep: (change, desired, current) => ({ kind: 'workflow', change, desired, current }),
  });

  const steps: PlanStep[] = [
    ...objects.upserts,
    ...fieldSteps.upserts,
    ...views.upserts,
    ...layouts.upserts,
    ...navs.upserts,
    ...commands.upserts,
    ...workflowSteps.upserts,
    ...workflowSteps.deletes,
    ...commands.deletes,
    ...navs.deletes,
    ...layouts.deletes,
    ...views.deletes,
    ...fieldSteps.deletes,
    ...objects.deletes,
  ];
  const changes = steps.map((s) => s.change);
  const installed = schema.modules.find((e) => e.id === moduleId);
  const result: PlanResult = {
    moduleId,
    fromVersion: installed?.version ?? null,
    toVersion: manifest.version,
    manifestHash: hashManifest(manifest),
    planHash: hashValue(changes),
    hasDestructive: changes.some((c) => c.destructive),
    hasConflicts: changes.some((c) => c.action === 'conflict'),
    changes,
  };

  return { result, steps };
};
