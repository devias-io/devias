import { taskActions as task } from '@devias/core';
import { type Action, type EngineActionDeps, implement } from './types';

/** Tasks: work handed between people and agents, in tables of their own. */
export const taskActions = ({ engine }: EngineActionDeps): Action[] => [
  implement(task.list, (query, ctx) => engine.tasks.list(ctx, query)),
  implement(task.create, (input, ctx) => engine.tasks.create(ctx, input)),
  implement(task.counts, (query, ctx) => engine.tasks.counts(ctx, query)),
  implement(task.get, ({ id }, ctx) => engine.tasks.get(ctx, id)),
  implement(task.update, ({ id, ...patch }, ctx) => engine.tasks.update(ctx, id, patch)),
  implement(task.delete, ({ id }, ctx) => engine.tasks.delete(ctx, id)),
  implement(task.listActivity, ({ id, ...query }, ctx) => engine.tasks.activity(ctx, id, query)),
  implement(task.stop, ({ id }, ctx) => engine.tasks.stop(ctx, id)),
  implement(task.retry, ({ id }, ctx) => engine.tasks.retry(ctx, id)),
  implement(task.comment, ({ id, ...input }, ctx) => engine.tasks.comment(ctx, id, input)),
];
