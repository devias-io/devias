import { manifest as fixture } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { DeviasApiError } from '../src';
import { createMockClient } from '../src/mock';

const client = () => createMockClient({ workspaceId: 'ws_test', manifests: [fixture] });

describe('mock import', () => {
  it('creates records from text, and says what it did', async () => {
    const c = client();
    const report = await c.records.import('company', {
      columns: ['name', 'employees', 'ideal_customer_profile'],
      rows: [
        ['Initech', '1,200', 'yes'],
        ['Umbrella', '30', 'no'],
      ],
    });
    expect(report).toMatchObject({ created: 2, updated: 0, skipped: 0, errorCount: 0, errors: [], dryRun: false });
    expect(report.importId).toBeTruthy();
    const initech = (await c.records.list({ object: 'company', filter: { field: 'name', op: 'eq', value: 'Initech' } }))
      .items[0];
    expect(initech).toMatchObject({ employees: 1200, ideal_customer_profile: true });
  });

  it('writes nothing on a dry run, and skips bad rows by their spreadsheet number', async () => {
    const c = client();
    const dry = await c.records.import('company', { columns: ['name'], rows: [['Hooli']], dryRun: true });
    expect(dry).toMatchObject({ created: 1, dryRun: true });
    expect(
      (await c.records.list({ object: 'company', filter: { field: 'name', op: 'eq', value: 'Hooli' } })).items,
    ).toHaveLength(0);

    const report = await c.records.import('company', {
      columns: ['name', 'employees'],
      rows: [
        ['Good', '5'],
        ['Bad', 'many'],
        ['', '3'],
      ],
    });
    expect(report).toMatchObject({ created: 1, skipped: 2 });
    expect(report.errors).toEqual([
      { row: 3, field: 'Employees', message: '"many" is not a number' },
      { row: 4, field: 'Name', message: 'Name is required' },
    ]);
  });

  it('finds related records by name, updates by a unique field when asked, and refuses a repeat', async () => {
    const c = client();
    await c.records.create('company', { name: 'Acme' });
    const people = await c.records.import('person', {
      columns: ['first_name', 'email', 'company'],
      rows: [
        ['Ada', 'ada@example.com', 'acme'],
        ['Alan', 'alan@example.com', 'Nowhere'],
        ['Ada again', 'ADA@example.com', ''],
      ],
    });
    expect(people).toMatchObject({ created: 1, skipped: 2 });
    expect(people.errors.map((e) => e.message)).toEqual([
      'No company is called "Nowhere"',
      '"ada@example.com" is also in row 2',
    ]);
    const again = await c.records.import('person', {
      columns: ['first_name', 'email'],
      rows: [['Adam', 'Ada@Example.com']],
    });
    expect(again.errors).toEqual([{ row: 2, field: 'Email', message: '"ada@example.com" already exists' }]);

    const updated = await c.records.import('person', {
      columns: ['email', 'first_name'],
      matchOn: 'email',
      rows: [['ada@example.com', 'Ada L.']],
    });
    expect(updated).toMatchObject({ created: 0, updated: 1 });
  });

  it('refuses a call that is wrong as a whole', async () => {
    const c = client();
    await expect(c.records.import('company', { columns: ['nope'], rows: [['x']] })).rejects.toBeInstanceOf(
      DeviasApiError,
    );
    await expect(
      c.records.import('company', { columns: ['name'], matchOn: 'domain', rows: [['x']] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
