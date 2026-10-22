import { z } from 'zod';
import { ANCHOR_CONTEXT_LENGTH, ANCHOR_QUOTE_MAX_LENGTH } from './document-anchor';
import { ActorSchema } from './events';
import {
  cleanRichText,
  RICH_TEXT_MAX_DEPTH,
  RICH_TEXT_MAX_LENGTH,
  type RichTextDoc,
  richTextProblem,
} from './rich-text';
import { COMMENT_MAX_LENGTH } from './timeline';

/**
 * A document: a titled page of rich text that mentions records, workflows and other documents with `@`. Documents are
 * not records: they have tables of their own, so nothing but the documents service reads or writes them. The body is
 * the editor's document; `markdown` is the same text for callers that write Markdown (workflows, the agent, the API).
 */

export const DOCUMENT_TITLE_MAX_LENGTH = 200;
/** The size of a body as JSON text, in characters, and how deep it may nest (the same for every rich text the platform stores). */
export const DOCUMENT_BODY_MAX_LENGTH = RICH_TEXT_MAX_LENGTH;
export const DOCUMENT_BODY_MAX_DEPTH = RICH_TEXT_MAX_DEPTH;
export const DOCUMENT_MARKDOWN_MAX_LENGTH = 200_000;
export const DOCUMENT_PREVIEW_LENGTH = 240;
export const DOCUMENTS_DEFAULT_LIMIT = 24;
export const DOCUMENTS_MAX_LIMIT = 100;
export const DOCUMENT_IDS_MAX = 100;

/** The editor's document: a `doc` node holding blocks. Looser below the root, since the editor decides what blocks are. */
export const RichTextDocSchema = z
  .looseObject({ type: z.literal('doc'), content: z.array(z.looseObject({ type: z.string() })).optional() })
  .meta({ id: 'RichTextDoc' }) as unknown as z.ZodType<RichTextDoc>;

export const DocumentSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    /** The first lines of the text, for cards and lists. */
    preview: z.string(),
    /** Counts every write; `expectedVersion` on a change names the one it was made from. */
    version: z.number().int(),
    createdBy: ActorSchema,
    updatedBy: ActorSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'DocumentSummary' });
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

export const DocumentSchema = DocumentSummarySchema.extend({
  /** The editor's document. */
  body: RichTextDocSchema,
  /** The same text as Markdown; mentions are `[Label](record:<object>/<id>)`, `[Label](document:<id>)`. */
  markdown: z.string(),
}).meta({ id: 'Document' });
export type Document = z.infer<typeof DocumentSchema>;

const TitleSchema = z.string().trim().min(1, 'Give the document a title').max(DOCUMENT_TITLE_MAX_LENGTH);
const MarkdownSchema = z.string().max(DOCUMENT_MARKDOWN_MAX_LENGTH);
const VersionSchema = z.number().int().min(1);

export const DocumentInputSchema = z
  .object({
    title: TitleSchema,
    /** The editor's document. Send this or `markdown`, not both; neither makes an empty document. */
    body: RichTextDocSchema.optional(),
    markdown: MarkdownSchema.optional(),
  })
  .refine((input) => input.body === undefined || input.markdown === undefined, 'Send `body` or `markdown`, not both')
  .meta({ id: 'DocumentInput' });
export type DocumentInput = z.input<typeof DocumentInputSchema>;

export const DocumentPatchSchema = z
  .object({
    title: TitleSchema.optional(),
    /** Replaces the whole text. Send this or `markdown`, not both. */
    body: RichTextDocSchema.optional(),
    markdown: MarkdownSchema.optional(),
    /** The version this change was made from; a newer one makes it a `CONFLICT`. Leave it out to overwrite. */
    expectedVersion: VersionSchema.optional(),
  })
  .refine(
    (patch) => patch.title !== undefined || patch.body !== undefined || patch.markdown !== undefined,
    'Nothing to change',
  )
  .refine((patch) => patch.body === undefined || patch.markdown === undefined, 'Send `body` or `markdown`, not both')
  .meta({ id: 'DocumentPatch' });
