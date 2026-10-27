import {
  DOCUMENTS_DEFAULT_LIMIT,
  type Document,
  type DocumentCommentInput,
  type DocumentCommentPatch,
  type DocumentPatch,
  type DocumentQuery,
  type LinkTarget,
  linkHref,
  TIMELINE_DEFAULT_LIMIT,
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

/** Documents, newest change first, a page at a time; kept fresh by live updates. */
export const useDocuments = (
  query: Pick<DocumentQuery, 'search' | 'mentions'> = {},
  pageSize = DOCUMENTS_DEFAULT_LIMIT,
) => {
  const client = useClient();

  return useInfiniteQuery({
    queryKey: keys.documentList(client.workspaceId, { ...query, pageSize }),
    queryFn: ({ pageParam }) =>
      client.documents.list({ ...query, limit: pageSize, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
};

/** The documents that mention a record or another document. */
export const useDocumentsMentioning = (target: LinkTarget | null, limit = 50) => {
  const client = useClient();
  const mentions = target ? linkHref(target) : null;

  return useQuery({
    queryKey: keys.documentList(client.workspaceId, { mentions, limit }),
    queryFn: () => client.documents.list({ mentions: mentions ?? '', limit }),
    enabled: mentions !== null,
    staleTime: 30_000,
  });
};

/** One document, with its text. */
export const useDocument = (id: string) => {
  const client = useClient();

  return useQuery({
    queryKey: keys.document(client.workspaceId, id),
    queryFn: () => client.documents.get(id),
    retry: false,
  });
};

/** Change a document. A conflict (someone else saved first) is the caller's to handle; nothing is toasted for it. */
export const useUpdateDocument = (id: string) => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: DocumentPatch) => client.documents.update(id, patch),
    onSuccess: (document: Document) => {
      queryClient.setQueryData(keys.document(client.workspaceId, id), document);
      void queryClient.invalidateQueries({ queryKey: [...keys.documents(client.workspaceId), 'list'] });
    },
  });
};

export const useDeleteDocument = () => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client.documents.delete(id),
    onSuccess: () => {
      toast.success('Document deleted');
      void queryClient.invalidateQueries({ queryKey: keys.documents(client.workspaceId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

/** Make an untitled document and open it, its title selected to be typed over. */
export const useNewDocument = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  const { slug } = useWorkspace();
  const navigation = useNavigation();

  return useCallback(async () => {
    try {
      const document = await client.documents.create({ title: UNTITLED_RECORD_LABEL });
      queryClient.setQueryData(keys.document(client.workspaceId, document.id), document);
      void queryClient.invalidateQueries({ queryKey: keys.documents(client.workspaceId) });
      navigation.navigate(links.document(slug, document.id));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, [client, queryClient, slug, navigation]);
};

/** A document's timeline, newest first, a page at a time; kept fresh with the document by live updates. */
export const useDocumentActivity = (id: string, pageSize = TIMELINE_DEFAULT_LIMIT) => {
  const client = useClient();

  return useInfiniteQuery({
    queryKey: keys.documentActivity(client.workspaceId, id),
    queryFn: ({ pageParam }) =>
      client.documents.activity(id, { limit: pageSize, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
};

/** The comment threads of a document, open and resolved, in the order they were started; kept fresh by live updates. */
export const useDocumentComments = (id: string) => {
  const client = useClient();

  return useQuery({
    queryKey: keys.documentComments(client.workspaceId, id),
    queryFn: () => client.documents.comments(id, { status: 'all' }),
  });
};

/** A change to a comment shows in the threads and, for the person who looks, in the activity. */
const useRefreshComments = (id: string) => {
  const client = useClient();
  const queryClient = useQueryClient();

  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.documentComments(client.workspaceId, id) }),
      queryClient.invalidateQueries({ queryKey: keys.documentActivity(client.workspaceId, id) }),
    ]);
};

/** Write a comment: on the document, on a stretch of its text (`anchor`), or in a thread (`parent`). */
export const useCommentOnDocument = (id: string) => {
  const client = useClient();
  const refresh = useRefreshComments(id);

  return useMutation({
    mutationFn: (input: DocumentCommentInput) => client.documents.comment(id, input),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(errorMessage(error)),
  });
};

/** Resolve or reopen a thread, or change a comment's text. */
export const useUpdateDocumentComment = (id: string) => {
  const client = useClient();
  const refresh = useRefreshComments(id);

  return useMutation({
    mutationFn: ({ commentId, patch }: { commentId: string; patch: DocumentCommentPatch }) =>
      client.documents.updateComment(id, commentId, patch),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(errorMessage(error)),
  });
};

/** Delete a comment; deleting the first comment of a thread deletes the thread. */
export const useDeleteDocumentComment = (id: string) => {
  const client = useClient();
  const refresh = useRefreshComments(id);

  return useMutation({
    mutationFn: (commentId: string) => client.documents.deleteComment(id, commentId),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(errorMessage(error)),
  });
};
