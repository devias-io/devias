import {
  coreIds,
  type Document,
  DocumentAppendSchema,
  DocumentQuerySchema,
  type DocumentSummary,
  linkHref,
} from '@devias/core';
import { z } from 'zod';
import { rewriteWarning, withWarnings } from '../helpers';
import { carrying, type ToolAdapters } from './types';

const linkOf = (id: string) => linkHref({ kind: 'document', id });

const DocumentId = z.string().min(1).describe('Document id');

/** A document in a list: what the model needs to pick one, never its text. */
const summaryOf = (document: DocumentSummary) => ({
  id: document.id,
  title: document.title,
  preview: document.preview,
  version: document.version,
  updatedAt: document.updatedAt,
  link: linkOf(document.id),
});

/** A document as the model reads it: its text as Markdown, never the editor's JSON. */
const shapeDocument = (document: Document) => ({
  id: document.id,
  title: document.title,
  markdown: document.markdown,
  version: document.version,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
  link: linkOf(document.id),
});

const IdOnly = z.object({ id: DocumentId });

/** The model reads and writes documents as Markdown, with a link back; the actions do the work. */
export const documentAdapters: ToolAdapters = {
  [coreIds.actions.list_documents]: {
    input: DocumentQuerySchema.pick({ search: true, mentions: true, cursor: true, limit: true }),
    shape: (page) => ({
      documents: page.items.map(summaryOf),
      total: page.total,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    }),
  },
  [coreIds.actions.get_document]: { input: IdOnly, shape: shapeDocument },
  [coreIds.actions.create_document]: {
    input: z.object({
      title: z.string().trim().min(1).max(200),
      markdown: z.string().max(200_000).optional().describe('The text, as Markdown'),
    }),
    shape: (document) => ({ created: true, ...shapeDocument(document) }),
  },
  [coreIds.actions.update_document]: {
    input: z
      .object({
        id: DocumentId,
        title: z.string().trim().min(1).max(200).optional(),
        markdown: z.string().max(200_000).optional().describe('The whole new text, as Markdown'),
        expectedVersion: z.number().int().min(1).optional().describe('The version you read; a newer one is a conflict'),
      })
      .refine((input) => input.title !== undefined || input.markdown !== undefined, 'Nothing to change'),
    // Replacing the text goes through Markdown: say what the document held that Markdown cannot carry.
    toAction: async (input, { read }) => {
      const current =
        input.markdown === undefined
          ? null
          : ((await read(coreIds.actions.get_document, { id: input.id }).catch(() => null)) as Document | null);
      const warning = current ? rewriteWarning('document', current.body) : null;

      return carrying(input, warning ? [warning] : []);
    },
    shape: (document, _input, _context, warnings: string[]) =>
      withWarnings({ updated: true, ...shapeDocument(document) }, warnings),
  },
  [coreIds.actions.append_to_document]: {
    input: DocumentAppendSchema.extend({ id: DocumentId }),
    shape: (document) => ({ appended: true, ...shapeDocument(document) }),
  },
  [coreIds.actions.delete_document]: {
    input: IdOnly,
    shape: (_output, { id }) => ({ deleted: true, id }),
  },
  [coreIds.actions.comment_on_document]: {
    input: z.object({
      id: DocumentId,
      markdown: z.string().trim().min(1).max(20_000).describe('The comment, as Markdown'),
      quote: z.string().min(1).max(1000).optional().describe('Text of the document the comment is on'),
      replyTo: z.string().min(1).optional().describe('The id of the first comment of the thread to answer'),
    }),
    toAction: ({ id, markdown, quote, replyTo }) => ({
      id,
      markdown,
      ...(quote ? { anchor: { quote } } : {}),
      ...(replyTo ? { parent: replyTo } : {}),
    }),
    shape: (comment, { id }) => ({ commented: true, id: comment.id, documentId: id, link: linkOf(id) }),
  },
};
