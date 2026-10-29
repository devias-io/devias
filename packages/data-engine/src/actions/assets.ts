import { assetActions as asset } from '@devias/core';
import { type Action, type EngineActionDeps, implement } from './types';

/** Assets: the files of a workspace. The bytes travel on routes of their own; these are the actions about a file. */
export const assetActions = ({ engine }: EngineActionDeps): Action[] => [
  implement(asset.list, (query, ctx) => engine.assets.list(ctx, query)),
  implement(asset.get, ({ id }, ctx) => engine.assets.get(ctx, id)),
  implement(asset.update, ({ id, ...patch }, ctx) => engine.assets.update(ctx, id, patch)),
  implement(asset.delete, ({ id, force }, ctx) => engine.assets.delete(ctx, id, { force: force === true })),
  implement(asset.link, ({ id, ...input }, ctx) => engine.assets.link(ctx, id, input)),
  implement(asset.usage, ({ id }, ctx) => engine.assets.usage(ctx, id)),
  implement(asset.workspaceUsage, (_input, ctx) => engine.assets.workspaceUsage(ctx)),
];
