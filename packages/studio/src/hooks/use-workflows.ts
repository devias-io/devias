import {
  type RunWorkflowInput,
  WORKFLOW_RUN_DEFAULT_LIMIT,
  type Workflow,
  type WorkflowInput,
  type WorkflowRun,
  type WorkflowRunList,
} from '@devias/core';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useClient } from '../providers/client';
import { keys } from '../query/keys';
import { errorMessage } from './use-mutations';

/** Every workflow of the workspace; kept fresh by live updates. */
export const useWorkflows = () => {
  const client = useClient();

  return useQuery({
    queryKey: keys.workflows(client.workspaceId),
    queryFn: () => client.workflows.list(),
    staleTime: 30_000,
  });
};

/** A workflow's runs, newest first, a page at a time. */
export const useWorkflowRuns = (workflowId: string | null) => {
  const client = useClient();

  return useInfiniteQuery({
    queryKey: keys.workflowRuns(client.workspaceId, workflowId ?? ''),
    queryFn: ({ pageParam }) =>
      client.workflows.runs(workflowId ?? '', {
        limit: WORKFLOW_RUN_DEFAULT_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: workflowId !== null,
  });
};

/** The time zone of this browser, so days start at the person's midnight. */
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Runs per day over the last `days` days, and how every workflow that has run is doing. */
export const useWorkflowActivity = (days: number) => {
  const client = useClient();

  return useQuery({
    queryKey: keys.workflowActivity(client.workspaceId, days),
    queryFn: () => client.workflows.activity({ days, tz: timeZone() }),
    // Switching the period keeps the last figures on screen until the new ones land.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
};

/**
 * What makes a copy of a workflow the workspace's own: the same trigger and steps, off until someone turns it on (the
 * original goes on running, and two would do the work twice).
 */
export const copyOf = (workflow: Workflow): WorkflowInput => ({
  title: `${workflow.title} (copy)`,
  ...(workflow.description ? { description: workflow.description } : {}),
  enabled: false,
  trigger: workflow.trigger,
  steps: workflow.steps,
});

/** Create (no id) or update a workflow. */
export const useSaveWorkflow = () => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<WorkflowInput> & Pick<WorkflowInput, 'title'> }) =>
      id ? client.workflows.update(id, input) : client.workflows.create(input as WorkflowInput),
    onSuccess: (workflow: Workflow) => {
      // Put the saved workflow in the list right away, so the editor can open it before the refetch lands.
      queryClient.setQueryData(keys.workflows(client.workspaceId), (current: Workflow[] | undefined) =>
        current
          ? current.some((w) => w.id === workflow.id)
            ? current.map((w) => (w.id === workflow.id ? workflow : w))
            : [...current, workflow]
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: keys.workflows(client.workspaceId) });
    },
  });
};

