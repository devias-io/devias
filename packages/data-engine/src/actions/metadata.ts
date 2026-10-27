import {
  type ActionSpec,
  availableBlocks,
  CORE_OWNER,
  commandItemActions,
  describeObject,
  fieldActions,
  getSchema,
  layoutActions,
  listBlocks,
  navItemActions,
  objectActions,
  viewActions,
} from '@devias/core';
import { EngineError } from '../errors';
import type { MetadataCrudService } from '../metadata/service';
import { type Action, type EngineActionDeps, implement } from './types';

interface CrudSpecs<R, I, C> {
  list: ActionSpec<object, R[]>;
  create: ActionSpec<C, R>;
  get: ActionSpec<{ id: string }, R>;
  update: ActionSpec<{ id: string } & Partial<I>, R>;
  delete: ActionSpec<{ id: string }, void>;
}

const crud = <R, I, C = I>(specs: CrudSpecs<R, I, C>, service: MetadataCrudService<R, I, C>): Action[] => [
  implement(specs.list, (_input, ctx) => service.list(ctx)),
  implement(specs.create, (input, ctx) => service.create(ctx, input)),
  implement(specs.get, ({ id }, ctx) => service.get(ctx, id)),
  implement(specs.update, ({ id, ...patch }, ctx) => service.update(ctx, id, patch as Partial<I>)),
  implement(specs.delete, ({ id }, ctx) => service.delete(ctx, id)),
];

/** The workspace schema and CRUD for every metadata entity. */
export const metadataActions = ({ engine }: EngineActionDeps): Action[] => [
  implement(getSchema, (_input, ctx) => engine.metadata.getSchema(ctx), { etag: (schema) => String(schema.version) }),
  implement(listBlocks, async ({ surface = 'record' }, ctx) => {
    const { schema } = await engine.metadata.getSnapshot(ctx.workspaceId);
    const owner = new Map(schema.modules.flatMap((m) => m.blocks.map((block) => [block.id, m.id] as const)));

    return {
      blocks: [...availableBlocks(schema.modules).values()]
        .filter((block) => block.surfaces.includes(surface))
        .map((block) => ({
          id: block.id,
          label: block.label,
          module: owner.get(block.id) ?? CORE_OWNER,
          ...(block.description ? { description: block.description } : {}),
        })),
    };
  }),
  implement(describeObject, async ({ object: ref }, ctx) => {
    const { index } = await engine.metadata.getSnapshot(ctx.workspaceId);
    const object = index.objectsByName.get(ref) ?? index.objectsById.get(ref);

    if (!object) {
      throw new EngineError('NOT_FOUND', `Unknown object "${ref}"`);
    }

    return {
      object,
      fields: index.fieldsByObjectId.get(object.id) ?? [],
      views: index.viewsByObjectId.get(object.id) ?? [],
    };
  }),
  ...crud(objectActions, engine.metadata.objects),
  ...crud(fieldActions, engine.metadata.fields),
  ...crud(viewActions, engine.metadata.views),
  ...crud(layoutActions, engine.metadata.layouts),
  ...crud(navItemActions, engine.metadata.navItems),
  implement(navItemActions.arrange, ({ items }, ctx) => engine.metadata.navItems.arrange(ctx, items)),
  implement(navItemActions.reset, ({ id }, ctx) => engine.metadata.navItems.reset(ctx, id)),
  implement(navItemActions.resetAll, (_input, ctx) => engine.metadata.navItems.resetAll(ctx)),
  ...crud(commandItemActions, engine.metadata.commandItems),
];
