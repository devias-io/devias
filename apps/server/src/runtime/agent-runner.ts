import type { AiService } from '@devias/ai';
import { type Actor, personOf, type Task } from '@devias/core';
import { type DataEngine, type EngineContext, isEngineError, type Logger, systemContext } from '@devias/data-engine';
import type { Directory } from '../auth/directory';
import { highestRole } from '../auth/roles';

export interface AgentRunnerOptions {
  engine: DataEngine;
  ai: AiService;
  directory: Directory;
  logger: Logger;
  pollIntervalMs?: number;
}

/** What the agent is handed to start with: the task by link (so it is read for it), and how the work ends. */
const briefOf = (task: Task, requestedBy: string, attempt: number): string =>
  [
    `You have been given this task by ${requestedBy}: [${task.title}](task:${task.id})`,
    attempt > 1 ? `This is attempt ${attempt}: an earlier attempt did not finish; read the task's activity first.` : '',
    'Read the whole task with get_task, including its comments, then do the work. Use comment_on_task for notes a reader of the task should see, and ask_user when you cannot go on without the person.',
    'Everything you propose that changes data waits for the person to approve it. When you are done, call finish_task with what you did and what to check: the task then goes to review.',
  ]
    .filter(Boolean)
    .join('\n\n');

const textOf = (blocks: unknown): string =>
  (Array.isArray(blocks) ? blocks : [])
    .flatMap((block: { type?: string; text?: string }) => (block.type === 'text' && block.text ? [block.text] : []))
    .join('\n\n')
    .trim();

/**
 * Works the agents' queues: it claims `todo` tasks assigned to agents that take tasks, one at a time per agent, and
 * runs each as a conversation of the agent with the person who gave it the task, whose authority it has. What it
 * proposes waits for that person; when the agent finishes, the task goes to review. It follows the runs it started by
 * their rows, so a run that a person stops, moves or deletes the task out from under is dropped, and a restart
 * fails what was interrupted.
 */
