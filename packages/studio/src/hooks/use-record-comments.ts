import { RECORD_COMMENTS_DEFAULT_LIMIT, type RecordCommentInput, type RecordCommentPatch } from '@devias/core';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useClient } from '../providers/client';
import { keys } from '../query/keys';
import { errorMessage } from './use-mutations';

/** A record's comments, newest first, a page at a time. */
export const useRecordComments = (object: string, id: string, pageSize = RECORD_COMMENTS_DEFAULT_LIMIT) => {
  const client = useClient();

  return useInfiniteQuery({
    queryKey: [...keys.comments(client.workspaceId, object, id), pageSize],
    queryFn: ({ pageParam }) =>
      client.comments.list(object, id, { limit: pageSize, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
};

const useRecordCommentMutation = <V>(
  object: string,
  id: string,
  run: (client: ReturnType<typeof useClient>, input: V) => Promise<unknown>,
) => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: V) => run(client, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.comments(client.workspaceId, object, id) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
};

export const useAddRecordComment = (object: string, id: string) =>
  useRecordCommentMutation<RecordCommentInput>(object, id, (client, input) =>
    client.comments.create(object, id, input),
  );

export const useUpdateRecordComment = (object: string, id: string) =>
  useRecordCommentMutation<{ commentId: string; patch: RecordCommentPatch }>(
    object,
    id,
    (client, { commentId, patch }) => client.comments.update(object, id, commentId, patch),
  );

export const useDeleteRecordComment = (object: string, id: string) =>
  useRecordCommentMutation<string>(object, id, (client, commentId) => client.comments.delete(object, id, commentId));
