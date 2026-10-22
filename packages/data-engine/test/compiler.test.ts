import { indexSchema, type WorkspaceSchema } from '@devias/core';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { compileQuery, decodeCursor, type EngineError, encodeCursor, queryHash, validateQuery } from '../src';

const ws = 'ws1';
const objectId = 't.x';
const field = (name: string, type: string, settings: Record<string, unknown> = {}) => ({
  workspaceId: ws,
  objectId,
  id: `t.x.${name}`,
  name,
  type,
  label: name,
  settings,
  isRequired: false,
  isUnique: false,
  position: 0,
  moduleId: null,
});
const schema: WorkspaceSchema = {
  workspaceId: ws,
  version: 1,
  objects: [
    {
      workspaceId: ws,
      id: 't.x',
      nameSingular: 'x',
      namePlural: 'xs',
      labelSingular: 'X',
      labelPlural: 'Xs',
      isSystem: false,
      readOnly: false,
      createdAt: '',
      updatedAt: '',
      moduleId: null,
    },
  ],
  fields: [
    field('name', 'text'),
    field('email', 'email'),
    field('amount', 'number'),
    field('done', 'boolean'),
    field('due', 'date'),
    field('at', 'date_time'),
    field('stage', 'select', { options: [{ value: 'a', label: 'A' }] }),
    field('tags', 'multi_select', { options: [{ value: 't', label: 'T' }] }),
    field('owner', 'relation', { relationType: 'many_to_one', targetObjectId: 't.x' }),
    field('meta', 'json'),
    field('rating', 'rating'),
  ],
  views: [],
  layouts: [],
  navItems: [],
  commandItems: [],
  modules: [],
};
const index = indexSchema(schema);
const dialect = new PgDialect();

const SELECT_COLUMNS = `SELECT r.id, r.data, to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, to_char(r.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at, r.created_by, r.updated_by`;
const BASE_WHERE = 'r.workspace_id = $1 AND r.object_id = $2 AND r.deleted_at IS NULL';

const render = (query: Parameters<typeof validateQuery>[1], keys?: unknown[]) => {
  const compiled = compileQuery(ws, validateQuery(index, query), keys);
  const select = dialect.sqlToQuery(compiled.select);
  const count = compiled.count ? dialect.sqlToQuery(compiled.count) : undefined;

  return { sql: select.sql, params: select.params, count: count?.sql, countParams: count?.params };
};

