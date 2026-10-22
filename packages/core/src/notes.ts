import { z } from 'zod';
import { ActorSchema } from './events';

/**
 * A record's notes: free-form, titled, editable text kept on any record (a person, a deal, an invoice). They
 * belong to the record rather than being records themselves, so they need no object, no relation and no
 * layout: every record page has them. Written as the caller, newest first.
 */

export const NOTE_TITLE_MAX_LENGTH = 200;
export const NOTE_BODY_MAX_LENGTH = 10_000;
export const NOTES_DEFAULT_LIMIT = 20;
export const NOTES_MAX_LIMIT = 100;

export const NoteSchema = z
  .object({
    id: z.string(),
    /** API name of the record's object. */
    object: z.string(),
    recordId: z.string(),
    title: z.string(),
    /** Text, shown as Markdown; empty when the note has only a title. */
    body: z.string(),
    author: ActorSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'Note' });
export type Note = z.infer<typeof NoteSchema>;

export const NoteInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the note a title').max(NOTE_TITLE_MAX_LENGTH),
    body: z.string().max(NOTE_BODY_MAX_LENGTH).optional(),
  })
  .meta({ id: 'NoteInput' });
export type NoteInput = z.infer<typeof NoteInputSchema>;

export const NotePatchSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the note a title').max(NOTE_TITLE_MAX_LENGTH).optional(),
    body: z.string().max(NOTE_BODY_MAX_LENGTH).optional(),
  })
  .refine((patch) => patch.title !== undefined || patch.body !== undefined, 'Nothing to change')
  .meta({ id: 'NotePatch' });
export type NotePatch = z.infer<typeof NotePatchSchema>;

export const NoteQuerySchema = z
  .object({
    /** From a previous page's `nextCursor`. */
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(NOTES_MAX_LIMIT).optional(),
  })
  .meta({ id: 'NoteQuery' });
export type NoteQuery = z.infer<typeof NoteQuerySchema>;

export const NotePageSchema = z
  .object({
    items: z.array(NoteSchema),
    nextCursor: z.string().nullable(),
    /** How many notes the record has in all. */
    total: z.number().int(),
  })
  .meta({ id: 'NotePage' });
export type NotePage = z.infer<typeof NotePageSchema>;

/** Note cursors continue after one note: when it was written, then its id as the tie-break. */
export const encodeNoteCursor = (createdAt: string, id: string): string => `${createdAt}|${id}`;
export const decodeNoteCursor = (cursor: string): { createdAt: string; id: string } | undefined => {
  const at = cursor.lastIndexOf('|');

  if (at <= 0 || at === cursor.length - 1) {
    return undefined;
  }

  const createdAt = cursor.slice(0, at);

  return Number.isNaN(Date.parse(createdAt)) ? undefined : { createdAt, id: cursor.slice(at + 1) };
};
