import { JOB_RETENTION_DAYS } from '@devias/core';
import type { DataEngine, Logger } from '@devias/data-engine';
import type { ModuleRuntime } from './module-runtime';

export interface JobRunnerOptions {
  engine: DataEngine;
  runtime: Pick<ModuleRuntime, 'runJob' | 'enqueueDueSchedules'>;
  logger: Logger;
  /** How often it looks for due jobs (default 1 s). */
  pollIntervalMs?: number;
  /** How often it queues the jobs of schedules that came due (default 30 s). */
  scheduleIntervalMs?: number;
  /** Jobs taken per pass (default 10). */
  batchSize?: number;
  /** How long a worker holds a job before another may take it over (default 10 minutes). */
  leaseMs?: number;
  clock?: () => Date;
}

const DAY_MS = 86_400_000;

/**
 * Works through modules' background jobs, next to the workflow runner. Every pass takes a batch of due jobs (across
 * workspaces, `FOR UPDATE SKIP LOCKED`, so several servers can share the queue), runs them one by one through the
 * module runtime, and records each outcome there. It also queues the jobs of module schedules that came due, and drops
 * finished jobs past their retention.
 */
export const createJobRunner = (options: JobRunnerOptions) => {
  const { engine, runtime, logger } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const scheduleIntervalMs = options.scheduleIntervalMs ?? 30_000;
  const batchSize = options.batchSize ?? 10;
  const leaseMs = options.leaseMs ?? 10 * 60_000;
  const clock = options.clock ?? (() => new Date());
  let timer: NodeJS.Timeout | null = null;
  let scheduleTimer: NodeJS.Timeout | null = null;
  let busy: Promise<number> | null = null;
  let lastPrune = 0;

  /** Take and run due jobs until none are left; returns how many ran. One pass at a time per server. */
  const runOnce = (): Promise<number> => {
    if (busy) {
      return busy;
    }

    busy = (async () => {
      let ran = 0;

      for (;;) {
        const claimed = await engine.jobs.claim({ limit: batchSize, leaseMs });

        for (const job of claimed) {
          try {
            await runtime.runJob(job);
          } catch (error) {
            // Recording the outcome failed; the lease runs out and the job is taken again.
            logger.error(`job ${job.moduleId}/${job.name} (${job.id}) could not be recorded`, error);
          }

          ran += 1;
        }

        if (claimed.length < batchSize) {
          break;
        }
      }

      return ran;
    })().finally(() => {
      busy = null;
    });

    return busy;
  };

  /** Queue what schedules owe, then prune finished jobs once an hour. */
  const tickSchedules = async (now: Date = clock()): Promise<number> => {
    const queued = await runtime.enqueueDueSchedules(now);

    if (now.getTime() - lastPrune > 3_600_000) {
      lastPrune = now.getTime();
      await engine.jobs.prune(new Date(now.getTime() - JOB_RETENTION_DAYS * DAY_MS));
    }

    return queued;
  };

  return {
    start(): void {
      if (timer) {
        return;
      }

      timer = setInterval(() => {
        void runOnce().catch((error) => logger.warn('job pass failed', error));
      }, pollIntervalMs);
      timer.unref();
      scheduleTimer = setInterval(() => {
        void tickSchedules().catch((error) => logger.warn('schedule tick failed', error));
      }, scheduleIntervalMs);
      scheduleTimer.unref();
      void tickSchedules().catch((error) => logger.warn('schedule tick failed', error));
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
      }

      if (scheduleTimer) {
        clearInterval(scheduleTimer);
      }

      timer = null;
      scheduleTimer = null;
    },
    runOnce,
    tickSchedules,
  };
};

export type JobRunner = ReturnType<typeof createJobRunner>;