describe('query compiler (golden)', () => {
  it('compiles the default page query', () => {
    const { sql, params } = render({ object: 'x' });
    expect(sql).toBe(`${SELECT_COLUMNS} FROM record r WHERE ${BASE_WHERE} ORDER BY r.id ASC NULLS LAST LIMIT $3`);
    expect(params).toEqual([ws, objectId, 51]);
  });

  it('compiles boolean trees with typed operators, sorts and a capped count', () => {
    const { sql, params, count, countParams } = render({
      object: 'x',
      filter: {
        and: [
          { field: 'name', op: 'eq', value: 'Ada' },
          { field: 'amount', op: 'gte', value: 10 },
          { not: { field: 'stage', op: 'in', value: ['A', 'b'] } },
        ],
      },
      sort: [{ field: 'amount', direction: 'desc' }],
      limit: 10,
      count: true,
    });
    const where = `${BASE_WHERE} AND (coalesce((lower(NULLIF(r.data->>'name', '')) = lower($3)), false) AND coalesce(((r.data->>'amount')::numeric >= $4::numeric), false) AND NOT coalesce((lower(NULLIF(r.data->>'stage', '')) IN (SELECT x FROM jsonb_array_elements_text($5::jsonb) x)), false))`;
    expect(sql).toBe(
      `${SELECT_COLUMNS}, (r.data->>'amount')::numeric AS __k0 FROM record r WHERE ${where} ORDER BY (r.data->>'amount')::numeric DESC NULLS FIRST, r.id ASC NULLS LAST LIMIT $6`,
    );
    expect(params).toEqual([ws, objectId, 'Ada', 10, '["a","b"]', 11]);
    expect(count).toBe(`SELECT count(*)::int AS count FROM (SELECT 1 FROM record r WHERE ${where} LIMIT $6) t`);
    expect(countParams).toEqual([ws, objectId, 'Ada', 10, '["a","b"]', 10001]);
  });

  it('compiles every operator family with escaped patterns, containment, jsonb arrays and system fields', () => {
    const { sql, params } = render({
      object: 'x',
      filter: {
        or: [
          { field: 'email', op: 'contains', value: '50%_x' },
          { field: 'name', op: 'starts_with', value: 'A' },
          { field: 'tags', op: 'any_of', value: ['t'] },
          { field: 'tags', op: 'all_of', value: ['t'] },
          { field: 'meta', op: 'is_empty' },
          { field: 'done', op: 'eq', value: true },
          { field: 'owner', op: 'eq', value: '019965a0-0000-7000-8000-0000000000aa' },
          { field: 'due', op: 'between', value: ['2026-01-01', '2026-02-01'] },
          { field: 'at', op: 'lt', value: '2026-01-01T00:00:00Z' },
          { field: 'owner', op: 'is_not_empty' },
          { field: 'amount', op: 'neq', value: 3 },
          { field: 'amount', op: 'in', value: [1, 2] },
          { field: 'created_at', op: 'lt', value: '2026-01-01T00:00:00Z' },
          { field: 'id', op: 'in', value: ['019965a0-0000-7000-8000-0000000000aa'] },
          { field: 'rating', op: 'is_not_empty' },
        ],
      },
      search: 'ada',
    });
    expect(sql).toBe(
      `${SELECT_COLUMNS} FROM record r WHERE ${BASE_WHERE} AND (` +
        `coalesce((r.data->>'email' ILIKE $3 ESCAPE '\\'), false) OR ` +
        `coalesce((r.data->>'name' ILIKE $4 ESCAPE '\\'), false) OR ` +
        `coalesce((r.data->'tags' ?| ARRAY(SELECT jsonb_array_elements_text($5::jsonb))), false) OR ` +
        `coalesce((r.data->'tags' ?& ARRAY(SELECT jsonb_array_elements_text($6::jsonb))), false) OR ` +
        `coalesce(((r.data->'meta' IS NULL OR r.data->'meta' = 'null'::jsonb OR (jsonb_typeof(r.data->'meta') = 'array' AND jsonb_array_length(r.data->'meta') = 0))), false) OR ` +
        `coalesce((r.data @> $7::jsonb), false) OR ` +
        `coalesce((r.data @> $8::jsonb), false) OR ` +
        `coalesce((((r.data->>'due')::date >= $9::date AND (r.data->>'due')::date <= $10::date)), false) OR ` +
        `coalesce(((r.data->>'at')::timestamptz < $11::timestamptz), false) OR ` +
        `coalesce((NOT (r.data->>'owner' IS NULL OR r.data->>'owner' = '')), false) OR ` +
        `coalesce(((r.data->>'amount')::numeric <> $12::numeric), false) OR ` +
        `coalesce(((r.data->>'amount')::numeric IN (SELECT (x)::numeric FROM jsonb_array_elements_text($13::jsonb) x)), false) OR ` +
        `coalesce((r.created_at < $14::timestamptz), false) OR ` +
        `coalesce((r.id IN (SELECT (x)::uuid FROM jsonb_array_elements_text($15::jsonb) x)), false) OR ` +
        `coalesce((NOT (r.data->'rating' IS NULL OR r.data->'rating' = 'null'::jsonb OR (jsonb_typeof(r.data->'rating') = 'array' AND jsonb_array_length(r.data->'rating') = 0))), false)` +
        `) AND (r.data->>'name' ILIKE $16 ESCAPE '\\' OR r.data->>'email' ILIKE $17 ESCAPE '\\') ORDER BY r.id ASC NULLS LAST LIMIT $18`,
    );
    expect(params).toEqual([
      ws,
      objectId,
      '%50\\%\\_x%',
      'A%',
      '["t"]',
      '["t"]',
      '{"done":true}',
      '{"owner":"019965a0-0000-7000-8000-0000000000aa"}',
      '2026-01-01',
      '2026-02-01',
      '2026-01-01T00:00:00Z',
      3,
      '[1,2]',
      '2026-01-01T00:00:00Z',
      '["019965a0-0000-7000-8000-0000000000aa"]',
      '%ada%',
      '%ada%',
      51,
    ]);
  });

  it('expands keyset cursors with null-aware pieces per sort direction', () => {
    const id = '019965a0-0000-7000-8000-0000000000aa';
    const { sql, params } = render(
      {
        object: 'x',
        sort: [
          { field: 'name', direction: 'asc' },
          { field: 'amount', direction: 'desc' },
        ],
      },
      ['Ada', null, id],
    );
    const name = `NULLIF(r.data->>'name', '') COLLATE "C"`;
    const amount = `(r.data->>'amount')::numeric`;
    expect(sql).toBe(
      `${SELECT_COLUMNS}, ${name} AS __k0, ${amount} AS __k1 FROM record r WHERE ${BASE_WHERE} AND (` +
        `(${name} > $3 OR ${name} IS NULL) OR ` +
        `(${name} IS NOT DISTINCT FROM $4 AND ${amount} IS NOT NULL) OR ` +
        `(${name} IS NOT DISTINCT FROM $5 AND ${amount} IS NULL AND r.id > $6::uuid)` +
        `) ORDER BY ${name} ASC NULLS LAST, ${amount} DESC NULLS FIRST, r.id ASC NULLS LAST LIMIT $7`,
    );
    expect(params).toEqual([ws, objectId, 'Ada', 'Ada', 'Ada', id, 51]);

    // after a null key ascending nothing follows on that key; descending after a non-null key is "<"
    const after = render(
      {
        object: 'x',
        sort: [
          { field: 'name', direction: 'asc' },
          { field: 'amount', direction: 'desc' },
        ],
      },
      [null, 5, id],
    );
    expect(after.sql).toContain(
      `AND (false OR (${name} IS NULL AND ${amount} < $3::numeric) OR (${name} IS NULL AND ${amount} IS NOT DISTINCT FROM $4::numeric AND r.id > $5::uuid))`,
    );
  });

  it('validates fields, operators, values, sorts and includes', () => {
    const bad = (query: Parameters<typeof validateQuery>[1]) => {
      try {
        validateQuery(index, query);
      } catch (error) {
        return (error as EngineError).code;
      }

      return 'ok';
    };
    expect(bad({ object: 'nope' })).toBe('NOT_FOUND');
    expect(bad({ object: 'x', filter: { field: 'ghost', op: 'eq', value: 1 } })).toBe('VALIDATION');
    expect(bad({ object: 'x', filter: { field: 'amount', op: 'contains', value: 'x' } })).toBe('VALIDATION');
    expect(bad({ object: 'x', filter: { field: 'amount', op: 'eq', value: 'ten' } })).toBe('VALIDATION');
    expect(bad({ object: 'x', filter: { field: 'due', op: 'between', value: ['2026-01-01'] } })).toBe('VALIDATION');
    expect(bad({ object: 'x', filter: { field: 'rating', op: 'eq', value: 1 } })).toBe('VALIDATION');
    expect(bad({ object: 'x', sort: [{ field: 'tags', direction: 'asc' }] })).toBe('VALIDATION');
    expect(bad({ object: 'x', include: { name: true } })).toBe('VALIDATION');
    expect(bad({ object: 'x', select: ['ghost'] })).toBe('VALIDATION');
    expect(
      bad({
        object: 'x',
        filter: { field: 'rating', op: 'is_empty' },
        sort: [{ field: 'created_at', direction: 'desc' }],
        include: { owner: { limit: 3 } },
      }),
    ).toBe('ok');
    expect(validateQuery(index, { object: 'x', limit: 999 }).limit).toBe(200);
  });
});