export const createAgentRunner = (options: AgentRunnerOptions) => {
  const { engine, ai, directory, logger } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const running = new Map<string, Promise<number>>();
  const dirty = new Set<string>();
  const driving = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;

  const taskOf = async (ctx: EngineContext, id: string): Promise<Task | null> => {
    try {
      return await engine.tasks.get(ctx, id);
    } catch (error) {
      if (isEngineError(error) && error.code === 'NOT_FOUND') {
        return null;
      }

      throw error;
    }
  };

  /** Follow every open run of the workspace: its state, and its end. */
  const reconcile = async (workspaceId: string): Promise<void> => {
    const system = systemContext(workspaceId, 'agent-runner');

    for (const run of (await ai.store.runs.listOpen()).filter((candidate) => candidate.workspaceId === workspaceId)) {
      const task = await taskOf(system, run.taskId);
      const turn = await ai.store.turns.latest(run.conversationId);
      const active = turn !== undefined && (turn.status === 'running' || turn.status === 'awaiting_approval');
      const own = task !== null && task.runId === run.id;
      // The agent handed the task in: its turn may still be saying so, or waiting on what it proposed.
      const handedIn = task !== null && !own && task.status === 'in_review' && task.work === null;

      if (!own && !handedIn) {
        // Stopped, moved, reassigned or deleted while the agent worked: drop the run.
        if (active) {
          await ai.runs.abort(workspaceId, run.conversationId);
        }

        await ai.store.runs.update(run.id, { status: 'cancelled', finishedAt: new Date() });
        continue;
      }

      if (active) {
        const waiting = turn.status === 'awaiting_approval';
        const status = waiting ? 'awaiting_review' : 'running';

        if (run.status !== status) {
          await ai.store.runs.update(run.id, { status });
        }

        if (own) {
          await engine.tasks.setWaiting(system, run.taskId, run.id, waiting);
        }

        continue;
      }

      if (turn?.status === 'completed') {
        const messages = await ai.store.messages.list(run.conversationId);
        const last = [...messages].reverse().find((message) => message.role === 'assistant');
        const summary = last ? textOf(last.content) || null : null;

        if (own) {
          await engine.tasks.endRun(system, run.taskId, run.id, { outcome: 'completed', summary });
        }

        await ai.store.runs.update(run.id, { status: 'completed', summary, finishedAt: new Date() });
        continue;
      }

      const error = turn?.error?.message ?? 'The run ended before the agent finished';

      if (own) {
        await engine.tasks.endRun(system, run.taskId, run.id, { outcome: 'failed', error });
      }

      await ai.store.runs.update(run.id, { status: 'failed', error, finishedAt: new Date() });
    }
  };

  /** The person a task was given by, as the context the agent acts in; or why there is none. */
  const requesterOf = async (
    workspaceId: string,
    by: Actor,
  ): Promise<{ ctx: EngineContext; user: { id: string; name: string } } | string> => {
    const userId = personOf(by);

    if (!userId) {
      return 'This task was given to the agent by a workflow, a key or a module, which has no person for the agent to act for. Assign it again yourself to start the work.';
    }

    const member = (await directory.members.list(workspaceId)).find((candidate) => candidate.userId === userId);
    const role = highestRole(member?.role);

    if (!member || !role) {
      return 'The person who gave this task to the agent no longer belongs to the workspace. Assign it again to start the work.';
    }

    return {
      ctx: { workspaceId, actor: { kind: 'user', id: userId }, role },
      user: { id: userId, name: member.user.name },
    };
  };

  /** Claim what the agents can start and start it. */
  const start = async (workspaceId: string): Promise<number> => {
    const system = systemContext(workspaceId, 'agent-runner');
    const agents = (await ai.store.agents.list(workspaceId)).filter((agent) => agent.takesTasks && !agent.archivedAt);
    let started = 0;

    for (;;) {
      const claim = await engine.tasks.claimNext(
        system,
        agents.map((agent) => agent.id),
      );

      if (!claim) {
        return started;
      }

      const { task, runId, attempt } = claim;
      const agentId = task.assignee?.slice('agent:'.length) ?? '';
      const requester = await requesterOf(workspaceId, claim.requestedBy);

      if (typeof requester === 'string') {
        await engine.tasks.endRun(system, task.id, runId, { outcome: 'failed', error: requester });
        continue;
      }

      try {
        const { handle } = await ai.runs.start(requester.ctx, {
          id: runId,
          taskId: task.id,
          agentId,
          title: task.title,
          content: briefOf(task, requester.user.name, attempt),
          attempt,
          user: requester.user,
        });
        driving.add(runId);
        void handle
          .run({ emit: () => {} })
          .catch((error) => logger.error(`agent run ${runId} failed`, error))
          .finally(() => {
            driving.delete(runId);
            void runOnce(workspaceId);
          });
        started += 1;
      } catch (error) {
        await engine.tasks.endRun(system, task.id, runId, {
          outcome: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const process = async (workspaceId: string): Promise<number> => {
    await reconcile(workspaceId);

    return start(workspaceId);
  };

  /** Follow and start what is pending for one workspace; returns how many runs started. Serialized per workspace. */
  const runOnce = (workspaceId: string): Promise<number> => {
    const current = running.get(workspaceId);

    if (current) {
      dirty.add(workspaceId);

      return current;
    }

    const next = (async () => {
      let total = 0;

      do {
        dirty.delete(workspaceId);

        try {
          total += await process(workspaceId);
        } catch (error) {
          logger.warn(`agent runner failed for ${workspaceId}`, error);
        }
      } while (dirty.has(workspaceId));

      return total;
    })().finally(() => running.delete(workspaceId));
    running.set(workspaceId, next);

    return next;
  };

  const poll = async () => {
    try {
      for (const workspaceId of await engine.workspaces.list()) {
        void runOnce(workspaceId);
      }
    } catch (error) {
      logger.warn('agent poll failed', error);
    }
  };

  return {
    start(): void {
      if (timer) {
        return;
      }

      unsubscribe = engine.events.subscribeAll((workspaceId) => {
        void runOnce(workspaceId);
      });
      timer = setInterval(() => void poll(), pollIntervalMs);
      timer.unref();
      void poll();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
      }

      timer = null;
      unsubscribe?.();
      unsubscribe = null;
    },
    runOnce,
  };
};

export type AgentRunner = ReturnType<typeof createAgentRunner>;
