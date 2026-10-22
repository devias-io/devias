import { NOTES_DEFAULT_LIMIT, type NoteInput, type NotePatch } from '@devias/core';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useClient } from '../providers/client';
import { keys } from '../query/keys';
import { errorMessage } from './use-mutations';

/** A record's notes, newest first, a page at a time. */
export const useNotes = (object: string, id: string, pageSize = NOTES_DEFAULT_LIMIT) => {
  const client = useClient();

  return useInfiniteQuery({
    queryKey: [...keys.notes(client.workspaceId, object, id), pageSize],
    queryFn: ({ pageParam }) =>
      client.notes.list(object, id, { limit: pageSize, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
};

const useNoteMutation = <V>(
  object: string,
  id: string,
  run: (client: ReturnType<typeof useClient>, input: V) => Promise<unknown>,
) => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: V) => run(client, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.notes(client.workspaceId, object, id) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
};

export const useAddNote = (object: string, id: string) =>
  useNoteMutation<NoteInput>(object, id, (client, input) => client.notes.create(object, id, input));

export const useUpdateNote = (object: string, id: string) =>
  useNoteMutation<{ noteId: string; patch: NotePatch }>(object, id, (client, { noteId, patch }) =>
    client.notes.update(object, id, noteId, patch),
  );

export const useDeleteNote = (object: string, id: string) =>
  useNoteMutation<string>(object, id, (client, noteId) => client.notes.delete(object, id, noteId));
