import type { AggregateQuery, Page, Query, RecordData, RecordsQueryResult } from '@devias/core';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useClient } from '../providers/client';
import { keys } from '../query/keys';

export const useRecords = <T extends RecordData = RecordData>(
  query: Query | null,
  options: { enabled?: boolean } = {},
) => {
  const client = useClient();

  return useQuery({
    queryKey: query ? keys.list(client.workspaceId, query) : keys.records(client.workspaceId, '__disabled__'),
    queryFn: () => client.records.list<T>(query as Query),
    enabled: Boolean(query) && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  });
};

/**
 * Counts and totals over an object's records (`client.records.aggregate`); they refresh with its records, and keep
 * showing the previous result while a changed query loads.
 */
export const useAggregate = (query: AggregateQuery | null) => {
  const client = useClient();

  return useQuery({
    queryKey: query
      ? [...keys.records(client.workspaceId, query.object), 'aggregate', query]
      : keys.records(client.workspaceId, '__disabled__'),
    queryFn: () => client.records.aggregate(query as AggregateQuery),
    enabled: Boolean(query),
    placeholderData: keepPreviousData,
  });
};

export const useRecord = <T extends RecordData = RecordData>(object: string, id: string | undefined) => {
  const client = useClient();

  return useQuery({
    queryKey: keys.detail(client.workspaceId, object, id ?? '__none__'),
    queryFn: () => client.records.get<T>(object, id as string),
    enabled: Boolean(id),
  });
};

export const useRecordCount = (object: string) => {
  const client = useClient();

  return useQuery({
    queryKey: keys.count(client.workspaceId, object),
    queryFn: async () => (await client.records.list({ object, limit: 1, count: true })).totalCount ?? 0,
    staleTime: 60_000,
  });
};

const mergeIncluded = (pages: Page[]): Record<string, RecordData[]> => {
  const out: Record<string, RecordData[]> = {};

  for (const page of pages) {
    for (const [key, records] of Object.entries(page.included ?? {})) {
      const list = out[key] ?? [];
      list.push(...records);
      out[key] = list;
    }
  }

  return out;
};

/** Cursor-paginated records shaped as the `RecordsQueryResult` view types receive. */
export const useInfiniteRecords = (query: Query, options: { enabled?: boolean } = {}): RecordsQueryResult => {
  const client = useClient();
  const result = useInfiniteQuery({
    queryKey: keys.list(client.workspaceId, query),
    queryFn: ({ pageParam }) => client.records.list({ ...query, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  });
  const { data, isPending, isFetchingNextPage, hasNextPage, fetchNextPage, error, refetch } = result;

  return useMemo<RecordsQueryResult>(() => {
    const pages = data?.pages ?? [];

    return {
      items: pages.flatMap((p) => p.items),
      included: mergeIncluded(pages),
      isLoading: isPending,
      isFetchingNextPage,
      hasNextPage: Boolean(hasNextPage),
      fetchNextPage: () => {
        if (hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      totalCount: pages[0]?.totalCount,
      error: error ?? undefined,
      refetch: () => {
        void refetch();
      },
    };
  }, [data, isPending, isFetchingNextPage, hasNextPage, fetchNextPage, error, refetch]);
};
