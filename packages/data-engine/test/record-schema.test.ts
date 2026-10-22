import type { FieldMetadata } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { buildRecordSchemas } from '../src';

const field = (partial: Partial<FieldMetadata> & Pick<FieldMetadata, 'name' | 'type'>): FieldMetadata => ({
  workspaceId: 'ws',
  objectId: 'o',
  id: `t.x.${partial.name}`,
  label: partial.name,
  settings: {},
  isRequired: false,
  isUnique: false,
  position: 0,
  moduleId: null,
  ...partial,
});

const fields = [
  field({ name: 'title', type: 'text', isRequired: true }),
  field({ name: 'email', type: 'email' }),
  field({
    name: 'stage',
    type: 'select',
    settings: { options: [{ value: 'new', label: 'New' }] },
    defaultValue: 'new',
    isRequired: true,
  }),
  field({ name: 'done', type: 'boolean', defaultValue: false }),
  field({ name: 'rating', type: 'rating' }),
  field({ name: 'amount', type: 'money' }),
  field({ name: 'currency', type: 'currency' }),
];

describe('record schema builder', () => {
  const schemas = buildRecordSchemas(fields);

  it('applies defaults and normalizes values on create', () => {
    expect(schemas.create.parse({ title: 'A', email: ' Ada@Example.com ' })).toEqual({
      title: 'A',
      email: 'ada@example.com',
      stage: 'new',
      done: false,
    });
  });

  it('keeps a currency to a three-letter code, upper-cased', () => {
    expect(schemas.create.parse({ title: 'A', currency: ' eur ' })).toMatchObject({ currency: 'EUR' });
    expect(schemas.create.safeParse({ title: 'A', currency: 'euro' }).success).toBe(false);
    expect(schemas.create.safeParse({ title: 'A', currency: '€' }).success).toBe(false);
  });

  it('requires required fields without defaults', () => {
    const result = schemas.create.safeParse({ email: null });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('title');
  });

  it('rejects unknown keys on create and update', () => {
    expect(schemas.create.safeParse({ title: 'A', nope: 1 }).success).toBe(false);
    expect(schemas.update.safeParse({ nope: 1 }).success).toBe(false);
  });

  it('treats unknown field types as opaque and validates known ones', () => {
    expect(schemas.create.parse({ title: 'A', rating: { stars: 3 } }).rating).toEqual({ stars: 3 });
    expect(schemas.create.safeParse({ title: 'A', amount: 'lots' }).success).toBe(false);
    expect(schemas.create.safeParse({ title: 'A', stage: 'zzz' }).success).toBe(false);
  });

  it('makes every key optional on update but keeps required fields non-null', () => {
    expect(schemas.update.parse({ email: null })).toEqual({ email: null });
    expect(schemas.update.safeParse({ title: null }).success).toBe(false);
    expect(schemas.update.parse({})).toEqual({});
  });
});
