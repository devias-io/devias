import { describe, expect, it } from 'vitest';
import {
  evaluateFilter,
  filterFields,
  hashValue,
  matchesSearch,
  parseWebAddress,
  QuerySchema,
  sortRecords,
  stableStringify,
  valueSchemaForField,
} from '../src';

const rec = (data: Record<string, unknown>) => ({ id: 'r', created_at: '', updated_at: '', ...data });

describe('filter evaluation', () => {
  it('evaluates boolean trees and typed operators', () => {
    const record = rec({ name: 'Acme Inc', employees: 42, tags: ['a', 'b'], stage: 'won', close_date: '2026-01-05' });
    expect(evaluateFilter(record, { field: 'name', op: 'contains', value: 'acme' })).toBe(true);
    // Non-string values (module field types) are searched as JSON text, like Postgres `->>`.
    const doc = rec({ body: { type: 'doc', content: [{ type: 'mention', attrs: { id: 'p1', label: 'Ada' } }] } });
    expect(evaluateFilter(doc, { field: 'body', op: 'contains', value: '"p1"' })).toBe(true);
    expect(evaluateFilter(doc, { field: 'body', op: 'contains', value: '"p2"' })).toBe(false);
    expect(evaluateFilter(record, { field: 'employees', op: 'between', value: [40, 50] })).toBe(true);
    expect(
      evaluateFilter(record, {
        and: [
          { field: 'stage', op: 'in', value: ['won', 'lost'] },
          { not: { field: 'tags', op: 'all_of', value: ['a', 'c'] } },
        ],
      }),
    ).toBe(true);
    expect(
      evaluateFilter(record, {
        or: [
          { field: 'missing', op: 'is_not_empty' },
          { field: 'close_date', op: 'gte', value: '2026-01-01' },
        ],
      }),
    ).toBe(true);
    expect(evaluateFilter(record, { field: 'missing', op: 'neq', value: 'x' })).toBe(false);
  });

  it('sorts with nulls last ascending and first descending, id as tiebreaker', () => {
    const rows = [rec({ id: 'b', n: null }), rec({ id: 'a', n: 2 }), rec({ id: 'c', n: 1 })];
    expect(sortRecords(rows, [{ field: 'n', direction: 'asc' }]).map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(sortRecords(rows, [{ field: 'n', direction: 'desc' }]).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('collects filter fields and matches search text', () => {
    expect([
      ...filterFields({ and: [{ field: 'a', op: 'eq', value: 1 }, { or: [{ field: 'b', op: 'is_empty' }] }] }),
    ]).toEqual(['a', 'b']);
    expect(matchesSearch(rec({ name: 'Jane Doe' }), ['name'], 'doe')).toBe(true);
  });
});

describe('query schema and value schemas', () => {
  it('parses a query and applies defaults', () => {
    const parsed = QuerySchema.parse({ object: 'person', sort: [{ field: 'last_name' }], limit: 10 });
    expect(parsed.sort?.[0]?.direction).toBe('asc');
  });

  it('normalizes emails and validates select options', () => {
    expect(valueSchemaForField({ type: 'email', isRequired: true }).parse(' Jane@Example.com ')).toBe(
      'jane@example.com',
    );
    const select = valueSchemaForField({ type: 'select', settings: { options: [{ value: 'a', label: 'A' }] } });
    expect(select.parse('a')).toBe('a');
    expect(select.safeParse('zzz').success).toBe(false);
    expect(select.parse(null)).toBeNull();
  });
});

describe('web addresses', () => {
  const url = valueSchemaForField({ type: 'url' });

  it('accepts addresses with or without a scheme, trimmed', () => {
    for (const value of [
      'acme.com',
      'www.acme.com/about',
      'https://acme.com',
      'http://localhost:3000/x',
      ' acme.com ',
    ]) {
      expect(url.safeParse(value).success, value).toBe(true);
    }

    expect(url.parse(' acme.com ')).toBe('acme.com');
    expect(url.parse(null)).toBeNull();
  });

  it('rejects words, other schemes and anything with spaces', () => {
    for (const value of [
      'VIP',
      'acme',
      'my site.com',
      'javascript:alert(1)',
      'ftp://acme.com',
      'mailto:a@acme.com',
      '',
    ]) {
      expect(url.safeParse(value).success, value).toBe(false);
    }

    expect(parseWebAddress('acme.com/pricing')?.hostname).toBe('acme.com');
    expect(parseWebAddress('nope')).toBeNull();
  });
});

describe('hashing', () => {
  it('is order independent for object keys', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(hashValue({ b: 1, a: 2 })).toBe(hashValue({ a: 2, b: 1 }));
  });
});
