import {
  anchorOf,
  cleanDocumentBody,
  collapseText,
  DeviasApiError,
  DOCUMENT_EDIT_WINDOW_MINUTES,
  DOCUMENT_IDS_MAX,
  DOCUMENTS_DEFAULT_LIMIT,
  type Document,
  type DocumentActivityEntry,
  type DocumentActivityPage,
  type DocumentAppend,
  DocumentAppendSchema,
  type DocumentComment,
  type DocumentCommentInput,
  DocumentCommentInputSchema,
  type DocumentCommentPatch,
  DocumentCommentPatchSchema,
  type DocumentInput,
  DocumentInputSchema,
  type DocumentPage,
  type DocumentPatch,
  DocumentPatchSchema,
  type DocumentQuery,
  DocumentQuerySchema,
  type DocumentSummary,
  type DocumentThreadPage,
  type DocumentThreadsQuery,
  DocumentThreadsQuerySchema,
  decodeDocumentCursor,
  decodeTimelineCursor,
  documentBodyProblem,
  documentIdsOf,
  EMPTY_DOC,
  encodeDocumentCursor,
  encodeTimelineCursor,
  linkOfMention,
  markdownToRichText,
  mentionsOf,
  objectByKey,
  parseLink,
  personOf,
  plainText,
  previewOf,
  type RichTextDoc,
  richTextToMarkdown,
  TIMELINE_DEFAULT_LIMIT,
  type TimelineQuery,
  TimelineQuerySchema,
} from '@devias/core';
import type { MockDocumentComment, MockStore } from './store';

/** Documents over the store's document list, with the server's validation, paging, search and errors. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validation = (message: string, details?: unknown): DeviasApiError =>
  new DeviasApiError(400, 'VALIDATION', message, details);

const assertUuid = (id: string, what: string) => {
  if (!UUID.test(id)) {
    throw validation(`Invalid ${what} id "${id}"`, { id });
  }
};

const bodyOf = (input: { body?: unknown; markdown?: string | undefined }): RichTextDoc | undefined => {
  if (input.markdown !== undefined) {
    return markdownToRichText(input.markdown);
  }

  if (input.body === undefined) {
    return undefined;
  }

  const problem = documentBodyProblem(input.body);

  if (problem) {
    throw validation(problem, { path: 'body' });
  }

  return cleanDocumentBody(input.body as RichTextDoc);
};

const checkedBody = (body: RichTextDoc): RichTextDoc => {
  const problem = documentBodyProblem(body);

  if (problem) {
    throw validation(problem, { path: 'body' });
  }

  return body;
};

const summaryOf = (document: MockDocumentRow): DocumentSummary => ({
  id: document.id,
  title: document.title,
  preview: document.preview,
  version: document.version,
  createdBy: structuredClone(document.createdBy),
  updatedBy: structuredClone(document.updatedBy),
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
});

type MockDocumentRow = MockStore['documents'][number];

const publicDocument = (document: MockDocumentRow): Document => ({
  ...summaryOf(document),
  body: structuredClone(document.body),
  markdown: richTextToMarkdown(document.body),
});

const addActivity = (
  store: MockStore,
  documentId: string,
  kind: DocumentActivityEntry['kind'],
  content: { body?: string; data?: Record<string, unknown> } = {},
): DocumentActivityEntry => {
  const entry: DocumentActivityEntry = {
    id: store.newId(),
    documentId,
    kind,
    actor: structuredClone(store.actor),
    body: content.body ?? null,
    data: content.data ?? null,
    cause: null,
    createdAt: store.now(),
  };
  store.documentActivity.push(entry);

  return entry;
};

/** An edit is on the timeline once per person per stretch of writing, as on the server. */
const noteEdit = (store: MockStore, documentId: string, changes: string[]) => {
  if (changes.length === 0) {
    return;
  }

  const since = Date.parse(store.now()) - DOCUMENT_EDIT_WINDOW_MINUTES * 60_000;
  const actor = JSON.stringify(store.actor);
  const recent = store.documentActivity.some(
    (entry) =>
      entry.documentId === documentId &&
      (entry.kind === 'created' || entry.kind === 'edited') &&
      JSON.stringify(entry.actor) === actor &&
      Date.parse(entry.createdAt) > since,
  );

  if (!recent) {
    addActivity(store, documentId, 'edited', { data: { changes } });
  }
};

