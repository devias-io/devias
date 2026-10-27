import {
  newId,
  type PlanChange,
  triggerFollowsLog,
  type WorkflowDefinition,
  type WorkflowInput,
  type WorkflowStep,
  type WorkflowTrigger,
} from '@devias/core';
import { sql } from 'drizzle-orm';
import { type Db, runRaw } from '../db/exec';
import { EngineError, validationError } from '../errors';
import type { Snapshot } from '../metadata/snapshot';
import { nextScheduledRun, toWorkflow, validateWorkflow, WORKFLOW_COLUMNS, type WorkflowRow } from './service';

/**
 * Workflows a module ships. A workspace has its own row for each, found by the module and the id its manifest gives the
 * workflow (`module_key`), since the row's own id is the workspace's. The module owns the title, the trigger and the
 * steps, so an update of the module replaces them; `enabled` is the workspace's and stays as it is set.
 */

/** A shipped workflow as a workspace has it: `id` is the manifest's, `workflowId` the row's. */
export interface ShippedWorkflow {
  id: string;
  moduleId: string;
  workflowId: string;
  title: string;
  description?: string | undefined;
  enabled: boolean;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
}

export const shippedWorkflowsOf = async (db: Db, workspaceId: string, moduleId: string): Promise<ShippedWorkflow[]> => {
  const rows = await runRaw<WorkflowRow>(
    db,
    sql`SELECT ${WORKFLOW_COLUMNS} FROM workflow WHERE workspace_id = ${workspaceId} AND module_id = ${moduleId}
        ORDER BY created_at ASC, id ASC`,
  );

  return rows.flatMap((row) => {
    const workflow = toWorkflow(row);

    return row.module_key && workflow.moduleId
      ? [
          {
            id: row.module_key,
            moduleId: workflow.moduleId,
            workflowId: workflow.id,
            title: workflow.title,
            description: workflow.description,
            enabled: workflow.enabled,
            trigger: workflow.trigger,
            steps: workflow.steps,
          },
        ]
      : [];
  });
};

/** What makes two shipped workflows the same: all but `enabled`, which the workspace decides. */
export const canonWorkflow = (
  workflow: Pick<WorkflowDefinition, 'title' | 'description' | 'trigger' | 'steps'>,
): Record<string, unknown> => ({
  title: workflow.title,
  description: workflow.description,
  trigger: workflow.trigger,
  steps: workflow.steps,
});

export interface ShippedOutcome {
  workflowId: string;
  action: 'created' | 'updated' | 'deleted';
}

/** The workflow as the API would take it, to check it like any other. */
const inputOf = (definition: WorkflowDefinition, enabled: boolean): WorkflowInput => ({
  title: definition.title,
  ...(definition.description === undefined ? {} : { description: definition.description }),
  enabled,
  trigger: definition.trigger,
  steps: definition.steps,
});

/**
 * Make, change or remove one workflow of a module, in the transaction that installs it. `snapshot` is the workspace as the
 * install leaves it, so a workflow may name what the same module has just added. `eventSeq` is where the event log is: a
 * workflow starts reading from there, and does not replay what came before it existed.
 */
export const applyShippedWorkflow = async (
  tx: Db,
  input: {
    workspaceId: string;
    moduleId: string;
    change: PlanChange;
    desired?: WorkflowDefinition | undefined;
    current?: ShippedWorkflow | undefined;
    snapshot: Snapshot;
    eventSeq: number;
    now: Date;
    actor: string;
  },
): Promise<ShippedOutcome | null> => {
  const { workspaceId, moduleId, change, desired, current, snapshot, eventSeq, now } = input;

  if (change.action === 'delete' && current) {
    await runRaw(
      tx,
      sql`DELETE FROM workflow WHERE workspace_id = ${workspaceId} AND id = ${current.workflowId}::uuid`,
    );

    return { workflowId: current.workflowId, action: 'deleted' };
  }

  if (!desired || (change.action !== 'create' && change.action !== 'update')) {
    return null;
  }

  const enabled = current?.enabled ?? desired.enabled ?? true;

  try {
    validateWorkflow(snapshot, inputOf(desired, enabled));
  } catch (error) {
    if (error instanceof EngineError) {
      throw validationError(`Workflow "${desired.title}" of module "${moduleId}": ${error.message}`, error.details);
    }

    throw error;
  }

  if (change.action === 'create') {
    const id = newId();
    const nextRunAt = nextScheduledRun(desired.trigger, enabled, now);
    await runRaw(
      tx,
      sql`INSERT INTO workflow (id, workspace_id, title, description, enabled, module_id, module_key, trigger, steps, cursor,
            next_run_at, created_by, created_at, updated_at)
          VALUES (${id}::uuid, ${workspaceId}, ${desired.title}, ${desired.description ?? null}, ${enabled}, ${moduleId},
            ${desired.id}, ${JSON.stringify(desired.trigger)}::jsonb, ${JSON.stringify(desired.steps)}::jsonb,
            ${triggerFollowsLog(desired.trigger) ? eventSeq : null}, ${nextRunAt ? nextRunAt.toISOString() : null}::timestamptz,
            ${input.actor}, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`,
    );

    return { workflowId: id, action: 'created' };
  }

  if (!current) {
    return null;
  }

  // A new trigger starts from now: no replay of what happened in between.
  const restart = change.diff?.trigger !== undefined;
  const nextRunAt = restart ? nextScheduledRun(desired.trigger, enabled, now) : undefined;
  const cursor = restart ? (triggerFollowsLog(desired.trigger) ? eventSeq : null) : undefined;
  await runRaw(
    tx,
    sql`UPDATE workflow SET title = ${desired.title}, description = ${desired.description ?? null},
          trigger = ${JSON.stringify(desired.trigger)}::jsonb, steps = ${JSON.stringify(desired.steps)}::jsonb,
          cursor = ${cursor === undefined ? sql`cursor` : cursor},
          next_run_at = ${nextRunAt === undefined ? sql`next_run_at` : sql`${nextRunAt ? nextRunAt.toISOString() : null}::timestamptz`},
          updated_at = ${now.toISOString()}::timestamptz
        WHERE workspace_id = ${workspaceId} AND id = ${current.workflowId}::uuid`,
  );

  return { workflowId: current.workflowId, action: 'updated' };
};
