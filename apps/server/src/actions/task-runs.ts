import { taskActions as task } from '@devias/core';
import { type Action, type ActionDeps, implement } from './types';

/** The runs of a task: kept by the AI service, so the server answers for them. */
export const taskRunActions = ({ ai }: ActionDeps): Action[] => [
  implement(task.listRuns, async ({ id }, ctx) => ({ items: await ai.runs.list(ctx, id) })),
];