export type DocumentPatch = z.input<typeof DocumentPatchSchema>;

export const DocumentAppendSchema = z
  .object({
    /** Added after the last block. */
    markdown: z.string().min(1, 'Nothing to add').max(DOCUMENT_MARKDOWN_MAX_LENGTH),
    expectedVersion: VersionSchema.optional(),
  })
  .meta({ id: 'DocumentAppend' });
export type DocumentAppend = z.input<typeof DocumentAppendSchema>;

export const DocumentQuerySchema = z
  .object({
    /** Words of the title or the text. */
    search: z.string().trim().min(1).max(200).optional(),
    /** Only documents that mention this: `record:<object>/<id>` or `document:<id>`. */
    mentions: z.string().min(1).optional(),
    /** Only these documents: ids separated by commas, at most 100. */
    ids: z.string().min(1).optional(),
    /** Only documents changed after this time (ISO 8601). */
    updatedAfter: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), 'Use an ISO 8601 time')
      .optional(),
    /** From a previous page's `nextCursor`. */
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(DOCUMENTS_MAX_LIMIT).optional(),
  })
  .meta({ id: 'DocumentQuery' });
export type DocumentQuery = z.infer<typeof DocumentQuerySchema>;

export const DocumentPageSchema = z
  .object({
    /** Newest change first. */
    items: z.array(DocumentSummarySchema),
    nextCursor: z.string().nullable(),
    /** How many documents match in all. */
    total: z.number().int(),
  })
  .meta({ id: 'DocumentPage' });
export type DocumentPage = z.infer<typeof DocumentPageSchema>;

// ---------------------------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------------------------

/**
 * What a document's timeline holds: when it was made, who edited it (one entry for a run of edits by the same person,
 * not one per save) and the comments written on it.
 */
export const DOCUMENT_ACTIVITY_KINDS = ['created', 'edited', 'comment'] as const;
export type DocumentActivityKind = (typeof DOCUMENT_ACTIVITY_KINDS)[number];

/** Edits by the same person within this many minutes of their last entry are one entry. */
export const DOCUMENT_EDIT_WINDOW_MINUTES = 10;

export const DocumentActivityEntrySchema = z
  .object({
    id: z.string(),
    documentId: z.string(),
    kind: z.enum(DOCUMENT_ACTIVITY_KINDS),
    actor: ActorSchema,
    /** A comment's text, as Markdown. */
    body: z.string().nullable(),
    /** What an `edited` entry says changed: `{ changes: ['title' | 'text'] }`. */
    data: z.record(z.string(), z.unknown()).nullable(),
    /** The run of an agent that made it, when one did. */
    cause: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'DocumentActivityEntry' });
export type DocumentActivityEntry = z.infer<typeof DocumentActivityEntrySchema>;