const find = (store: MockStore, id: string): MockDocumentRow => {
  assertUuid(id, 'document');
  const document = store.documents.find((candidate) => candidate.id === id && !candidate.deleted);

  if (!document) {
    throw new DeviasApiError(404, 'NOT_FOUND', `Document "${id}" not found`);
  }

  return document;
};

const assertVersion = (document: MockDocumentRow, expected: number | undefined) => {
  if (expected !== undefined && document.version !== expected) {
    throw new DeviasApiError(409, 'CONFLICT', 'This document was changed by someone else since it was read', {
      currentVersion: document.version,
    });
  }
};

/** Does this body mention the target: a record (by object name or id) or a document? */
const mentionMatcher = (store: MockStore, mentions: string): ((body: RichTextDoc) => boolean) => {
  const target = parseLink(mentions);

  if (!target) {
    throw validation('`mentions` must be a link: record:<object>/<id> or document:<id>', { path: 'mentions' });
  }

  assertUuid(target.id, 'target');

  if (target.kind === 'workflow') {
    throw validation('Workflows are not indexed: use a record or a document', { path: 'mentions' });
  }

  const index = store.index();
  const object = target.kind === 'record' ? objectByKey(index, target.object) : undefined;

  if (target.kind === 'record' && !object) {
    throw validation(`Unknown object "${target.object}"`, { path: 'mentions' });
  }

  return (body) =>
    mentionsOf(body).some((mention) => {
      const found = linkOfMention(mention.object, mention.id);

      if (found.id !== target.id) {
        return false;
      }

      return target.kind === 'document'
        ? found.kind === 'document'
        : found.kind === 'record' && objectByKey(index, found.object)?.id === object?.id;
    });
};

export const listDocuments = (store: MockStore, query: DocumentQuery = {}): DocumentPage => {
  const parsed = DocumentQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw validation('Invalid documents query', parsed.error.issues);
  }

  const ids = documentIdsOf(parsed.data.ids);

  if (ids.length > DOCUMENT_IDS_MAX) {
    throw validation(`Name at most ${DOCUMENT_IDS_MAX} ids`, { path: 'ids' });
  }

  for (const id of ids) {
    assertUuid(id, 'document');
  }

  const after = parsed.data.cursor === undefined ? undefined : decodeDocumentCursor(parsed.data.cursor);

  if (parsed.data.cursor !== undefined && !after) {
    throw new DeviasApiError(400, 'INVALID_CURSOR', 'The documents cursor is malformed');
  }

  const needle = parsed.data.search?.toLowerCase();
  const mentions = parsed.data.mentions ? mentionMatcher(store, parsed.data.mentions) : undefined;
  const since = parsed.data.updatedAfter ? new Date(parsed.data.updatedAfter).toISOString() : undefined;
  const all = store.documents
    .filter((document) => !document.deleted)
    .filter((document) => ids.length === 0 || ids.includes(document.id))
    .filter((document) => !since || document.updatedAt > since)
    .filter(
      (document) =>
        !needle ||
        document.title.toLowerCase().includes(needle) ||
        plainText(document.body).toLowerCase().includes(needle),
    )
    .filter((document) => !mentions || mentions(document.body))
    .sort((a, b) => (a.updatedAt === b.updatedAt ? b.id.localeCompare(a.id) : b.updatedAt.localeCompare(a.updatedAt)));
  const rest = after
    ? all.filter(
        (document) =>
          document.updatedAt < after.updatedAt ||
          (document.updatedAt === after.updatedAt && document.id.localeCompare(after.id) < 0),
      )
    : all;
  const limit = parsed.data.limit ?? DOCUMENTS_DEFAULT_LIMIT;
  const page = rest.slice(0, limit);
  const last = page.at(-1);

  return {
    items: page.map(summaryOf),
    nextCursor: rest.length > limit && last ? encodeDocumentCursor(last.updatedAt, last.id) : null,
    total: all.length,
  };
};

export const getDocument = (store: MockStore, id: string): Document => publicDocument(find(store, id));

export const createDocument = (store: MockStore, input: DocumentInput): Document => {
  const parsed = DocumentInputSchema.safeParse(input);

  if (!parsed.success) {
    throw validation('Invalid document', parsed.error.issues);
  }

  const body = checkedBody(bodyOf(parsed.data) ?? EMPTY_DOC);
  const now = store.now();
  const text = plainText(body);
  const document: MockDocumentRow = {
    id: store.newId(),
    title: parsed.data.title,
    body,
    preview: previewOf(text),
    version: 1,
    createdBy: structuredClone(store.actor),
    updatedBy: structuredClone(store.actor),
    createdAt: now,
    updatedAt: now,
  };
  store.documents.push(document);
  addActivity(store, document.id, 'created');
  store.emit({ type: 'document.changed', documentId: document.id, action: 'created' });

  return publicDocument(document);
};

