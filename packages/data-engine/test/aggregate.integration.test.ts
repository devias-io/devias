import { type AggregateQuery, aggregateRecords, evaluateFilter, type RecordData } from '@devias/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EngineError } from '../src';
import { createTestEngine, type TestEngine } from './helpers/db';

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;

    return 'ok';
  } catch (error) {
    if (error instanceof EngineError) {
      return error.code;
    }

    throw error;
  }
};

const STAGES = ['new', 'screening', 'meeting', 'proposal', 'customer'];

describe('aggregation on PGlite', () => {
  let t: TestEngine;
  let acme: string;
  let globex: string;
  let all: RecordData[];

  beforeAll(async () => {
    t = await createTestEngine();
    acme = (await t.engine.records.create(t.owner, 'company', { name: 'Acme' })).id;
    globex = (await t.engine.records.create(t.owner, 'company', { name: 'Globex' })).id;
    // Integer amounts keep SQL and JavaScript sums identical; some deals have no amount, stage 'screening' none at all.
    const create = Array.from({ length: 30 }, (_, i) => ({
      name: `Deal ${i}`,
      stage: STAGES[[0, 2, 3, 4][i % 4] as number],
      ...(i % 5 === 0 ? {} : { amount: (i + 1) * 100 }),
      close_date: `2026-0${(i % 9) + 1}-1${i % 10}`,
      ...(i % 3 === 0 ? { company: acme } : i % 3 === 1 ? { company: globex } : {}),
    }));
    await t.engine.records.batch(t.owner, 'opportunity', { create });
    all = (await t.engine.records.list(t.owner, { object: 'opportunity', limit: 200 })).items;
  });
  afterAll(() => t.close());

  const fields = () =>
    t.engine.metadata.getSnapshot(t.workspaceId).then((s) => {
      const object = s.index.objectsByName.get('opportunity');

      return object ? (s.index.fieldsByObjectId.get(object.id) ?? []) : [];
    });

  /** What core computes in memory over the same records: the mock's answer. */
  const oracle = async (query: AggregateQuery) => {
    const matching = all.filter((record) => evaluateFilter(record, query.filter));
    const result = aggregateRecords(matching, await fields(), {
      ...query,
      measures: query.measures ?? [{ fn: 'count' }],
    });

    return { ...result, groups: result.groups.map(({ label: _label, ...group }) => group) };
  };
  const withoutLabels = <T extends { groups: { label?: string }[] }>(result: T) => ({
    ...result,
    groups: result.groups.map(({ label: _label, ...group }) => group),
  });

  it('matches the in-memory aggregation for groupings, measures and filters', async () => {
    const queries: AggregateQuery[] = [
      { object: 'opportunity' },
      { object: 'opportunity', groupBy: 'stage', measures: [{ fn: 'count' }, { fn: 'sum', field: 'amount' }] },
      {
        object: 'opportunity',
        groupBy: 'company',
        measures: [
          { fn: 'count', field: 'amount' },
          { fn: 'avg', field: 'amount' },
          { fn: 'max', field: 'close_date' },
        ],
      },
      {
        object: 'opportunity',
        groupBy: 'close_date',
        filter: { field: 'stage', op: 'in', value: ['proposal', 'customer'] },
        measures: [
          { fn: 'min', field: 'amount' },
          { fn: 'max', field: 'amount' },
        ],
      },
      {
        object: 'opportunity',
        filter: { field: 'amount', op: 'gte', value: 1000 },
        measures: [{ fn: 'sum', field: 'amount' }],
      },
    ];

    for (const query of queries) {
      const result = await t.engine.records.aggregate(t.owner, query);
      expect(withoutLabels(result), JSON.stringify(query)).toEqual(await oracle(query));
    }
  });

  it('lists every stage in option order with labels, and names related records', async () => {
    const byStage = await t.engine.records.aggregate(t.owner, {
      object: 'opportunity',
      groupBy: 'stage',
      measures: [{ fn: 'sum', field: 'amount' }],
    });
    expect(byStage.groups.map((group) => group.key)).toEqual([...STAGES, 'lost']);
    expect(byStage.groups.find((group) => group.key === 'screening')).toMatchObject({
      count: 0,
      values: { 'sum.amount': 0 },
      label: expect.any(String),
    });
    expect(byStage.total.count).toBe(30);

    const byCompany = await t.engine.records.aggregate(t.owner, { object: 'opportunity', groupBy: 'company' });
    expect(byCompany.groups).toEqual([
      expect.objectContaining({ key: acme, label: 'Acme', count: 10 }),
      expect.objectContaining({ key: globex, label: 'Globex', count: 10 }),
      expect.objectContaining({ key: null, count: 10 }),
    ]);
  });

  it('cuts groups beyond the limit and says so', async () => {
    const result = await t.engine.records.aggregate(t.owner, {
      object: 'opportunity',
      groupBy: 'close_date',
      limit: 3,
    });
    expect(result.groups).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.total.count).toBe(30);
  });

  it('refuses groupings and measures the fields cannot support', async () => {
    const run = (query: AggregateQuery) => codeOf(t.engine.records.aggregate(t.owner, query));
    expect(await run({ object: 'opportunity', groupBy: 'amount' })).toBe('VALIDATION');
    expect(await run({ object: 'opportunity', groupBy: 'nope' })).toBe('VALIDATION');
    expect(await run({ object: 'opportunity', measures: [{ fn: 'sum', field: 'name' }] })).toBe('VALIDATION');
    expect(await run({ object: 'opportunity', measures: [{ fn: 'avg' }] })).toBe('VALIDATION');
    expect(await run({ object: 'opportunity', filter: { field: 'missing', op: 'eq', value: 1 } })).toBe('VALIDATION');
    expect(await run({ object: 'nothing' })).toBe('NOT_FOUND');
    expect(await codeOf(t.engine.records.aggregate(t.member, { object: 'opportunity' }))).toBe('ok');
  });
});