export const DocumentActivityPageSchema = z
  .object({
    /** Newest first. */
    items: z.array(DocumentActivityEntrySchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: 'DocumentActivityPage' });
export type DocumentActivityPage = z.infer<typeof DocumentActivityPageSchema>;

// ---------------------------------------------------------------------------------------------
// Comments, on the document or on a selection of its text
// ---------------------------------------------------------------------------------------------

export const DocumentCommentAnchorSchema = z
  .object({
    /** The text the comment is on. */
    quote: z.string(),
    /** The text just before and just after it, to tell apart repeats of the quote. */
    prefix: z.string(),
    suffix: z.string(),
    /** Where the quote started in the document's text when the comment was made: a hint. */
    hint: z.number().int(),
  })
  .meta({ id: 'DocumentCommentAnchor' });

export const DocumentCommentSchema = z
  .object({
    id: z.string(),
    documentId: z.string(),
    /** The top-level comment this replies to, or null. */
    parentId: z.string().nullable(),
    actor: ActorSchema,
    /** As Markdown. */
    body: z.string(),
    /** The selection it is on; null for a comment on the document, and for every reply. */
    anchor: DocumentCommentAnchorSchema.nullable(),
    /** When a top-level comment was resolved, and by whom; null while it is open. */
    resolvedAt: z.string().nullable(),
    resolvedBy: ActorSchema.nullable(),
    /** The run of an agent that wrote it. */
    cause: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
    editedAt: z.string().nullable(),
  })
  .meta({ id: 'DocumentComment' });
export type DocumentComment = z.infer<typeof DocumentCommentSchema>;

/**
 * A comment to write. `anchor.quote` is text of the document; the studio sends the context and hint it took from the
 * selection, a caller that only knows the text sends the quote and the engine finds it. `parent` makes it a reply.
 */
export const DocumentCommentInputSchema = z
  .object({
    markdown: z.string().trim().min(1, 'Write something').max(COMMENT_MAX_LENGTH),
    anchor: z
      .object({
        quote: z
          .string()
          .min(1)
          .max(ANCHOR_QUOTE_MAX_LENGTH * 2),
        prefix: z
          .string()
          .max(ANCHOR_CONTEXT_LENGTH * 2)
          .optional(),
        suffix: z
          .string()
          .max(ANCHOR_CONTEXT_LENGTH * 2)
          .optional(),
        hint: z.number().int().min(0).optional(),
      })
      .optional(),
    parent: z.string().min(1).optional(),
  })
  .refine((input) => input.anchor === undefined || input.parent === undefined, 'A reply is on its thread’s text')
  .meta({ id: 'DocumentCommentInput' });
export type DocumentCommentInput = z.input<typeof DocumentCommentInputSchema>;

/** Change a comment: its text (its author, or an admin), or resolve or reopen a top-level one. */
export const DocumentCommentPatchSchema = z
  .object({
    markdown: z.string().trim().min(1, 'Write something').max(COMMENT_MAX_LENGTH).optional(),
    resolved: z.boolean().optional(),
  })
  .refine((patch) => patch.markdown !== undefined || patch.resolved !== undefined, 'Nothing to change')
  .meta({ id: 'DocumentCommentPatch' });
export type DocumentCommentPatch = z.input<typeof DocumentCommentPatchSchema>;

/** A top-level comment and the replies to it, oldest first. */
export const DocumentThreadSchema = z
  .object({
    comment: DocumentCommentSchema,
    replies: z.array(DocumentCommentSchema),
  })
  .meta({ id: 'DocumentThread' });
export type DocumentThread = z.infer<typeof DocumentThreadSchema>;

export const DocumentThreadsQuerySchema = z
  .object({
    /** `open` (default), `resolved` or `all`. */
    status: z.enum(['open', 'resolved', 'all']).optional(),
  })
  .meta({ id: 'DocumentThreadsQuery' });
export type DocumentThreadsQuery = z.infer<typeof DocumentThreadsQuerySchema>;

export const DocumentThreadPageSchema = z
  .object({ items: z.array(DocumentThreadSchema) })
  .meta({ id: 'DocumentThreadPage' });
export type DocumentThreadPage = z.infer<typeof DocumentThreadPageSchema>;

/** The most comments (replies included) one document lists at once. */
export const DOCUMENT_COMMENTS_MAX = 500;

/** The ids of a `DocumentQuery.ids`. */
export const documentIdsOf = (ids: string | undefined): string[] =>
  ids === undefined
    ? []
    : [
        ...new Set(
          ids
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];

/** Document cursors continue after one document: when it changed, then its id as the tie-break. */
export const encodeDocumentCursor = (updatedAt: string, id: string): string => `${updatedAt}|${id}`;
export const decodeDocumentCursor = (cursor: string): { updatedAt: string; id: string } | undefined => {
  const at = cursor.lastIndexOf('|');

  if (at <= 0 || at === cursor.length - 1) {
    return undefined;
  }

  const updatedAt = cursor.slice(0, at);

  return Number.isNaN(Date.parse(updatedAt)) ? undefined : { updatedAt, id: cursor.slice(at + 1) };
};

export const documentBodyProblem = richTextProblem;
export const cleanDocumentBody = cleanRichText;

/** The first characters of a document's plain text, on one line. */
export const previewOf = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, DOCUMENT_PREVIEW_LENGTH);
