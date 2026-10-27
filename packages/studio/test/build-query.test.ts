import { indexSchema, type ViewState } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { resolvedFixture, schemaFixture } from '../src/testing';
import { buildQuery } from '../src/views/build-query';
import { applyOverrides, baseViewState } from '../src/views/view-state';

describe('buildQuery', () => {
  const schema = schemaFixture();
  const index = indexSchema(schema);
  const object = index.objectsByName.get('person') as NonNullable<ReturnType<typeof index.objectsByName.get>>;
  const fields = index.fieldsByObjectId.get(object.id) ?? [];
  const view = schema.views[0] as NonNullable<(typeof schema.views)[0]>;
  const fieldTypes = resolvedFixture().registries.fieldTypes;

  it('starts from the saved view config and includes visible relation fields', () => {
    const state = baseViewState(view, fields);
    expect(state.filter).toEqual({ field: 'stage', op: 'eq', value: 'new' });
    expect(state.fields.map((f) => [f.name, f.visible])).toEqual([
      ['first_name', true],
      ['email', true],
      ['stage', true],
      ['company', false],
    ]);
    const withRelation = applyOverrides(state, {
      fields: state.fields.map((f) => ({ ...f, visible: true })),
      search: '  ada ',
    });
    const query = buildQuery(object, withRelation, fieldTypes, fields);
    expect(query).toEqual({
      object: 'person',
      filter: { field: 'stage', op: 'eq', value: 'new' },
      sort: [{ field: 'first_name', direction: 'asc' }],
      search: 'ada',
      include: { company: true },
      limit: 50,
      count: true,
    });
  });

  it('drops sorts on unsortable fields and omits empty parts', () => {
    const state: ViewState = {
      sorts: [
        { field: 'company', direction: 'asc' },
        { field: 'updated_at', direction: 'desc' },
      ],
      fields: [{ name: 'first_name', visible: true }],
      search: '',
      settings: {},
    };
    expect(buildQuery(object, state, fieldTypes, fields, { limit: 20, count: false })).toEqual({
      object: 'person',
      sort: [{ field: 'updated_at', direction: 'desc' }],
      limit: 20,
    });
  });
});