describe('cursor', () => {
  const hash = queryHash({ object: 'x', sort: [{ field: 'name', direction: 'asc' }] });

  it('round-trips keys as base64url JSON bound to the query hash', () => {
    const cursor = encodeCursor(hash, ['Ada', null, 'id-1']);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString())).toEqual({
      v: 1,
      q: hash,
      k: ['Ada', null, 'id-1'],
    });
    expect(decodeCursor(cursor, hash, 3)).toEqual(['Ada', null, 'id-1']);
  });

  it('rejects garbage, other queries and key-count mismatches with INVALID_CURSOR', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as EngineError).code;
      }

      return 'ok';
    };
    const cursor = encodeCursor(hash, ['Ada', 'id-1']);
    expect(code(() => decodeCursor('not-a-cursor', hash, 2))).toBe('INVALID_CURSOR');
    expect(code(() => decodeCursor(cursor, queryHash({ object: 'x', sort: [] }), 2))).toBe('INVALID_CURSOR');
    expect(code(() => decodeCursor(cursor, hash, 3))).toBe('INVALID_CURSOR');
    expect(code(() => decodeCursor(cursor, hash, 2))).toBe('ok');
  });

  it('hashes object, filter, sort and search but not limit or select', () => {
    const a = queryHash({ object: 'x', sort: [], filter: { field: 'name', op: 'eq', value: 1 } });
    const b = queryHash({ object: 'x', sort: [], filter: { field: 'name', op: 'eq', value: 2 } });
    expect(a).not.toBe(b);
    expect(queryHash({ object: 'x', sort: [], search: 'a' })).not.toBe(queryHash({ object: 'x', sort: [] }));
  });
});
