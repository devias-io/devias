import type { ObjectMetadata, Query } from '@devias/core';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useClient } from '../../../providers/client';
import { useSchema } from '../../../providers/schema';
import { keys } from '../../../query/keys';

/** The objects people work with: every object but the system ones. */
export const useWorkspaceObjects = (): ObjectMetadata[] => {
  const { schema } = useSchema();

  return useMemo(() => schema.objects.filter((object) => !object.isSystem), [schema.objects]);
};

/** One records query per object, cached and refreshed by the change feed like `useRecords`. */
export const useRecordsPerObject = (objects: ObjectMetadata[], queryOf: (object: ObjectMetadata) => Query) => {
  const client = useClient();

  return useQueries({
    queries: objects.map((object) => {
      const query = queryOf(object);

      return { queryKey: keys.list(client.workspaceId, query), queryFn: () => client.records.list(query) };
    }),
  });
};

/** How many records each object has; `loading` until every count is in. */
export const useRecordCounts = () => {
  const objects = useWorkspaceObjects();
  const results = useRecordsPerObject(objects, (object) => ({ object: object.nameSingular, limit: 1, count: true }));
  const loading = results.some((result) => result.isPending);
  const counts = objects.map((object, i) => {
    const data = results[i]?.data;

    return { object, count: data ? (data.totalCount ?? data.items.length) : 0 };
  });

  return { counts, loading, total: counts.reduce((sum, { count }) => sum + count, 0) };
};

export const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;
