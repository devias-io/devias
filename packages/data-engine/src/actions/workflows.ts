import { workflowActions as workflow } from '@devias/core';
import { EngineError } from '../errors';
import { type Action, type EngineActionDeps, implement, type WorkflowRunner } from './types';

const runnerOf = (workflows: WorkflowRunner | undefined): WorkflowRunner => {
  if (!workflows) {
    throw new EngineError('MISSING_DEPENDENCY', 'Running workflows is not available on this server');
  }

  return workflows;
};

/** Workflows: CRUD, the run history, manual runs and retries (through the runner, which can call module actions). */
export const workflowActions = ({ engine, workflows }: EngineActionDeps): Action[] => [
  implement(workflow.list, (_input, ctx) => engine.workflows.list(ctx)),
  implement(workflow.create, (input, ctx) => engine.workflows.create(ctx, input)),
  implement(workflow.get, ({ id }, ctx) => engine.workflows.get(ctx, id)),
  implement(workflow.update, ({ id, ...patch }, ctx) => engine.workflows.update(ctx, id, patch)),
  implement(workflow.delete, ({ id }, ctx) => engine.workflows.delete(ctx, id)),
  implement(workflow.listRuns, ({ id, ...query }, ctx) => engine.workflows.listRuns(ctx, id, query)),
  implement(workflow.activity, (query, ctx) => engine.workflows.activity(ctx, query)),
  implement(workflow.run, ({ id, ...input }, ctx) => runnerOf(workflows).runManual(ctx, id, input)),
  implement(workflow.retryRun, ({ id, runId }, ctx) => runnerOf(workflows).retryRun(ctx, id, runId)),
];
