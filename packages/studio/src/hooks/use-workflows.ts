import { WORKFLOW_RUN_DEFAULT_LIMIT, type Workflow, type WorkflowInput, type WorkflowRun } from '@devias/core';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/** Run a workflow on a record; refreshes the record's object afterwards, since the steps may have changed it. */
export const useRunWorkflow = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  const ws = client.workspaceId;

  return useMutation({
    mutationFn: ({ id, recordId }: { id: string; name: string; object?: string; recordId?: string }) =>
      client.workflows.run(id, recordId ? { recordId } : {}),
    onSuccess: (run: WorkflowRun, { name, object }) => {
      if (run.status === 'succeeded') {
        toast.success(`${name} ran`);
      } else {
        toast.error(run.error ?? `${name} failed`);
      }

      if (object) {
        void queryClient.invalidateQueries({ queryKey: keys.records(ws, object) });
      }

      void queryClient.invalidateQueries({ queryKey: keys.workflows(ws) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};
