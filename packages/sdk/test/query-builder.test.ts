import { FILTER_OPS } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { DeviasApiError, f, q } from '../src';

describe('query builder', () => {
  it('builds the documented example', () => {
    const query = q('person')
      .select('first_name', 'company')
      .where((f) => f.and(f.eq('stage', 'won'), f.or(f.contains('name', 'a'), f.isEmpty('email'))))
      .orderBy('close_date', 'desc')
      .limit(50)
      .cursor('abc')
      .include('company')
      .search('acme')
      .count()
      .build();
    expect(query).toEqual({
      object: 'person',
      select: ['first_name', 'company'],
      filter: {
        and: [
          { field: 'stage', op: 'eq', value: 'won' },
          {
            or: [
              { field: 'name', op: 'contains', value: 'a' },
              { field: 'email', op: 'is_empty' },
            ],
          },
        ],
      },
      sort: [{ field: 'close_date', direction: 'desc' }],
      limit: 50,
      cursor: 'abc',
      include: { company: true },
      search: 'acme',
      count: true,
    });
  });

  it('has a typed helper for every filter operator', () => {
    for (const op of FILTER_OPS) {
      // The helper is the operator in camelCase: `not_in` is `f.notIn`.
      const helper = op.replace(/_(.)/g, (_, c: string) => c.toUpperCase()) as keyof typeof f;
      expect(typeof f[helper]).toBe('function');
    }

    expect(f.eq('a', 1)).toEqual({ field: 'a', op: 'eq', value: 1 });
    expect(f.neq('a', 1)).toEqual({ field: 'a', op: 'neq', value: 1 });
    expect(f.in('a', [1, 2])).toEqual({ field: 'a', op: 'in', value: [1, 2] });
    expect(f.notIn('a', [1])).toEqual({ field: 'a', op: 'not_in', value: [1] });
    expect(f.lt('a', 1)).toEqual({ field: 'a', op: 'lt', value: 1 });
    expect(f.lte('a', 1)).toEqual({ field: 'a', op: 'lte', value: 1 });
    expect(f.gt('a', 1)).toEqual({ field: 'a', op: 'gt', value: 1 });
    expect(f.gte('a', 1)).toEqual({ field: 'a', op: 'gte', value: 1 });
    expect(f.between('a', 1, 2)).toEqual({ field: 'a', op: 'between', value: [1, 2] });
    expect(f.contains('a', 'x')).toEqual({ field: 'a', op: 'contains', value: 'x' });
    expect(f.startsWith('a', 'x')).toEqual({ field: 'a', op: 'starts_with', value: 'x' });
    expect(f.isEmpty('a')).toEqual({ field: 'a', op: 'is_empty' });
    expect(f.isNotEmpty('a')).toEqual({ field: 'a', op: 'is_not_empty' });
    expect(f.anyOf('a', ['x'])).toEqual({ field: 'a', op: 'any_of', value: ['x'] });
    expect(f.allOf('a', ['x'])).toEqual({ field: 'a', op: 'all_of', value: ['x'] });
    expect(f.not(f.eq('a', 1))).toEqual({ not: { field: 'a', op: 'eq', value: 1 } });
    expect(f.op('a', 'eq', 1)).toEqual(f.eq('a', 1));
  });

  it('ANDs repeated where calls, drops falsy parts and unwraps single children', () => {
    const query = q('chore')
      .where(f.eq('done', false))
      .where((f) => f.or(false, null, undefined, f.gt('due_date', '2026-01-01')))
      .where(null)
      .build();
    expect(query.filter).toEqual({
      and: [
        { field: 'done', op: 'eq', value: false },
        { field: 'due_date', op: 'gt', value: '2026-01-01' },
      ],
    });
    expect(f.and()).toEqual({ and: [] });
    expect(f.or(f.eq('a', 1))).toEqual({ field: 'a', op: 'eq', value: 1 });
  });

  it('is immutable, clamps limits and merges include options', () => {
    const base = q('opportunity').orderBy('close_date');
    const paged = base.limit(1000).cursor('c1');
    expect(base.build()).toEqual({ object: 'opportunity', sort: [{ field: 'close_date', direction: 'asc' }] });
    expect(paged.build().limit).toBe(200);
    expect(paged.build().cursor).toBe('c1');
    expect(paged.limit(0).build().limit).toBe(1);
    expect(paged.limit(null).build().limit).toBeUndefined();
    expect(paged.cursor(null).build().cursor).toBeUndefined();
    expect(
      base
        .include('company', { select: ['name'], limit: 5 })
        .include({ point_of_contact: true })
        .build().include,
    ).toEqual({ company: { select: ['name'], limit: 5 }, point_of_contact: true });
    expect(base.sort([{ field: 'name', direction: 'desc' }]).build().sort).toEqual([
      { field: 'name', direction: 'desc' },
    ]);
    expect(base.search('').build().search).toBeUndefined();
    expect(base.select(['a', 'b'], 'c', 'a').build().select).toEqual(['a', 'b', 'c']);
    expect(base.count(false).build().count).toBeUndefined();
    expect(JSON.parse(JSON.stringify(base))).toEqual(base.build());
  });

  it('rejects malformed queries with a VALIDATION error', () => {
    expect(() => q('').build()).toThrow(DeviasApiError);
    let error: unknown;

    try {
      q('person').orderBy('').build();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DeviasApiError);
    expect((error as DeviasApiError).code).toBe('VALIDATION');
    expect((error as DeviasApiError).status).toBe(400);
  });
});
