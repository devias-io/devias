import { describe, expect, it } from 'vitest';
import {
  type FieldMetadata,
  imageFieldOf,
  indexSchema,
  settingsSchemaForFieldType,
  type WorkspaceSchema,
  WorkspaceSchemaSchema,
} from '../src';

const now = '2026-01-01T00:00:00.000Z';
const base = { workspaceId: 'ws1', createdAt: now, updatedAt: now, moduleId: null };

const url = (name: string, settings: Record<string, unknown>) => ({
  ...base,
  objectId: 'fixture.company',
  id: `fixture.company.${name}`,
  name,
  type: 'url',
  label: name,
  settings,
  isRequired: false,
  isUnique: false,
  position: 0,
});

const schemaWith = (fields: ReturnType<typeof url>[]): WorkspaceSchema =>
  WorkspaceSchemaSchema.parse({
    workspaceId: 'ws1',
    version: 1,
    objects: [
      {
        ...base,
        id: 'fixture.company',
        nameSingular: 'company',
        namePlural: 'companies',
        labelSingular: 'Company',
        labelPlural: 'Companies',
        isSystem: false,
        readOnly: false,
      },
    ],
    fields,
    views: [],
    layouts: [],
    navItems: [],
    commandItems: [],
    modules: [],
  });

describe('a link field that is a picture', () => {
  it('keeps its image setting when the settings are checked', () => {
    const settings = settingsSchemaForFieldType('url');
    expect(settings.parse({ image: true })).toEqual({ image: true });
    expect(settings.parse({})).toEqual({});
  });

  it("is the object's image field only when it is a link marked as one", () => {
    const schema = schemaWith([url('website', {}), url('logo', { image: true })]);
    const index = indexSchema(schema);
    const company = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    expect((imageFieldOf(index, company) as FieldMetadata).name).toBe('logo');

    const plain = indexSchema(schemaWith([url('website', {}), url('logo', { image: false })]));
    expect(imageFieldOf(plain, company)).toBeUndefined();
  });
});
