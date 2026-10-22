import {
  coreIds,
  countSteps,
  linkHref,
  type SchemaIndex,
  triggerObjectIdOf,
  WORKFLOW_MAX_DEPTH,
  WORKFLOW_MAX_STEPS,
  WORKFLOW_TRIGGER_KINDS,
  type Workflow,
  type WorkflowRun,
  WorkflowStepInputSchema,
  WorkflowTriggerSchema,
} from '@devias/core';
import { z } from 'zod';
import { resolveObject } from '../helpers';
import { normalizeSteps, normalizeTrigger } from '../workflow-normalize';
import { workflowRef } from '../workflow-ref';
import { type AdapterContext, answering, carrying, defineAdapter, type ToolAdapters } from './types';

/**
 * Workflows as the agent sees them. Triggers and steps use the engine's own contract (`@devias/core`), so what
 * `get_workflow` returns can be edited and sent back to `update_workflow` as is. Object, field and module references
 * also accept labels, like the record tools, and a workflow is named by its id or its title.
 */

const RUNS_DEFAULT = 10;
const RUNS_CAP = 20;
const RECENT_RUNS = 5;
const OUTPUT_PREVIEW_CHARS = 500;

const WorkflowRef = z.string().min(1).describe('Workflow id or name');

const StepsInput = z
  .array(WorkflowStepInputSchema)
  .min(1)
  .describe(
    `Steps, run top to bottom. Keep the id of every step you keep; new steps may omit it. At most ${WORKFLOW_MAX_STEPS} steps counting those inside branches, and branches nest at most ${WORKFLOW_MAX_DEPTH} deep.`,
  );

/** A workflow named by its id or its title, found through the read-only list action. */
const workflowNamed = async (context: AdapterContext, ref: string): Promise<Workflow> =>
  workflowRef((await context.read(coreIds.actions.list_workflows)) as Workflow[], ref);

const workflowLink = (id: string) => linkHref({ kind: 'workflow', id });

const workflowSummary = (workflow: Workflow) => ({
  id: workflow.id,
  title: workflow.title,
  ...(workflow.description ? { description: workflow.description } : {}),
  enabled: workflow.enabled,
  trigger: workflow.trigger,
  stepCount: countSteps(workflow.steps),
  lastRunAt: workflow.lastRunAt,
  ...(workflow.nextRunAt ? { nextRunAt: workflow.nextRunAt } : {}),
  link: workflowLink(workflow.id),
});

const workflowDetail = (workflow: Workflow) => ({
  ...workflowSummary(workflow),
  steps: workflow.steps,
  createdAt: workflow.createdAt,
  updatedAt: workflow.updatedAt,
});

const recordLinkOf = (run: WorkflowRun, index: SchemaIndex) => {
  const object = run.trigger.objectId ? index.objectsById.get(run.trigger.objectId) : undefined;

  return object && run.trigger.recordId ? { record: `record:${object.nameSingular}/${run.trigger.recordId}` } : {};
};

/** Step outputs can be large (action results); the model gets a preview. */
const preview = (value: unknown): unknown => {
  const text = JSON.stringify(value);

  return text !== undefined && text.length > OUTPUT_PREVIEW_CHARS ? `${text.slice(0, OUTPUT_PREVIEW_CHARS)}…` : value;
};

/** One line per run, for a workflow's recent history. */
const runSummary = (run: WorkflowRun, index: SchemaIndex) => ({
  id: run.id,
  status: run.status,
  trigger: run.trigger.kind,
  ...(run.trigger.eventType ? { eventType: run.trigger.eventType } : {}),
  ...recordLinkOf(run, index),
  ...(run.error ? { error: run.error } : {}),
  finishedAt: run.finishedAt,
});

/** A run with what each step did; the steps are flat, in execution order, branch lanes included. */
const runDetail = (run: WorkflowRun, index: SchemaIndex) => ({
  id: run.id,
  status: run.status,
  trigger: run.trigger,
  ...recordLinkOf(run, index),
  ...(run.error ? { error: run.error } : {}),
  steps: run.steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    ...(step.actionId ? { actionId: step.actionId } : {}),
    ...(step.label ? { label: step.label } : {}),
    status: step.status,
    ...(step.output !== undefined ? { output: preview(step.output) } : {}),
    ...(step.error ? { error: step.error } : {}),
  })),
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
});

const WorkflowSummaryRuns = (page: { items: WorkflowRun[] }, index: SchemaIndex) =>
  page.items.map((run) => runSummary(run, index));

