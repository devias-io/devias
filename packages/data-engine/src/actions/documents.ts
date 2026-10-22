import { documentActions as document } from '@devias/core';
import { type Action, type EngineActionDeps, implement } from './types';

/** Documents: titled pages of rich text, in tables of their own. */
export const documentActions = ({ engine }: EngineActionDeps): Action[] => [
  implement(document.list, (query, ctx) => engine.documents.list(ctx, query)),
  implement(document.create, (input, ctx) => engine.documents.create(ctx, input)),
  implement(document.get, ({ id }, ctx) => engine.documents.get(ctx, id)),
  implement(document.update, ({ id, ...patch }, ctx) => engine.documents.update(ctx, id, patch)),
  implement(document.append, ({ id, ...input }, ctx) => engine.documents.append(ctx, id, input)),
  implement(document.listActivity, ({ id, ...query }, ctx) => engine.documents.activity(ctx, id, query)),
  implement(document.comment, ({ id, ...input }, ctx) => engine.documents.comment(ctx, id, input)),
  implement(document.listComments, ({ id, ...query }, ctx) => engine.documents.comments(ctx, id, query)),
  implement(document.updateComment, ({ id, commentId, ...patch }, ctx) =>
    engine.documents.updateComment(ctx, id, commentId, patch),
  ),
  implement(document.deleteComment, ({ id, commentId }, ctx) => engine.documents.deleteComment(ctx, id, commentId)),
  implement(document.delete, ({ id }, ctx) => engine.documents.delete(ctx, id)),
];
