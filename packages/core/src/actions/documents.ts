import { z } from 'zod';
import { coreIds } from '../core-ids';
import {
  DocumentActivityPageSchema,
  DocumentAppendSchema,
  DocumentCommentInputSchema,
  DocumentCommentPatchSchema,
  DocumentCommentSchema,
  DocumentInputSchema,
  DocumentPageSchema,
  DocumentPatchSchema,
  DocumentQuerySchema,
  DocumentSchema,
  DocumentThreadPageSchema,
  DocumentThreadsQuerySchema,
} from '../document';
import { TimelineQuerySchema } from '../timeline';
import { defineActionSpec } from './define';

const tags = ['documents'];
const IdParams = z.object({ id: z.string() });
const DocumentCommentParams = z.object({ id: z.string(), commentId: z.string() });

export const documentActions = {
  list: defineActionSpec({
    id: coreIds.actions.list_documents,
    ai: {
      tool: 'list_documents',
      description:
        'List documents, newest change first, with their titles and a short preview of the text. `search` matches the title and the text; `mentions` keeps the documents that mention a record or another document (a link such as record:<object>/<id> or document:<id>). Read one with get_document. Page with nextCursor.',
    },
    summary: 'List documents',
    description:
      'Newest change first, without their text; page with `nextCursor`. `search` matches the title and the text, `mentions` keeps the documents that mention a record or another document (`record:<object>/<id>`, `document:<id>`), `ids` picks some by id.',
    tags,
    permission: 'document.read',
    query: DocumentQuerySchema,
    output: DocumentPageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/documents',
      errors: [400, 401, 403, 409],
      outputDescription: 'A page of documents',
    },
  }),
  create: defineActionSpec({
    id: coreIds.actions.create_document,
    ai: {
      tool: 'create_document',
      description:
        'Create a document with a title and, optionally, its text as Markdown. Mention a record or a document with a link, [Label](record:<object>/<id>) or [Label](document:<id>); it becomes a live @mention. Returns the new document; call navigate afterwards if the person should see it.',
    },
    summary: 'Create a document',
    description:
      'A title and, optionally, the text as `markdown` (or as an editor document in `body`). Mention a record or a document with a link, `[Label](record:<object>/<id>)` or `[Label](document:<id>)`.',
    tags,
    permission: 'document.write',
    approval: 'auto',
    body: DocumentInputSchema,
    output: DocumentSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/documents',
      status: 201,
      errors: [400, 401, 403],
      bodyDescription: 'The document: a title and, optionally, its text',
      outputDescription: 'Created',
    },
  }),
  get: defineActionSpec({
    id: coreIds.actions.get_document,
    ai: {
      tool: 'get_document',
      description:
        'Read one document: its title and its whole text as Markdown (mentions are links such as [Label](record:<object>/<id>)), and its version. Read a document before changing it, and pass the version as expectedVersion.',
    },
    summary: 'Get a document',
    description: 'The whole document: its text as an editor document (`body`) and as Markdown, and its `version`.',
    tags,
    permission: 'document.read',
    params: IdParams,
    output: DocumentSchema,
    http: { method: 'get', path: '/api/workspaces/{workspaceId}/documents/{id}', outputDescription: 'The document' },
  }),
  update: defineActionSpec({
    id: coreIds.actions.update_document,
    ai: {
      tool: 'update_document',
      description:
        'Change a document’s title, or replace its whole text with `markdown`. Read it first with get_document and pass its version as expectedVersion, so a change made meanwhile is not lost. To add to a document, use append_to_document instead.',
    },
    summary: 'Update a document',
    description:
      'Sends only what changes. A new `body` or `markdown` replaces the whole text. With `expectedVersion`, a document that changed since is a `CONFLICT`; without it the change overwrites.',
    tags,
    permission: 'document.write',
    params: IdParams,
    body: DocumentPatchSchema,
    output: DocumentSchema,
    http: { method: 'patch', path: '/api/workspaces/{workspaceId}/documents/{id}', outputDescription: 'Updated' },
  }),
  append: defineActionSpec({
    id: coreIds.actions.append_to_document,
    ai: {
      tool: 'append_to_document',
      description:
        'Add Markdown after the last block of a document, without reading it first and without touching what a person is typing. Use it to add to a document; use update_document only to rewrite it.',
    },
    summary: 'Add to a document',
    description:
      'Adds Markdown after the last block, atomically: nothing needs reading first, and a person typing meanwhile loses nothing.',
    tags,
    permission: 'document.write',
    approval: 'auto',
    params: IdParams,
    body: DocumentAppendSchema,
    output: DocumentSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/documents/{id}/append',
      status: 200,
      bodyDescription: 'The Markdown to add',
      outputDescription: 'The document with the text added',
    },
  }),
  delete: defineActionSpec({
    id: coreIds.actions.delete_document,
    ai: { tool: 'delete_document', description: 'Delete a document. It stops being listed, readable and linked.' },
    summary: 'Delete a document',
    description: 'The document stops being listed, readable and linked.',
    tags,
    permission: 'document.write',
    params: IdParams,
    http: { method: 'delete', path: '/api/workspaces/{workspaceId}/documents/{id}', outputDescription: 'Deleted' },
  }),
  listActivity: defineActionSpec({
    id: coreIds.actions.list_document_activity,
    summary: 'List a document’s timeline',
    description:
      'When it was made, who edited it and the comments written on it, newest first; page with `nextCursor`.',
    tags,
    permission: 'document.read',
    params: IdParams,
    query: TimelineQuerySchema,
    output: DocumentActivityPageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/documents/{id}/activity',
      errors: [400, 401, 403, 404],
      outputDescription: 'A page of the timeline',
    },
  }),
  comment: defineActionSpec({
    id: coreIds.actions.comment_on_document,
    ai: {
      tool: 'comment_on_document',
      description:
        'Add a comment to a document, as Markdown: a question, a suggestion or a note for whoever reads it. Give `quote`, text copied exactly from the document (read it with get_document), to put the comment on that text: it is underlined for readers and the comment shows beside it. Give `replyTo`, the id of a comment from list_document_comments, to answer in its thread. It does not change the text or its version. Mention a record or a person with [Label](record:<object>/<id>) or [Name](member:<userId>).',
    },
    summary: 'Comment on a document',
    description:
      'Adds a comment as Markdown; mention with `[Label](record:<object>/<id>)` or `[Name](member:<userId>)`. Give `anchor.quote`, text of the document, to put it on that text (the studio underlines it and shows the comment beside it); give `parent`, the id of a top-level comment, to reply to its thread. A comment does not change the document or its version.',
    tags,
    permission: 'document.write',
    approval: 'auto',
    params: IdParams,
    body: DocumentCommentInputSchema,
    output: DocumentCommentSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/documents/{id}/comments',
      status: 201,
      errors: [400, 401, 403, 404],
      bodyDescription: 'The comment: its text, and optionally the text it is on or the comment it replies to',
      outputDescription: 'The comment',
    },
  }),
  listComments: defineActionSpec({
    id: coreIds.actions.list_document_comments,
    ai: { tool: 'list_document_comments' },
    summary: 'List the comments of a document',
    description:
      'Threads: each a top-level comment (with the text it is on, if any, and whether it is resolved) and its replies, oldest first. `status` is `open` (default), `resolved` or `all`.',
    tags,
    permission: 'document.read',
    params: IdParams,
    query: DocumentThreadsQuerySchema,
    output: DocumentThreadPageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/documents/{id}/comments',
      errors: [400, 401, 403, 404],
      outputDescription: 'The threads',
    },
  }),
  updateComment: defineActionSpec({
    id: coreIds.actions.update_document_comment,
    ai: {
      tool: 'update_document_comment',
      description:
        'Resolve or reopen a thread (`resolved`, on its top-level comment), or change a comment’s text (`markdown`; only its author or an admin).',
    },
    summary: 'Change or resolve a comment',
    description:
      'Send `resolved: true` to resolve a top-level comment (and so its thread) or `false` to reopen it; send `markdown` to change the text, which only its author or an admin may do.',
    tags,
    permission: 'document.write',
    approval: 'auto',
    params: DocumentCommentParams,
    body: DocumentCommentPatchSchema,
    output: DocumentCommentSchema,
    http: {
      method: 'patch',
      path: '/api/workspaces/{workspaceId}/documents/{id}/comments/{commentId}',
      errors: [400, 401, 403, 404],
      outputDescription: 'The comment',
    },
  }),
  deleteComment: defineActionSpec({
    id: coreIds.actions.delete_document_comment,
    ai: { tool: 'delete_document_comment' },
    summary: 'Delete a comment',
    description: 'Only its author or an admin may. Deleting a top-level comment deletes its replies.',
    tags,
    permission: 'document.write',
    params: DocumentCommentParams,
    http: {
      method: 'delete',
      path: '/api/workspaces/{workspaceId}/documents/{id}/comments/{commentId}',
      outputDescription: 'Deleted',
    },
  }),
};
