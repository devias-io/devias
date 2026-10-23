import { z } from 'zod';
import { ActorSchema } from './events';

/**
 * A record's comments: free-form, titled, editable text kept on any record (a person, a deal, an invoice). They
 * belong to the record rather than being records themselves, so they need no object, no relation and no
 * layout: every record page has them. Written as the caller, newest first.
 */

export const RECORD_COMMENT_TITLE_MAX_LENGTH = 200;
export const RECORD_COMMENT_BODY_MAX_LENGTH = 10_000;
export const RECORD_COMMENTS_DEFAULT_LIMIT = 20;
export const RECORD_COMMENTS_MAX_LIMIT = 100;

export const RecordCommentSchema = z
  .object({
    id: z.string(),
    /** API name of the record's object. */
    object: z.string(),
    recordId: z.string(),
    title: z.string(),
    /** Text, shown as Markdown; empty when the comment has only a title. */
    body: z.string(),
    author: ActorSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'RecordComment' });
export type RecordComment = z.infer<typeof RecordCommentSchema>;

export const RecordCommentInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the comment a title').max(RECORD_COMMENT_TITLE_MAX_LENGTH),
    body: z.string().max(RECORD_COMMENT_BODY_MAX_LENGTH).optional(),
  })
  .meta({ id: 'RecordCommentInput' });
export type RecordCommentInput = z.infer<typeof RecordCommentInputSchema>;

export const RecordCommentPatchSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the comment a title').max(RECORD_COMMENT_TITLE_MAX_LENGTH).optional(),
    body: z.string().max(RECORD_COMMENT_BODY_MAX_LENGTH).optional(),
  })
  .refine((patch) => patch.title !== undefined || patch.body !== undefined, 'Nothing to change')
  .meta({ id: 'RecordCommentPatch' });
export type RecordCommentPatch = z.infer<typeof RecordCommentPatchSchema>;

export const RecordCommentQuerySchema = z
  .object({
    /** From a previous page's `nextCursor`. */
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(RECORD_COMMENTS_MAX_LIMIT).optional(),
  })
  .meta({ id: 'RecordCommentQuery' });
export type RecordCommentQuery = z.infer<typeof RecordCommentQuerySchema>;

export const RecordCommentPageSchema = z
  .object({
    items: z.array(RecordCommentSchema),
    nextCursor: z.string().nullable(),
    /** How many comments the record has in all. */
    total: z.number().int(),
  })
  .meta({ id: 'RecordCommentPage' });
export type RecordCommentPage = z.infer<typeof RecordCommentPageSchema>;

/** Comment cursors continue after one comment: when it was written, then its id as the tie-break. */
export const encodeRecordCommentCursor = (createdAt: string, id: string): string => `${createdAt}|${id}`;
export const decodeRecordCommentCursor = (cursor: string): { createdAt: string; id: string } | undefined => {
  const at = cursor.lastIndexOf('|');

  if (at <= 0 || at === cursor.length - 1) {
    return undefined;
  }

  const createdAt = cursor.slice(0, at);

  return Number.isNaN(Date.parse(createdAt)) ? undefined : { createdAt, id: cursor.slice(at + 1) };
};
