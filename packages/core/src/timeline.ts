import { z } from 'zod';

/**
 * What the timelines of tasks and documents share: the comments people and agents write, the way a timeline is paged
 * (newest first, a cursor after the last entry) and how long a comment may be. Each entity has its own kinds of
 * entries and its own entry shape; the table behind them is one (`entity_activity`).
 */

export const COMMENT_MAX_LENGTH = 20_000;
export const TIMELINE_DEFAULT_LIMIT = 50;
export const TIMELINE_MAX_LIMIT = 100;

export const TimelineQuerySchema = z
  .object({
    /** From a previous page's `nextCursor`. */
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(TIMELINE_MAX_LIMIT).optional(),
  })
  .meta({ id: 'TimelineQuery' });
export type TimelineQuery = z.infer<typeof TimelineQuerySchema>;

export const CommentSchema = z
  .object({
    /** The comment, as Markdown; mention with `[Label](record:<object>/<id>)`, `[Name](member:<userId>)`. */
    markdown: z.string().trim().min(1, 'Write something').max(COMMENT_MAX_LENGTH),
  })
  .meta({ id: 'Comment' });
export type Comment = z.infer<typeof CommentSchema>;

/** Timeline cursors continue after one entry: when it was made, then its id as the tie-break. */
export const encodeTimelineCursor = (createdAt: string, id: string): string => `${createdAt}|${id}`;
export const decodeTimelineCursor = (cursor: string): { createdAt: string; id: string } | undefined => {
  const at = cursor.lastIndexOf('|');

  if (at <= 0 || at === cursor.length - 1) {
    return undefined;
  }

  const createdAt = cursor.slice(0, at);

  return Number.isNaN(Date.parse(createdAt)) ? undefined : { createdAt, id: cursor.slice(at + 1) };
};
