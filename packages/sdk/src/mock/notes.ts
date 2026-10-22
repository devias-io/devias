import {
  DeviasApiError,
  decodeNoteCursor,
  encodeNoteCursor,
  NOTES_DEFAULT_LIMIT,
  type Note,
  type NoteInput,
  NoteInputSchema,
  type NotePage,
  type NotePatch,
  NotePatchSchema,
  type NoteQuery,
  NoteQuerySchema,
} from '@devias/core';
import { resolveObject } from './records';
import type { MockStore } from './store';

/** A record's notes over the store's note list, with the server's paging, validation and errors. */

const requireRecord = (store: MockStore, objectName: string, id: string) => {
  const object = resolveObject(store, objectName);

  if (!store.liveRecord(object.id, id)) {
    throw new DeviasApiError(404, 'NOT_FOUND', `${object.labelSingular} "${id}" not found`);
  }

  return object;
};

const findNote = (store: MockStore, objectId: string, id: string, noteId: string) => {
  const note = store.notes.find(
    (candidate) =>
      candidate.id === noteId && candidate.objectId === objectId && candidate.recordId === id && !candidate.deleted,
  );

  if (!note) {
    throw new DeviasApiError(404, 'NOT_FOUND', `Note "${noteId}" not found`);
  }

  return note;
};

const publicNote = (note: MockStore['notes'][number]): Note => {
  const { objectId: _objectId, deleted: _deleted, ...rest } = note;

  return structuredClone(rest);
};

export const listNotes = (store: MockStore, objectName: string, id: string, query: NoteQuery = {}): NotePage => {
  const object = resolveObject(store, objectName);
  const parsed = NoteQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw new DeviasApiError(400, 'VALIDATION', 'Invalid notes query', parsed.error.issues);
  }

  const after = parsed.data.cursor ? decodeNoteCursor(parsed.data.cursor) : undefined;

  if (parsed.data.cursor && !after) {
    throw new DeviasApiError(400, 'INVALID_CURSOR', 'The notes cursor is malformed');
  }

  const limit = parsed.data.limit ?? NOTES_DEFAULT_LIMIT;
  const all = store.notes
    .filter((note) => note.objectId === object.id && note.recordId === id && !note.deleted)
    .sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)));
  const rest = after
    ? all.filter(
        (note) =>
          note.createdAt < after.createdAt ||
          (note.createdAt === after.createdAt && note.id.localeCompare(after.id) < 0),
      )
    : all;
  const page = rest.slice(0, limit);
  const last = page.at(-1);

  return {
    items: page.map(publicNote),
    nextCursor: rest.length > limit && last ? encodeNoteCursor(last.createdAt, last.id) : null,
    total: all.length,
  };
};

export const createNote = (store: MockStore, objectName: string, id: string, input: NoteInput): Note => {
  const object = requireRecord(store, objectName, id);
  const parsed = NoteInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new DeviasApiError(400, 'VALIDATION', 'Invalid note', parsed.error.issues);
  }

  const now = store.now();
  const note = {
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
  store.notes.push(note);
  store.emit({ type: 'note.created', objectId: object.id, object: object.nameSingular, recordId: id, noteId: note.id });

  return publicNote(note);
};

export const updateNote = (
  store: MockStore,
  objectName: string,
  id: string,
  noteId: string,
  patch: NotePatch,
): Note => {
  const object = resolveObject(store, objectName);
  const parsed = NotePatchSchema.safeParse(patch);

  if (!parsed.success) {
    throw new DeviasApiError(400, 'VALIDATION', 'Invalid note', parsed.error.issues);
  }

  const note = findNote(store, object.id, id, noteId);

  if (parsed.data.title !== undefined) {
    note.title = parsed.data.title;
  }

  if (parsed.data.body !== undefined) {
    note.body = parsed.data.body;
  }

  note.updatedAt = store.now();
  store.emit({ type: 'note.updated', objectId: object.id, object: object.nameSingular, recordId: id, noteId });

  return publicNote(note);
};

/** The mock's user owns the workspace, so any note can be edited or removed. */
export const deleteNote = (store: MockStore, objectName: string, id: string, noteId: string): void => {
  const object = resolveObject(store, objectName);
  findNote(store, object.id, id, noteId).deleted = true;
  store.emit({ type: 'note.deleted', objectId: object.id, object: object.nameSingular, recordId: id, noteId });
};
