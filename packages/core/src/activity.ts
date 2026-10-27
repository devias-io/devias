import { z } from 'zod';
import { ActorSchema } from './events';

/**
 * A record's activity: what changed on it, when and by whom, newest first.
 * Built from the workspace event log, so it goes back to the record's creation.
 */

export const ActivityChangeSchema = z
  .object({
    /** Field API name; the field may have been renamed or removed since. */
    field: z.string(),
    before: z.unknown(),
    after: z.unknown(),
  })
  .meta({ id: 'ActivityChange' });
export type ActivityChange = z.infer<typeof ActivityChangeSchema>;

const entry = {
  /** Unique within the record's activity. */
  id: z.string(),
  /** Position in the workspace event log. */
  sequence: z.number().int(),
  actor: ActorSchema,
  occurredAt: z.string(),
};

export const ActivityEntrySchema = z
  .discriminatedUnion('kind', [
    z.object({ ...entry, kind: z.literal('created') }),
    z.object({ ...entry, kind: z.literal('updated'), changes: z.array(ActivityChangeSchema) }),
    z.object({ ...entry, kind: z.literal('deleted') }),
  ])
  .meta({ id: 'ActivityEntry' });
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

export const ActivityPageSchema = z
  .object({ items: z.array(ActivityEntrySchema), nextCursor: z.string().nullable() })
  .meta({ id: 'ActivityPage' });
export type ActivityPage = z.infer<typeof ActivityPageSchema>;

export const ACTIVITY_DEFAULT_LIMIT = 50;
export const ACTIVITY_MAX_LIMIT = 200;

export const ActivityQuerySchema = z
  .object({
    /** From a previous page's `nextCursor`. */
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(ACTIVITY_MAX_LIMIT).optional(),
  })
  .meta({ id: 'ActivityQuery' });
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;

/** Activity cursors are the sequence to continue before. */
export const encodeActivityCursor = (sequence: number): string => String(sequence);
export const decodeActivityCursor = (cursor: string): number | undefined => {
  const sequence = Number(cursor);

  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : undefined;
};
