import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from './helpers/db';

describe('smoke', () => {
  let t: TestEngine;
  beforeAll(async () => {
    t = await createTestEngine();
  });
  afterAll(() => t.close());

  it('seeds fixture and round-trips a record', async () => {
    const schema = await t.engine.metadata.getSchema(t.owner);
    expect(schema.objects.map((o) => o.nameSingular).sort()).toEqual([
      'chore',
      'company',
      'note',
      'opportunity',
      'person',
    ]);
    const company = await t.engine.records.create(t.owner, 'company', { name: 'Acme' });
    const person = await t.engine.records.create(t.owner, 'person', {
      first_name: 'Ada',
      email: 'Ada@Example.com',
      company: company.id,
    });
    expect(person.email).toBe('ada@example.com');
    const page = await t.engine.records.list(t.owner, {
      object: 'person',
      filter: { field: 'first_name', op: 'eq', value: 'ada' },
      include: { company: true },
      count: true,
    });
    expect(page.items).toHaveLength(1);
    expect(page.totalCount).toBe(1);
    expect(page.included?.company?.[0]?.name).toBe('Acme');
    const plan = await t.engine.modules.plan(t.owner, (await import('@devias/fixtures')).manifest);
    expect(plan.changes.every((c) => c.action === 'noop')).toBe(true);
  });
});