export const useDeleteWorkflow = () => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.workflows.delete(id),
    onSuccess: () => {
      toast.success('Workflow deleted');
      void queryClient.invalidateQueries({ queryKey: keys.workflows(client.workspaceId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

/** Run a workflow again on what one of its runs was about; the new run lands at the top of its history. */
export const useRetryWorkflowRun = () => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workflow, runId }: { workflow: Pick<Workflow, 'id' | 'title'>; runId: string }) =>
      client.workflows.retryRun(workflow.id, runId),
    onSuccess: (run: WorkflowRun, { workflow }) => {
      if (run.status === 'succeeded') {
        toast.success(`${workflow.title} ran again`);
      } else {
        toast.error(run.error ?? `${workflow.title} failed again`);
      }

      void queryClient.invalidateQueries({ queryKey: keys.workflows(client.workspaceId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

/** A run that waits for a runner, is being worked on, or waits to try a step again. */
export const isOpenRun = (run: Pick<WorkflowRun, 'status'>): boolean =>
  run.status === 'pending' || run.status === 'running';

/**
 * The runs about one record, newest first, whichever workflow they belong to: what a record page reads to say it is being
 * worked on. Live updates refresh it with the workflows; the interval is for a stream that dropped while a run was open.
 */
export const useRecordWorkflowRuns = (recordId: string) => {
  const client = useClient();

  return useQuery({
    queryKey: keys.recordWorkflowRuns(client.workspaceId, recordId),
    queryFn: () => client.workflows.recordRuns({ recordId }),
    staleTime: 10_000,
    refetchInterval: (query) => (query.state.data?.items.some(isOpenRun) ? 5000 : false),
  });
};

/** The newest runs that were about any record of an object, for a table to mark the rows being worked on. */
const OBJECT_RUNS_LIMIT = 100;

/**
 * The runs about the records of one object, newest first, whichever workflow they belong to: what a table reads to
 * mark its rows that are being worked on, with one question for all of them. Kept fresh like `useRecordWorkflowRuns`.
 */
export const useObjectWorkflowRuns = (objectId: string) => {
  const client = useClient();

  return useQuery({
    queryKey: keys.objectWorkflowRuns(client.workspaceId, objectId),
    queryFn: () => client.workflows.recordRuns({ objectId, limit: OBJECT_RUNS_LIMIT }),
    staleTime: 10_000,
    refetchInterval: (query) => (query.state.data?.items.some(isOpenRun) ? 5000 : false),
  });
};

/** The runs this person started and has not been told the end of, by run id: the workflow's name and when it started. */
const watched = new Map<string, { name: string; at: number }>();
/** A run nobody saw the end of within this long is forgotten rather than announced late. */
const WATCH_MS = 5 * 60_000;

/** What a finished run says besides that it ran: the reason one of its steps gave for doing nothing. */
const noteOf = (run: WorkflowRun): string | undefined => {
  for (const step of [...run.steps].reverse()) {
    const output =
      step.output && typeof step.output === 'object' ? (step.output as Record<string, unknown>) : undefined;

    if (typeof output?.reason === 'string' && output.reason) {
      return output.reason;
    }
  }

  return undefined;
};

/**
 * Tell the person how the runs they started ended, when the runs about this record show it: a run is announced once,
 * wherever they are on the page. Runs started elsewhere, or by someone else, are not announced.
 */
export const useRunOutcomes = (runs: WorkflowRunList | undefined) => {
  useEffect(() => {
    for (const run of runs?.items ?? []) {
      const mine = watched.get(run.id);

      if (!mine || isOpenRun(run)) {
        continue;
      }

      watched.delete(run.id);

      if (Date.now() - mine.at > WATCH_MS) {
        continue;
      }

      const note = noteOf(run);

      if (run.status === 'failed') {
        toast.error(run.error ?? `${mine.name} failed`);
      } else if (note) {
        toast(`${mine.name}: ${note}`);
      } else {
        toast.success(`${mine.name} finished`);
      }
    }
  }, [runs]);
};

/**
 * Run a workflow on a record. The run is queued and the call returns at once: the record page shows it as running and
 * says how it ended (`useRunOutcomes`). A client that carries the run out before it answers gets its result announced
 * here, and the record's object refreshes, since the steps may have changed it.
 */
export const useRunWorkflow = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  const ws = client.workspaceId;

  return useMutation({
    mutationFn: ({ id, recordId }: { id: string; name: string; object?: string; recordId?: string }) => {
      const input: RunWorkflowInput = { ...(recordId ? { recordId } : {}), wait: false };

      return client.workflows.run(id, input);
    },
    onSuccess: (run: WorkflowRun, { name, object }) => {
      if (isOpenRun(run)) {
        watched.set(run.id, { name, at: Date.now() });
        toast(`${name} started`);
      } else if (run.status === 'succeeded') {
        toast.success(`${name} ran`);
      } else {
        toast.error(run.error ?? `${name} failed`);
      }

      if (object && !isOpenRun(run)) {
        void queryClient.invalidateQueries({ queryKey: keys.records(ws, object) });
      }

      void queryClient.invalidateQueries({ queryKey: keys.workflows(ws) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};