export const updateDocument = (store: MockStore, id: string, patch: DocumentPatch): Document => {
  assertUuid(id, 'document');
  const parsed = DocumentPatchSchema.safeParse(patch);

  if (!parsed.success) {
    throw validation('Invalid document', parsed.error.issues);
  }

  const body = bodyOf(parsed.data);

  if (body) {
    checkedBody(body);
  }

  const document = find(store, id);
  assertVersion(document, parsed.data.expectedVersion);

  const changedTitle = parsed.data.title !== undefined && parsed.data.title !== document.title;

  if (parsed.data.title !== undefined) {
    document.title = parsed.data.title;
  }

  if (body) {
    document.body = body;
    document.preview = previewOf(plainText(body));
  }

  document.version += 1;
  document.updatedBy = structuredClone(store.actor);
  document.updatedAt = store.now();
  noteEdit(store, document.id, [
    ...(parsed.data.title !== undefined && changedTitle ? ['title'] : []),
    ...(body ? ['text'] : []),
  ]);
  store.emit({ type: 'document.changed', documentId: document.id, action: 'updated' });

  return publicDocument(document);
};

export const appendToDocument = (store: MockStore, id: string, input: DocumentAppend): Document => {
  assertUuid(id, 'document');
  const parsed = DocumentAppendSchema.safeParse(input);

  if (!parsed.success) {
    throw validation('Invalid text to add', parsed.error.issues);
  }

  const document = find(store, id);
  assertVersion(document, parsed.data.expectedVersion);
  const kept = [...(document.body.content ?? [])];

  // An empty document is one empty paragraph; what is added replaces it rather than following it.
  while (kept.length > 0 && kept[kept.length - 1]?.type === 'paragraph' && !kept[kept.length - 1]?.content?.length) {
    kept.pop();
  }

  const body = checkedBody({
    ...document.body,
    type: 'doc',
    content: [...kept, ...(markdownToRichText(parsed.data.markdown).content ?? [])],
  });
  document.body = body;
  document.preview = previewOf(plainText(body));
  document.version += 1;
  document.updatedBy = structuredClone(store.actor);
  document.updatedAt = store.now();
  noteEdit(store, document.id, ['text']);
  store.emit({ type: 'document.changed', documentId: document.id, action: 'updated' });

  return publicDocument(document);
};

export const deleteDocument = (store: MockStore, id: string): void => {
  const document = find(store, id);
  document.deleted = true;
  document.updatedAt = store.now();
  store.emit({ type: 'document.changed', documentId: document.id, action: 'deleted' });
};

const liveComments = (store: MockStore, documentId: string) =>
  store.documentComments.filter((comment) => comment.documentId === documentId && !comment.deleted);

/** The timeline: when it was made and edited, and every comment, newest first. */
export const listDocumentActivity = (store: MockStore, id: string, query: TimelineQuery = {}): DocumentActivityPage => {
  find(store, id);
  const parsed = TimelineQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw validation('Invalid timeline query', parsed.error.issues);
  }

  const after = parsed.data.cursor === undefined ? undefined : decodeTimelineCursor(parsed.data.cursor);

  if (parsed.data.cursor !== undefined && !after) {
    throw new DeviasApiError(400, 'INVALID_CURSOR', 'The timeline cursor is malformed');
  }

  const comments = liveComments(store, id).map(
    (comment): DocumentActivityEntry => ({
      id: comment.id,
      documentId: id,
      kind: 'comment',
      actor: comment.actor,
      body: comment.body,
      data: null,
      cause: comment.cause,
      createdAt: comment.createdAt,
    }),
  );
  const all = [...store.documentActivity.filter((entry) => entry.documentId === id), ...comments].sort((a, b) =>
    a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt),
  );
  const rest = after
    ? all.filter(
        (entry) =>
          entry.createdAt < after.createdAt ||
          (entry.createdAt === after.createdAt && entry.id.localeCompare(after.id) < 0),
      )
    : all;
  const limit = parsed.data.limit ?? TIMELINE_DEFAULT_LIMIT;
  const page = rest.slice(0, limit);
  const last = page.at(-1);

  return {
    items: structuredClone(page),
    nextCursor: rest.length > limit && last ? encodeTimelineCursor(last.createdAt, last.id) : null,
  };
};

