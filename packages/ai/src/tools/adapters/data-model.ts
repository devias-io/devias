import { coreIds, type ObjectCreateInput, type ViewConfigInput } from '@devias/core';
import { z } from 'zod';
import { ApiName, FieldSpecSchema, fieldInput, fieldPatch, OptionSchema } from '../field-specs';
import {
  FilterInputSchema,
  fieldSummary,
  fieldsOf,
  objectSummary,
  resolveField,
  resolveObject,
  resolveView,
  SortInputSchema,
  toFilter,
  viewSummary,
  viewsOf,
} from '../helpers';
import { assertGroupBy, fieldIds } from '../view-specs';
import { answering, carrying, defineAdapter, type ToolAdapters } from './types';

/** The model describes a new object and its fields in one call; the engine makes them in one change. */
export const dataModelAdapters: ToolAdapters = {
  [coreIds.actions.create_object]: defineAdapter({
    input: z.object({
      nameSingular: ApiName.describe('e.g. project'),
      namePlural: ApiName.describe('e.g. projects'),
      labelSingular: z.string().min(1),
      labelPlural: z.string().min(1),
      icon: z.string().optional().describe('Icon name, e.g. folder, target, calendar'),
      description: z.string().optional(),
      fields: z.array(FieldSpecSchema).optional().describe('Fields in display order'),
      addToNavigation: z.boolean().optional().describe('Add a sidebar entry (default true)'),
    }),
    toAction: async (input, { schema }): Promise<ObjectCreateInput> => {
      const index = await schema();
      const owner = { pending: true, nameSingular: input.nameSingular, labelPlural: input.labelPlural } as const;

      return {
        nameSingular: input.nameSingular,
        namePlural: input.namePlural,
        labelSingular: input.labelSingular,
        labelPlural: input.labelPlural,
        ...(input.icon ? { icon: input.icon } : {}),
        ...(input.description ? { description: input.description } : {}),
        fields: (input.fields ?? []).map((spec, position) => fieldInput(index, owner, spec, position)),
        ...(input.addToNavigation !== undefined ? { addToNavigation: input.addToNavigation } : {}),
      };
    },
    shape: async (created, _input, { schema }) => {
      const index = await schema();
      const object = index.objectsById.get(created.id) ?? created;
      const view = viewsOf(index, object).find((one) => one.isDefault);

      return {
        created: true,
        object: objectSummary(index, object),
        fields: fieldsOf(index, object).map((field) => fieldSummary(index, field)),
        ...(view ? { view: { id: view.id, label: view.label } } : {}),
      };
    },
  }),
  [coreIds.actions.create_field]: defineAdapter({
    input: z.object({ object: z.string().min(1).describe('Object API name') }).extend(FieldSpecSchema.shape),
    toAction: async ({ object: ref, ...spec }, { schema }) => {
      const index = await schema();
      const object = resolveObject(index, ref);
      const position = fieldsOf(index, object).reduce((max, field) => Math.max(max, field.position + 1), 0);

      return { ...fieldInput(index, object, spec, position), objectId: object.id };
    },
    shape: async (field, { object: ref }, { schema }) => {
      const index = await schema();

      return { created: true, object: resolveObject(index, ref).nameSingular, field: fieldSummary(index, field) };
    },
  }),
  [coreIds.actions.update_field]: defineAdapter({
    input: z.object({
      object: z.string().min(1),
      field: z.string().min(1).describe('Field API name'),
      label: z.string().min(1).optional(),
      description: z.string().optional(),
      required: z.boolean().optional(),
      addOptions: z.array(OptionSchema).optional(),
      removeOptions: z.array(z.string()).optional().describe('Option values to remove'),
      setOptions: z.array(OptionSchema).optional().describe('Replace all options'),
      image: z
        .boolean()
        .optional()
        .describe('For url fields: whether the link is a picture of the record (a logo, a photo)'),
    }),
    toAction: async (input, { schema }) => {
      const index = await schema();
      const field = resolveField(index, resolveObject(index, input.object), input.field);
      const patch = fieldPatch(field, input);

      return Object.keys(patch).length === 0
        ? answering({ updated: false, message: 'Nothing to change' })
        : { id: field.id, ...patch };
    },
    shape: async (field, { object: ref }, { schema }) => {
      const index = await schema();

      return { updated: true, object: resolveObject(index, ref).nameSingular, field: fieldSummary(index, field) };
    },
  }),
  [coreIds.actions.delete_field]: defineAdapter({
    input: z.object({ object: z.string().min(1), field: z.string().min(1) }),
    toAction: async (input, { schema }) => {
      const index = await schema();
      const object = resolveObject(index, input.object);
      const field = resolveField(index, object, input.field);

      return carrying({ id: field.id }, { object: object.nameSingular, field: field.name });
    },
    shape: (_output, _input, _context, named: { object: string; field: string }) => ({ deleted: true, ...named }),
  }),
  [coreIds.actions.create_view]: defineAdapter({
    input: z.object({
      object: z.string().min(1),
      label: z.string().min(1),
      type: z.enum(['table', 'kanban']).default('table'),
      fields: z.array(z.string()).optional().describe('Field API names to show; omit for all fields'),
      filter: FilterInputSchema.optional(),
      sorts: z.array(SortInputSchema).optional(),
      groupBy: z.string().optional().describe('Kanban only: the select field that defines the columns'),
      isDefault: z.boolean().optional().describe("Make it the object's default view"),
      icon: z.string().optional(),
    }),
    toAction: async (input, { schema }) => {
      const index = await schema();
      const object = resolveObject(index, input.object);
      const ids = input.fields ? fieldIds(index, object, input.fields) : fieldsOf(index, object).map((f) => f.id);
      assertGroupBy(index, object, input.type, input.groupBy);
      const filter = toFilter(input.filter);

      return {
        objectId: object.id,
        label: input.label,
        type: input.type,
        icon: input.icon ?? (input.type === 'kanban' ? 'kanban' : 'table'),
        ...(input.isDefault ? { isDefault: true } : {}),
        position: (viewsOf(index, object).length ?? 0) + 1,
        config: {
          fields: ids.map((fieldId) => ({ fieldId, visible: true })),
          ...(filter ? { filter } : {}),
          sorts: (input.sorts ?? []).map((sort) => ({
            fieldId: resolveField(index, object, sort.field).id,
            direction: sort.direction,
          })),
          ...(input.groupBy ? { groupById: resolveField(index, object, input.groupBy).id } : {}),
        },
      };
    },
    shape: async (view, { object: ref }, { schema }) => {
      const index = await schema();

      return { created: true, object: resolveObject(index, ref).nameSingular, view: viewSummary(index, view) };
    },
  }),
  [coreIds.actions.update_view]: defineAdapter({
    input: z.object({
      object: z.string().min(1),
      view: z.string().min(1).describe('View id or label'),
      label: z.string().min(1).optional(),
      fields: z.array(z.string()).optional(),
      filter: FilterInputSchema.nullable().optional(),
      sorts: z.array(SortInputSchema).optional(),
      groupBy: z.string().nullable().optional(),
      isDefault: z.boolean().optional(),
    }),
    toAction: async (input, { schema }) => {
      const index = await schema();
      const object = resolveObject(index, input.object);
      const view = resolveView(index, object, input.view);
      // A key the view clears is sent as null, which the engine reads as "remove it".
      const config: ViewConfigInput = { ...view.config };

      if (input.fields) {
        config.fields = fieldIds(index, object, input.fields).map((fieldId) => ({ fieldId, visible: true }));
      }

      if (input.filter === null) {
        config.filter = null;
      } else if (input.filter) {
        config.filter = toFilter(input.filter);
      }

      if (input.sorts) {
        config.sorts = input.sorts.map((sort) => ({
          fieldId: resolveField(index, object, sort.field).id,
          direction: sort.direction,
        }));
      }

      if (input.groupBy === null) {
        config.groupById = null;
      } else if (input.groupBy) {
        config.groupById = resolveField(index, object, input.groupBy).id;
      }

      assertGroupBy(index, object, view.type, config.groupById ?? undefined);

      return {
        id: view.id,
        config,
        ...(input.label ? { label: input.label } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      };
    },
    shape: async (view, { object: ref }, { schema }) => {
      const index = await schema();

      return { updated: true, object: resolveObject(index, ref).nameSingular, view: viewSummary(index, view) };
    },
  }),
};
