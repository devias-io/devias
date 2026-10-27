import { linkHref } from '@devias/core';
import type { DataEngine, EngineContext } from '@devias/data-engine';
import { z } from 'zod';
import { defineTool } from '../types';

const canWrite = (ctx: EngineContext, engine: DataEngine) => engine.permissions.can(ctx, 'task.write');

const linkOf = (id: string) => linkHref({ kind: 'task', id });

export const finishTask = defineTool({
  name: 'finish_task',
  area: 'tasks',
  description:
    'Hand in the task you were given when your work on it is done: say what you did and what a reviewer should check, in a few sentences. The task goes to review and your run ends. Call it once, as the last thing you do; anything you proposed that is still waiting for approval stays waiting.',
  input: z.object({ summary: z.string().trim().min(1).max(20_000).describe('What you did, for the reviewer') }),
  approval: 'auto',
  moduleId: null,
  available: (ctx, engine) => ctx.run !== undefined && canWrite(ctx, engine),
  run: async ({ summary }, { engine, ctx }) => {
    if (!ctx.run) {
      throw new Error('finish_task works only inside a run');
    }

    const task = await engine.tasks.finish(ctx, ctx.run.taskId, { summary });

    return { finished: true, id: task.id, status: task.status, link: linkOf(task.id) };
  },
});
