import {
  DeviasApiError,
  decodeRecordCommentCursor,
  encodeRecordCommentCursor,
  RECORD_COMMENTS_DEFAULT_LIMIT,
  type RecordComment,
  type RecordCommentInput,
  RecordCommentInputSchema,
  type RecordCommentPage,
  type RecordCommentPatch,
  RecordCommentPatchSchema,
  type RecordCommentQuery,
  RecordCommentQuerySchema,
} from '@devias/core';
import { resolveObject } from './records';
import type { MockStore } from './store';

/** A record's comments over the store's comment list, with the server's paging, validation and errors. */

const requireRecord = (store: MockStore, objectName: string, id: string) => {
  const object = resolveObject(store, objectName);

  if (!store.liveRecord(object.id, id)) {
    throw new DeviasApiError(404, 'NOT_FOUND', `${object.labelSingular} "${id}" not found`);
  }

  return object;
};

const findRecordComment = (store: MockStore, objectId: string, id: string, commentId: string) => {
  const comment = store.comments.find(
    (candidate) =>
      candidate.id === commentId && candidate.objectId === objectId && candidate.recordId === id && !candidate.deleted,
  );

  if (!comment) {
    throw new DeviasApiError(404, 'NOT_FOUND', `Comment "${commentId}" not found`);
  }

  return comment;
};

const publicRecordComment = (comment: MockStore['comments'][number]): RecordComment => {
  const { objectId: _objectId, deleted: _deleted, ...rest } = comment;

  return structuredClone(rest);
};

export const listRecordComments = (
  store: MockStore,
  objectName: string,
  id: string,
  query: RecordCommentQuery = {},
): RecordCommentPage => {
  const object = resolveObject(store, objectName);
  const parsed = RecordCommentQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw new DeviasApiError(400, 'VALIDATION', 'Invalid comments query', parsed.error.issues);
  }

  const after = parsed.data.cursor ? decodeRecordCommentCursor(parsed.data.cursor) : undefined;

  if (parsed.data.cursor && !after) {
    throw new DeviasApiError(400, 'INVALID_CURSOR', 'The comments cursor is malformed');
  }

  const limit = parsed.data.limit ?? RECORD_COMMENTS_DEFAULT_LIMIT;
  const all = store.comments
    .filter((comment) => comment.objectId === object.id && comment.recordId === id && !comment.deleted)
    .sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)));
  const rest = after
    ? all.filter(
        (comment) =>
          comment.createdAt < after.createdAt ||
          (comment.createdAt === after.createdAt && comment.id.localeCompare(after.id) < 0),
      )
    : all;
  const page = rest.slice(0, limit);
  const last = page.at(-1);

  return {
    items: page.map(publicRecordComment),
    nextCursor: rest.length > limit && last ? encodeRecordCommentCursor(last.createdAt, last.id) : null,
    total: all.length,
  };
};

export const createRecordComment = (
  store: MockStore,
  objectName: string,
  id: string,
  input: RecordCommentInput,
): RecordComment => {
  const object = requireRecord(store, objectName, id);
  const parsed = RecordCommentInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new DeviasApiError(400, 'VALIDATION', 'Invalid comment', parsed.error.issues);
  }

  const now = store.now();
  const comment = {
    id: store.newId(),
    objectId: object.id,
    object: object.nameSingular,
    recordId: id,
    title: parsed.data.title,
    body: parsed.data.body ?? '',
    author: structuredClone(store.actor),
    createdAt: now,
    updatedAt: now,
  };
  store.comments.push(comment);
  store.emit({
    type: 'comment.created',
    objectId: object.id,
    object: object.nameSingular,
    recordId: id,
    commentId: comment.id,
  });

  return publicRecordComment(comment);
};

export const updateRecordComment = (
  store: MockStore,
  objectName: string,
  id: string,
  commentId: string,
  patch: RecordCommentPatch,
): RecordComment => {
  const object = resolveObject(store, objectName);
  const parsed = RecordCommentPatchSchema.safeParse(patch);

  if (!parsed.success) {
    throw new DeviasApiError(400, 'VALIDATION', 'Invalid comment', parsed.error.issues);
  }

  const comment = findRecordComment(store, object.id, id, commentId);

  if (parsed.data.title !== undefined) {
    comment.title = parsed.data.title;
  }

  if (parsed.data.body !== undefined) {
    comment.body = parsed.data.body;
  }

  comment.updatedAt = store.now();
  store.emit({ type: 'comment.updated', objectId: object.id, object: object.nameSingular, recordId: id, commentId });

  return publicRecordComment(comment);
};

/** The mock's user owns the workspace, so any comment can be edited or removed. */
export const deleteRecordComment = (store: MockStore, objectName: string, id: string, commentId: string): void => {
  const object = resolveObject(store, objectName);
  findRecordComment(store, object.id, id, commentId).deleted = true;
  store.emit({ type: 'comment.deleted', objectId: object.id, object: object.nameSingular, recordId: id, commentId });
};
