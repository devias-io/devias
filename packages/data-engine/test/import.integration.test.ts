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

describe('importing rows', () => {
  let t: TestEngine;
  const run = (object: string, input: Record<string, unknown>) =>
    t.engine.records.import(t.owner, object, input as never);
  const people = async () => (await t.engine.records.list(t.owner, { object: 'person', limit: 100 })).items;
  const companies = async () => (await t.engine.records.list(t.owner, { object: 'company', limit: 100 })).items;

  beforeAll(async () => {
    t = await createTestEngine();
    await t.engine.records.batch(t.owner, 'company', {
      create: [{ name: 'Acme' }, { name: 'Globex', domain: 'globex.example' }],
    });
  });
  afterAll(() => t.close());

  it('creates records from the text of cells, read the way people write them', async () => {
    const report = await run('company', {
      columns: ['name', 'employees', 'annual_revenue', 'ideal_customer_profile', 'industry', 'domain'],
      rows: [
        ['Initech', '1,200', '$ 4.500.000,50', 'yes', 'software', 'initech.example'],
        ['Umbrella', '30', '', 'no', '', ''],
      ],
    });
    expect(report).toMatchObject({ created: 2, updated: 0, skipped: 0, errorCount: 0, errors: [], dryRun: false });
    expect(report.importId).toBeTruthy();
    const initech = (await companies()).find((company) => company.name === 'Initech');
    expect(initech).toMatchObject({ employees: 1200, annual_revenue: 4500000.5, ideal_customer_profile: true });
  });

  it('marks the events of what it wrote with the import, and a dry run has none', async () => {
    const before = await t.engine.events.currentSequence(t.workspaceId);
    const report = await run('company', { columns: ['name'], rows: [['Evented Co']] });
    const list = (await t.engine.events.list(t.owner, { after: before })) as { type: string; importId?: string }[];
    expect(list.filter((event) => event.type === 'record.created').map((event) => event.importId)).toEqual([
      report.importId,
    ]);
    const dry = await run('company', { columns: ['name'], rows: [['Never Co']], dryRun: true });
    expect(dry.importId).toBeUndefined();
  });

  it('writes nothing on a dry run, and says what it would have done', async () => {
    const before = (await companies()).length;
    const report = await run('company', { columns: ['name'], rows: [['Hooli'], ['Pied Piper']], dryRun: true });
    expect(report).toMatchObject({ created: 2, skipped: 0, dryRun: true });
    expect((await companies()).length).toBe(before);
  });

  it('skips the bad rows with their number, writes the rest, and numbers rows as the spreadsheet does', async () => {
    const report = await run('company', {
      columns: ['name', 'employees', 'domain'],
      rows: [
        ['Soylent', '10', ''],
        ['Bad Co', 'many', 'not a url'],
        ['', '5', ''],
        ['', '', ''],
        ['Stark', '7', ''],
      ],
    });
    expect(report).toMatchObject({ created: 2, skipped: 2, errorCount: 3 });
    expect(report.errors).toEqual([
      { row: 3, field: 'Employees', message: '"many" is not a number' },
      { row: 3, field: 'Domain', message: '"not a url" is not a web address' },
      { row: 4, field: 'Name', message: 'Name is required' },
    ]);
    // The blank row 5 is ignored, not counted.
    expect((await companies()).some((company) => company.name === 'Stark')).toBe(true);
    expect((await companies()).some((company) => company.name === 'Bad Co')).toBe(false);
  });

  it('numbers rows from firstRow, for a chunk of a bigger file', async () => {
    const report = await run('company', { columns: ['name', 'employees'], rows: [['Chunk Co', 'x']], firstRow: 502 });
    expect(report.errors[0]).toMatchObject({ row: 502 });
  });

  it('finds a related record by its name, by a unique field and by its id, and refuses none or two', async () => {
    const globex = (await companies()).find((company) => company.name === 'Globex');
    const report = await run('person', {
      columns: ['first_name', 'company'],
      rows: [
        ['Ada', 'acme'],
        ['Grace', globex?.id],
        ['Alan', 'Nowhere Inc'],
      ],
    });
    expect(report).toMatchObject({ created: 2, skipped: 1 });
    expect(report.errors[0]).toMatchObject({ row: 4, field: 'Company', message: 'No company is called "Nowhere Inc"' });
    const ada = (await people()).find((person) => person.first_name === 'Ada');
    expect(ada?.company).toBe((await companies()).find((company) => company.name === 'Acme')?.id);
  });

  it('refuses a name that two records have, naming the way out', async () => {
    await t.engine.records.batch(t.owner, 'person', { create: [{ first_name: 'Sam' }, { first_name: 'Sam' }] });
    const report = await run('opportunity', {
      columns: ['name', 'stage', 'point_of_contact'],
      rows: [['Deal', 'new', 'Sam']],
    });
    expect(report).toMatchObject({ created: 0, skipped: 1 });
    expect(report.errors[0]?.message).toBe('2 people are called "Sam": use a unique field or its id');
  });

  it('does not create a record whose unique value exists, or that the file repeats', async () => {
    await run('person', { columns: ['first_name', 'email'], rows: [['Linus', 'linus@example.com']] });
    const report = await run('person', {
      columns: ['first_name', 'email'],
      rows: [
        ['Linus again', 'LINUS@example.com'],
        ['Ken', 'ken@example.com'],
        ['Ken twice', 'ken@example.com'],
      ],
    });
    expect(report).toMatchObject({ created: 1, skipped: 2 });
    expect(report.errors).toEqual([
      { row: 2, field: 'Email', message: '"linus@example.com" already exists' },
      { row: 4, field: 'Email', message: '"ken@example.com" is also in row 3' },
    ]);
  });

  it('updates the record whose unique field matches, with the cells that are not empty, when asked to', async () => {
    const report = await run('person', {
      columns: ['email', 'first_name', 'phone', 'city'],
      matchOn: 'email',
      rows: [
        ['linus@example.com', 'Linus T.', '', 'Helsinki'],
        ['new@example.com', 'Newcomer', '', ''],
      ],
    });
    expect(report).toMatchObject({ created: 1, updated: 1, skipped: 0 });
    const linus = (await people()).find((person) => person.email === 'linus@example.com');
    expect(linus).toMatchObject({ first_name: 'Linus T.', city: 'Helsinki' });
    expect(linus?.phone ?? null).toBeNull();
  });

  it('refuses a call that is wrong as a whole: an unknown field, a repeated one, a field that cannot be filled, a bad matchOn, too many rows', async () => {
    expect(await codeOf(run('company', { columns: ['nope'], rows: [['x']] }))).toBe('VALIDATION');
    expect(await codeOf(run('company', { columns: ['name', 'name'], rows: [['x', 'y']] }))).toBe('VALIDATION');
    expect(await codeOf(run('company', { columns: ['name'], matchOn: 'domain', rows: [['x']] }))).toBe('VALIDATION');
    expect(
      await codeOf(
        run('company', { columns: ['name'], matchOn: 'name', rows: Array.from({ length: 501 }, () => ['x']) }),
      ),
    ).toBe('VALIDATION');
  });

  it('refuses a caller that may not write records', async () => {
    const readKey = { workspaceId: t.workspaceId, actor: { kind: 'api_key' as const, id: 'k' }, role: null };
    expect(
      await codeOf(t.engine.records.import(readKey, 'company', { columns: ['name'], rows: [['x']] } as never)),
    ).toBe('FORBIDDEN');
  });
});
