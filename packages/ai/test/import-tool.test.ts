import { scopeEngine, silentLogger } from '@devias/data-engine';
import { afterEach, describe, expect, it } from 'vitest';
import { text, toolUse } from '../src/testing';
import type { ToolRunContext } from '../src/tools/types';
import { createHarness, enginePort, eventsOf, type Harness, platformTools, resolve, send } from './helpers';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const CSV = 'Name,Employees,Website\nAcme,"1,200",\nBad Co,many,\nGlobex,30,';

const companies = async (harness: Harness) =>
  (await harness.engine.records.list(harness.owner, { object: 'company', limit: 100 })).items;

describe('the agent importing records', () => {
  it('checks a pasted table first, then imports it, each after the person approves', async () => {
    h = await createHarness([
      { content: [toolUse('import_records', { object: 'company', csv: CSV, dryRun: true }, 'tu_check')] },
      { content: [toolUse('import_records', { object: 'company', csv: CSV }, 'tu_import')] },
      { content: [text('Imported 2 of 3.')] },
    ]);
    const conversation = await h.service.conversations.create(h.owner, {});
    const sent = await send(h, h.owner, conversation.id, 'import these as companies');
    const check = eventsOf(sent, 'paused')[0]?.pending[0];
    expect(check).toMatchObject({ name: 'import_records', requiresApproval: true });
    expect((await companies(h)).some((company) => company.name === 'Acme')).toBe(false);

    const checked = await resolve(h, h.owner, conversation.id, check?.id ?? '', true);
    const import_ = eventsOf(checked, 'paused')[0]?.pending[0];
    // Approving the check wrote nothing; the import asks again.
    expect((await companies(h)).some((company) => company.name === 'Acme')).toBe(false);
    expect(import_).toMatchObject({ name: 'import_records', requiresApproval: true });

    const done = await resolve(h, h.owner, conversation.id, import_?.id ?? '', true);
    expect(eventsOf(done, 'done')[0]?.status).toBe('completed');
    const names = (await companies(h)).map((company) => company.name);
    expect(names).toContain('Acme');
    expect(names).toContain('Globex');
    expect(names).not.toContain('Bad Co');
  });
});

describe('the import_records tool', () => {
  // biome-ignore lint/suspicious/noExplicitAny: a tool's result is untyped JSON that the tests read freely
  const run = async (input: unknown): Promise<any> => {
    h = h ?? (await createHarness([]));
    const tool = platformTools(h.engine).find((t) => t.name === 'import_records');

    if (!tool) {
      throw new Error('no import_records tool');
    }

    const context: ToolRunContext = {
      workspaceId: h.workspaceId,
      ctx: h.owner,
      engine: h.engine,
      scoped: scopeEngine(h.engine, h.owner),
      logger: silentLogger,
      navigate: () => {},
      actions: enginePort(h.engine),
    };

    return tool.run(tool.input.parse(input), context);
  };

  it('reads the header against the fields, and says what each column became and what the rows did', async () => {
    const result = await run({ object: 'company', csv: CSV, dryRun: true });
    expect(result).toMatchObject({ object: 'company', dryRun: true, created: 2, skipped: 1, errorCount: 1 });
    // Row numbers are the table's: the header is row 1.
    expect(result.errors).toEqual([{ row: 3, field: 'Employees', message: '"many" is not a number' }]);
    expect(result.columns).toEqual([
      { column: 'Name', field: 'Name' },
      { column: 'Employees', field: 'Employees' },
      { column: 'Website', field: null },
    ]);
    expect(result.notImported).toEqual(['Website']);
  });

  it('refuses a table without a header, and one that is too long', async () => {
    await expect(run({ object: 'company', csv: '10,20\n30,40' })).rejects.toThrow('needs a header row');
    const long = `Name\n${Array.from({ length: 501 }, (_, i) => `Co ${i}`).join('\n')}`;
    await expect(run({ object: 'company', csv: long })).rejects.toThrow('at most 500 per call');
  });
});
