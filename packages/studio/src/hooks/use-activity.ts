import { ACTIVITY_DEFAULT_LIMIT } from '@devias/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useClient } from '../providers/client';
import { keys } from '../query/keys';

/** A record's activity, newest first, a page at a time. */
export const useActivity = (object: string, id: string) => {
  const client = useClient();

  return useInfiniteQuery({
    queryKey: keys.activity(client.workspaceId, object, id),
    queryFn: ({ pageParam }) =>
      client.activity.list(object, id, { limit: ACTIVITY_DEFAULT_LIMIT, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
};