export const workflowAdapters: ToolAdapters = {
  [coreIds.actions.list_workflows]: defineAdapter({
    input: z.object({
      object: z.string().optional().describe('Only workflows whose trigger names this object'),
      trigger: z.enum(WORKFLOW_TRIGGER_KINDS).optional().describe('Only workflows with this kind of trigger'),
    }),
    toAction: () => ({}),
    shape: async (all: Workflow[], input, { schema }) => {
      const object = input.object ? resolveObject(await schema(), input.object).id : undefined;
      const workflows = all.filter(
        (w) =>
          (!object || triggerObjectIdOf(w.trigger) === object) && (!input.trigger || w.trigger.kind === input.trigger),
      );

      return { workflows: workflows.map(workflowSummary) };
    },
  }),
  [coreIds.actions.get_workflow]: defineAdapter({
    input: z.object({ workflow: WorkflowRef }),
    toAction: async ({ workflow: ref }, context) => {
      const workflow = await workflowNamed(context, ref);

      return carrying({ id: workflow.id }, workflow);
    },
    shape: async (workflow: Workflow, _input, context) => {
      const runs = (await context.read(coreIds.actions.list_workflow_runs, {
        id: workflow.id,
        limit: RECENT_RUNS,
      })) as {
        items: WorkflowRun[];
      };
      const index = await context.schema();

      return { ...workflowDetail(workflow), recentRuns: WorkflowSummaryRuns(runs, index) };
    },
  }),
  [coreIds.actions.list_workflow_runs]: defineAdapter({
    input: z.object({
      workflow: WorkflowRef,
      limit: z
        .number()
        .int()
        .min(1)
        .max(RUNS_CAP)
        .optional()
        .describe(`Runs to return (default ${RUNS_DEFAULT}, max ${RUNS_CAP})`),
      cursor: z.string().optional().describe('nextCursor from a previous page'),
    }),
    toAction: async (input, context) => {
      const workflow = await workflowNamed(context, input.workflow);

      return carrying(
        { id: workflow.id, limit: input.limit ?? RUNS_DEFAULT, ...(input.cursor ? { cursor: input.cursor } : {}) },
        workflow,
      );
    },
    shape: async (
      page: { items: WorkflowRun[]; nextCursor?: string | null },
      _input,
      { schema },
      workflow: Workflow,
    ) => {
      const index = await schema();

      return {
        workflow: { id: workflow.id, title: workflow.title },
        runs: page.items.map((run) => runDetail(run, index)),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    },
  }),
  [coreIds.actions.create_workflow]: defineAdapter({
    input: z.object({
      title: z.string().trim().min(1).max(120),
      description: z.string().max(2000).optional(),
      enabled: z.boolean().optional().describe('Default true: the workflow reacts from now on'),
      trigger: WorkflowTriggerSchema,
      steps: StepsInput,
    }),
    toAction: async (input, { schema }) => {
      const index = await schema();
      const trigger = normalizeTrigger(index, input.trigger);

      return { ...input, trigger, steps: normalizeSteps(index, triggerObjectIdOf(trigger), input.steps) };
    },
    shape: (workflow: Workflow) => ({ created: true, ...workflowDetail(workflow) }),
  }),
  [coreIds.actions.update_workflow]: defineAdapter({
    input: z.object({
      workflow: WorkflowRef,
      title: z.string().trim().min(1).max(120).optional(),
      description: z.string().max(2000).nullable().optional().describe('null clears it'),
      enabled: z.boolean().optional().describe('false turns the workflow off without deleting it'),
      trigger: WorkflowTriggerSchema.optional(),
      steps: StepsInput.optional(),
    }),
    toAction: async (input, context) => {
      const current = await workflowNamed(context, input.workflow);
      const index = await context.schema();
      const trigger = input.trigger ? normalizeTrigger(index, input.trigger) : undefined;
      const patch: Record<string, unknown> = {};

      if (input.title !== undefined) {
        patch.title = input.title;
      }

      // The engine clears the description when the key is present without a value.
      if (input.description !== undefined) {
        patch.description = input.description ?? undefined;
      }

      if (input.enabled !== undefined) {
        patch.enabled = input.enabled;
      }

      if (trigger) {
        patch.trigger = trigger;
      }

      if (input.steps) {
        patch.steps = normalizeSteps(index, triggerObjectIdOf(trigger ?? current.trigger), input.steps);
      }

      return Object.keys(patch).length === 0
        ? answering({ updated: false, message: 'Nothing to change' })
        : { id: current.id, ...patch };
    },
    shape: (workflow: Workflow) => ({ updated: true, ...workflowDetail(workflow) }),
  }),
  [coreIds.actions.delete_workflow]: defineAdapter({
    input: z.object({ workflow: WorkflowRef }),
    toAction: async ({ workflow: ref }, context) => {
      const workflow = await workflowNamed(context, ref);

      return carrying({ id: workflow.id }, workflow);
    },
    shape: (_output, _input, _context, workflow: Workflow) => ({
      deleted: true,
      id: workflow.id,
      title: workflow.title,
    }),
  }),
  [coreIds.actions.run_workflow]: defineAdapter({
    input: z.object({
      workflow: WorkflowRef,
      recordId: z
        .string()
        .min(1)
        .optional()
        .describe('The record to run on; required when the trigger names an object'),
    }),
    toAction: async (input, context) => {
      const workflow = await workflowNamed(context, input.workflow);

      return carrying({ id: workflow.id, ...(input.recordId ? { recordId: input.recordId } : {}) }, workflow);
    },
    shape: async (run: WorkflowRun, _input, { schema }, workflow: Workflow) => ({
      workflow: { id: workflow.id, title: workflow.title, link: workflowLink(workflow.id) },
      ...runDetail(run, await schema()),
    }),
  }),
};