const findComment = (store: MockStore, documentId: string, commentId: string): MockDocumentComment => {
  assertUuid(commentId, 'comment');
  const comment = liveComments(store, documentId).find((candidate) => candidate.id === commentId);

  if (!comment) {
    throw new DeviasApiError(404, 'NOT_FOUND', `Comment "${commentId}" not found`);
  }

  return comment;
};

/** The author, or an owner or admin of the workspace, may change what someone wrote. */
const mayChange = (store: MockStore, comment: DocumentComment): boolean => {
  const person = personOf(store.actor);
  const author = personOf(comment.actor);
  const role = store.members.find((member) => member.id === person)?.role;

  return (
    store.actor.kind === 'system' ||
    role === 'owner' ||
    role === 'admin' ||
    (author !== null
      ? author === person
      : comment.actor.kind === store.actor.kind && comment.actor.id === store.actor.id)
  );
};

export const commentOnDocument = (store: MockStore, id: string, input: DocumentCommentInput): DocumentComment => {
  const document = find(store, id);
  const parsed = DocumentCommentInputSchema.safeParse(input);

  if (!parsed.success) {
    throw validation('Invalid comment', parsed.error.issues);
  }

  const { markdown, anchor: given, parent } = parsed.data;

  if (parent !== undefined && findComment(store, id, parent).parentId !== null) {
    throw validation('Reply to the first comment of a thread', { path: 'parent' });
  }

  const anchor = given ? anchorOf(collapseText(plainText(document.body)), given.quote, given) : null;

  if (given && !anchor) {
    throw validation('The quoted text is not in the document', { path: 'anchor.quote' });
  }

  const comment: MockDocumentComment = {
    id: store.newId(),
    documentId: id,
    parentId: parent ?? null,
    actor: structuredClone(store.actor),
    body: markdown,
    anchor,
    resolvedAt: null,
    resolvedBy: null,
    cause: null,
    createdAt: store.now(),
    editedAt: null,
  };
  store.documentComments.push(comment);
  store.emit({ type: 'document.changed', documentId: id, action: 'commented' });

  return structuredClone(comment);
};

export const listDocumentComments = (
  store: MockStore,
  id: string,
  query: DocumentThreadsQuery = {},
): DocumentThreadPage => {
  find(store, id);
  const parsed = DocumentThreadsQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw validation('Invalid comments query', parsed.error.issues);
  }

  const status = parsed.data.status ?? 'open';
  const all = liveComments(store, id);

  return {
    items: structuredClone(
      all
        .filter((comment) => comment.parentId === null)
        .filter((root) => status === 'all' || (status === 'resolved') === (root.resolvedAt !== null))
        .map((root) => ({ comment: root, replies: all.filter((reply) => reply.parentId === root.id) })),
    ),
  };
};

export const updateDocumentComment = (
  store: MockStore,
  id: string,
  commentId: string,
  patch: DocumentCommentPatch,
): DocumentComment => {
  find(store, id);
  const parsed = DocumentCommentPatchSchema.safeParse(patch);

  if (!parsed.success) {
    throw validation('Invalid comment', parsed.error.issues);
  }

  const comment = findComment(store, id, commentId);

  if (parsed.data.markdown !== undefined) {
    if (!mayChange(store, comment)) {
      throw new DeviasApiError(403, 'FORBIDDEN', 'Only the author or an admin can change a comment');
    }

    comment.body = parsed.data.markdown;
    comment.editedAt = store.now();
  }

  if (parsed.data.resolved !== undefined) {
    if (comment.parentId !== null) {
      throw validation('A thread is resolved on its first comment', { path: 'resolved' });
    }

    comment.resolvedAt = parsed.data.resolved ? store.now() : null;
    comment.resolvedBy = parsed.data.resolved ? structuredClone(store.actor) : null;
  }

  store.emit({ type: 'document.changed', documentId: id, action: 'commented' });

  return structuredClone(comment);
};

export const deleteDocumentComment = (store: MockStore, id: string, commentId: string): void => {
  find(store, id);
  const comment = findComment(store, id, commentId);

  if (!mayChange(store, comment)) {
    throw new DeviasApiError(403, 'FORBIDDEN', 'Only the author or an admin can delete a comment');
  }

  for (const candidate of store.documentComments) {
    if (candidate.documentId === id && (candidate.id === commentId || candidate.parentId === commentId)) {
      candidate.deleted = true;
    }
  }

  store.emit({ type: 'document.changed', documentId: id, action: 'commented' });
};
