import { DeviasApiError, type Page, type RecordData } from '@devias/core';
import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useClient } from '../providers/client';
import { useLabels } from '../providers/labels';
import { keys } from '../query/keys';

export const errorMessage = (error: unknown): string => {
  if (error instanceof DeviasApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong';
};

const isPage = (data: unknown): data is Page =>
  typeof data === 'object' && data !== null && Array.isArray((data as Page).items);
const isInfinite = (data: unknown): data is InfiniteData<Page> =>
  typeof data === 'object' && data !== null && Array.isArray((data as InfiniteData<Page>).pages);
const isRecord = (data: unknown): data is RecordData =>
  typeof data === 'object' && data !== null && typeof (data as RecordData).id === 'string';

const patchPage = (page: Page, id: string, patch: Record<string, unknown>): Page => ({
  ...page,
  items: page.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
});

/** Apply a record patch to any cached shape: a list page, infinite pages or a detail record. */
export const patchRecordInData = (data: unknown, id: string, patch: Record<string, unknown>): unknown => {
  if (isInfinite(data)) {
    return { ...data, pages: data.pages.map((p) => patchPage(p, id, patch)) };
  }

  if (isPage(data)) {
    return patchPage(data, id, patch);
  }

  if (isRecord(data) && data.id === id) {
    return { ...data, ...patch };
  }

  return data;
};

const removeFromPage = (page: Page, ids: Set<string>): Page => ({
  ...page,
  items: page.items.filter((item) => !ids.has(item.id)),
  totalCount: page.totalCount === undefined ? undefined : Math.max(0, page.totalCount - ids.size),
});

export const removeRecordsFromData = (data: unknown, ids: Set<string>): unknown => {
  if (isInfinite(data)) {
    return { ...data, pages: data.pages.map((p) => removeFromPage(p, ids)) };
  }

  if (isPage(data)) {
    return removeFromPage(data, ids);
  }

  return data;
};

type Snapshot = [readonly unknown[], unknown][];

export const useCreateRecord = (object: string) => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Record<string, unknown>) => client.records.create(object, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.records(client.workspaceId, object) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

/** Optimistic update: patches every cached list/detail for the object, rolls back on error. */
export const useUpdateRecord = (object: string) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const labels = useLabels();
  const ws = client.workspaceId;

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      client.records.update(object, id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: keys.records(ws, object) });
      const snapshot: Snapshot = queryClient.getQueriesData({ queryKey: keys.records(ws, object) });
      queryClient.setQueriesData({ queryKey: keys.records(ws, object) }, (data: unknown) =>
        patchRecordInData(data, id, patch),
      );

      return { snapshot };
    },
    onError: (error, _variables, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data);
      }

      toast.error(errorMessage(error));
    },
    onSuccess: (_record, { id }) => {
      labels.invalidate(object, [id]);
      void queryClient.invalidateQueries({ queryKey: keys.labels(ws, object) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.records(ws, object) });
    },
  });
};

export const useDeleteRecords = (object: string) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const ws = client.workspaceId;

  return useMutation({
    mutationFn: (ids: string[]) => client.records.delete(object, ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: keys.records(ws, object) });
      const snapshot: Snapshot = queryClient.getQueriesData({ queryKey: keys.records(ws, object) });
      const set = new Set(ids);
      queryClient.setQueriesData({ queryKey: keys.records(ws, object) }, (data: unknown) =>
        removeRecordsFromData(data, set),
      );

      return { snapshot };
    },
    onError: (error, _ids, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data);
      }

      toast.error(errorMessage(error));
    },
    onSuccess: (_result, ids) => {
      toast.success(ids.length === 1 ? 'Record deleted' : `${ids.length} records deleted`);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.records(ws, object) });
      void queryClient.invalidateQueries({ queryKey: keys.count(ws, object) });
    },
  });
};
