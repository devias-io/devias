import { coreIds } from '@devias/core';
import { z } from 'zod';
import { fieldSummary, objectSummary, resolveObject, viewSummary } from '../helpers';
import { defineAdapter, type ToolAdapters } from './types';

/** The model's view of the schema and of one record: summaries by API name, not the stored rows. */
export const metadataAdapters: ToolAdapters = {
  [coreIds.actions.list_objects]: defineAdapter({
    shape: async (objects, _input, { schema }) => {
      const index = await schema();

      return { objects: objects.map((object: Parameters<typeof objectSummary>[1]) => objectSummary(index, object)) };
    },
  }),
  [coreIds.actions.describe_object]: defineAdapter({
    input: z.object({ object: z.string().min(1).describe('Object API name, e.g. person') }),
    toAction: async ({ object: ref }, { schema }) => ({ object: resolveObject(await schema(), ref).nameSingular }),
    shape: async ({ object, fields, views }, _input, { schema }) => {
      const index = await schema();

      return {
        ...objectSummary(index, object),
        fields: fields.map((field: Parameters<typeof fieldSummary>[1]) => ({
          id: field.id,
          ...fieldSummary(index, field),
        })),
        views: views.map((view: Parameters<typeof viewSummary>[1]) => viewSummary(index, view)),
      };
    },
  }),
};
