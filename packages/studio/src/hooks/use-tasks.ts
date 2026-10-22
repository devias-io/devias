import {
  type LinkTarget,
  linkHref,
  TASK_ACTIVITY_DEFAULT_LIMIT,
  TASKS_DEFAULT_LIMIT,
  type Task,
  type TaskActivityEntry,
  type TaskCountsQuery,
  type TaskInput,
  type TaskPatch,
  type TaskQuery,
} from '@devias/core';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useClient } from '../providers/client';
import { useWorkspace } from '../providers/workspace';
import { keys } from '../query/keys';
import { links } from '../router/links';
import { useNavigation } from '../router/navigation';
import { UNTITLED_RECORD_LABEL } from '../views/view-state';
import { errorMessage } from './use-mutations';

/** The day the person is in, which "overdue" and "this week" count from. */
export const todayLocal = (): string => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${now.getFullYear()}-${month}-${day}`;
};

/** Tasks, a page at a time; kept fresh by live updates. The caller's day is sent for the due filters. */
export const useTasks = (query: Omit<TaskQuery, 'cursor' | 'limit'> = {}, pageSize = TASKS_DEFAULT_LIMIT) => {
  const client = useClient();
  const withDay = query.due ? { ...query, today: query.today ?? todayLocal() } : query;

  return useInfiniteQuery({
    queryKey: keys.taskList(client.workspaceId, { ...withDay, pageSize }),
    queryFn: ({ pageParam }) =>
      client.tasks.list({ ...withDay, limit: pageSize, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
};

/** The open tasks that mention or are about a record, a document or another task. */
export const useTasksAbout = (target: LinkTarget | null, limit = 50) => {
  const client = useClient();
  const mentions = target ? linkHref(target) : null;

  return useQuery({
    queryKey: keys.taskList(client.workspaceId, { about: mentions, limit }),
    queryFn: () => client.tasks.list({ mentions: mentions ?? '', scope: 'open', sort: 'priority', limit }),
    enabled: mentions !== null,
    staleTime: 30_000,
  });
};

/** One task, with its description. */
export const useTask = (id: string) => {
  const client = useClient();

  return useQuery({
    queryKey: keys.task(client.workspaceId, id),
    queryFn: () => client.tasks.get(id),
    retry: false,
  });
};

/** A task's timeline, newest first, a page at a time. */
export const useTaskActivity = (id: string, pageSize = TASK_ACTIVITY_DEFAULT_LIMIT) => {
  const client = useClient();

  return useInfiniteQuery({
    queryKey: keys.taskActivity(client.workspaceId, id),
    queryFn: ({ pageParam }) =>
      client.tasks.activity(id, { limit: pageSize, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
};

/** The open, overdue and due counts, for the Tasks page and Home. */
export const useTaskCounts = (query: TaskCountsQuery = {}) => {
  const client = useClient();
  const today = query.today ?? todayLocal();

  return useQuery({
    queryKey: [...keys.taskCounts(client.workspaceId), today],
    queryFn: () => client.tasks.counts({ today }),
    staleTime: 15_000,
  });
};

/**
 * Change a task. A conflict (someone else changed it first) is the caller's to handle, so nothing is toasted for it;
 * the task's copy is replaced with the answer.
 */
export const useUpdateTask = (id: string) => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: TaskPatch) => client.tasks.update(id, patch),
    onSuccess: (task: Task) => {
      queryClient.setQueryData(keys.task(client.workspaceId, id), task);
      void queryClient.invalidateQueries({ queryKey: keys.tasks(client.workspaceId) });
    },
  });
};

/** Change any task by id, for the board and the list, where the task is not the page's. */
export const useUpdateAnyTask = () => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) => client.tasks.update(id, patch),
    onSuccess: (task: Task) => {
      queryClient.setQueryData(keys.task(client.workspaceId, task.id), task);
      void queryClient.invalidateQueries({ queryKey: keys.tasks(client.workspaceId) });
    },
  });
};

export const useCreateTask = () => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TaskInput) => client.tasks.create(input),
    onSuccess: (task: Task) => {
      queryClient.setQueryData(keys.task(client.workspaceId, task.id), task);
      void queryClient.invalidateQueries({ queryKey: keys.tasks(client.workspaceId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

export const useDeleteTask = () => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.tasks.delete(id),
    onSuccess: () => {
      toast.success('Task deleted');
      void queryClient.invalidateQueries({ queryKey: keys.tasks(client.workspaceId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

export const useCommentOnTask = (id: string) => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (markdown: string) => client.tasks.comment(id, { markdown }),
    onSuccess: (_entry: TaskActivityEntry) => {
      void queryClient.invalidateQueries({ queryKey: keys.taskActivity(client.workspaceId, id) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

/** Make an untitled task (optionally about a record, or a subtask) and open it, its title selected to be typed over. */
export const useNewTask = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  const { slug } = useWorkspace();
  const navigation = useNavigation();

  return useCallback(
    async (input: Omit<TaskInput, 'title'> = {}) => {
      try {
        const task = await client.tasks.create({ title: UNTITLED_RECORD_LABEL, ...input });
        queryClient.setQueryData(keys.task(client.workspaceId, task.id), task);
        void queryClient.invalidateQueries({ queryKey: keys.tasks(client.workspaceId) });
        navigation.navigate(links.task(slug, task.id));
      } catch (error) {
        toast.error(errorMessage(error));
      }
    },
    [client, queryClient, slug, navigation],
  );
};

/** The attempts an agent made at a task, newest first; kept fresh with the task by live updates. */
export const useTaskRuns = (id: string, enabled: boolean) => {
  const client = useClient();

  return useQuery({
    queryKey: keys.taskRuns(client.workspaceId, id),
    queryFn: () => client.tasks.runs(id),
    enabled,
    refetchInterval: enabled ? 5000 : false,
  });
};

/** Stop the agent working a task, or send a failed or stopped one back to its queue. */
export const useRunControl = (id: string) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const done = (task: Task) => {
    queryClient.setQueryData(keys.task(client.workspaceId, id), task);
    void queryClient.invalidateQueries({ queryKey: keys.tasks(client.workspaceId) });
  };
  const stop = useMutation({
    mutationFn: () => client.tasks.stop(id),
    onSuccess: done,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const retry = useMutation({
    mutationFn: () => client.tasks.retry(id),
    onSuccess: done,
    onError: (error) => toast.error(errorMessage(error)),
  });

  return { stop, retry };
};
