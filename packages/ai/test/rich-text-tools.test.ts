import { isRichTextDoc, markdownToRichText, type RichTextDoc } from '@devias/core';
import { scopeEngine, silentLogger } from '@devias/data-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ToolRunContext } from '../src/tools/types';
import { createHarness, enginePort, type Harness, platformTools } from './helpers';

let h: Harness;

beforeAll(async () => {
  h = await createHarness([]);
  const { index } = await h.engine.metadata.getSnapshot(h.workspaceId);
  const company = index.objectsByName.get('company');

  if (!company) {
    throw new Error('company');
  }

  await h.engine.metadata.fields.create(h.owner, {
    objectId: company.id,
    name: 'brief',
    type: 'rich_text',
    label: 'Brief',
  });
  await h.engine.metadata.fields.create(h.owner, {
    objectId: company.id,
    name: 'code',
    type: 'text',
    label: 'Code',
    isUnique: true,
  });
});
afterAll(() => h.close());

// biome-ignore lint/suspicious/noExplicitAny: a tool's result is untyped JSON that the tests read freely
const run = async (name: string, input: unknown): Promise<any> => {
  const tool = platformTools(h.engine).find((t) => t.name === name);

  if (!tool) {
    throw new Error(`no tool ${name}`);
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

const text = (value: string) => ({ type: 'text', text: value });
const cell = (type: 'tableHeader' | 'tableCell', value: string, colspan = 1) => ({
  type,
  attrs: { colspan, rowspan: 1, colwidth: null },
  content: [{ type: 'paragraph', content: [text(value)] }],
});
/** A table with a merged cell: something Markdown cannot carry. */
const merged = (): RichTextDoc => ({
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', 'wide', 2)] },
        { type: 'tableRow', content: [cell('tableCell', 'a'), cell('tableCell', 'b')] },
      ],
    },
  ],
});

const MARKDOWN = 'A **bold** claim\n\n- one\n- two';
const blocksOf = (value: unknown) => ((value as RichTextDoc).content ?? []).map((node) => node.type);

describe('the agent writing and reading rich text through every record tool', () => {
  it('stores what upsert_record is given as a document, and reads it back as Markdown', async () => {
    const created = await run('upsert_record', {
      object: 'company',
      match: { code: 'u1' },
      values: { name: 'Upserted', brief: MARKDOWN },
    });
    expect(created).toMatchObject({ created: true, record: { brief: MARKDOWN } });
    expect(created.warnings).toBeUndefined();
    const stored = await h.engine.records.get(h.owner, 'company', created.id);
    expect(isRichTextDoc(stored.brief)).toBe(true);
    expect(blocksOf(stored.brief)).toEqual(['paragraph', 'bulletList']);

    const updated = await run('upsert_record', {
      object: 'company',
      match: { code: 'u1' },
      values: { brief: '# Now a heading' },
    });
    expect(updated).toMatchObject({ created: false, id: created.id, record: { brief: '# Now a heading' } });
    expect(blocksOf((await h.engine.records.get(h.owner, 'company', created.id)).brief)).toEqual(['heading']);
  });

  it('stores what batch_write_records is given as documents, and reads them back as Markdown', async () => {
    const [first, second] = await Promise.all(
      ['b1', 'b2'].map((code) => h.engine.records.create(h.owner, 'company', { name: code, code })),
    );
    const result = await run('batch_write_records', {
      object: 'company',
      create: [{ name: 'Made', code: 'b3', brief: MARKDOWN }],
      update: [{ id: first?.id, patch: { brief: '**one**' } }],
    });
    expect(result.created[0].brief).toBe(MARKDOWN);
    expect(result.updated[0].brief).toBe('**one**');
    expect(result.warnings).toBeUndefined();
    expect(isRichTextDoc((await h.engine.records.get(h.owner, 'company', first?.id ?? '')).brief)).toBe(true);
    expect(second?.brief ?? null).toBeNull();
  });

  it("reads a record's activity with rich text as Markdown", async () => {
    const record = await h.engine.records.create(h.owner, 'company', { name: 'Hist', brief: merged() });
    await run('update_record', { object: 'company', id: record.id, patch: { brief: 'after' } });
    const history = await run('list_record_activity', { object: 'company', id: record.id });
    const update = history.items.find((entry: { kind: string }) => entry.kind === 'updated');
    const change = update.changes.find((one: { field: string }) => one.field === 'brief');
    expect(change.after).toBe('after');
    expect(typeof change.before).toBe('string');
    expect(change.before).toContain('wide');
  });

  it('warns when a rewrite drops what Markdown cannot carry, and only then', async () => {
    const lossy = await h.engine.records.create(h.owner, 'company', { name: 'Lossy', code: 'l1', brief: merged() });
    const plain = await h.engine.records.create(h.owner, 'company', {
      name: 'Plain',
      code: 'l2',
      brief: markdownToRichText(MARKDOWN),
    });
    const lossyCall = await run('update_record', { object: 'company', id: lossy.id, patch: { brief: 'new' } });
    expect(lossyCall.warnings).toHaveLength(1);
    expect(lossyCall.warnings[0]).toContain('merged table cells');
    expect(lossyCall.warnings[0]).toContain('history');
    // The rewrite still happened: a warning, not a block.
    expect(lossyCall.record.brief).toBe('new');

    expect(
      (await run('update_record', { object: 'company', id: plain.id, patch: { brief: 'x' } })).warnings,
    ).toBeUndefined();
    // A write that does not touch the text has nothing to warn about.
    const other = await h.engine.records.update(h.owner, 'company', lossy.id, { brief: merged() });
    expect(
      (await run('update_record', { object: 'company', id: other.id, patch: { name: 'Renamed' } })).warnings,
    ).toBeUndefined();

    await h.engine.records.update(h.owner, 'company', lossy.id, { brief: markdownToRichText(MARKDOWN) });
    const upsert = await run('upsert_record', { object: 'company', match: { code: 'l1' }, values: { brief: 'again' } });
    expect(upsert.warnings).toBeUndefined();
    await h.engine.records.update(h.owner, 'company', lossy.id, { brief: merged() });
    const upsertLossy = await run('upsert_record', {
      object: 'company',
      match: { code: 'l1' },
      values: { brief: 'again' },
    });
    expect(upsertLossy.warnings?.[0]).toContain('merged table cells');
    await h.engine.records.update(h.owner, 'company', lossy.id, { brief: merged() });
    const batch = await run('batch_write_records', {
      object: 'company',
      update: [{ id: lossy.id, patch: { brief: 'batched' } }],
    });
    expect(batch.warnings?.[0]).toContain('merged table cells');
  });

  it('warns when a rewrite of a document or a task drops what Markdown cannot carry', async () => {
    const document = await h.engine.documents.create(h.owner, { title: 'Spec', body: merged() });
    const rewritten = await run('update_document', { id: document.id, markdown: 'short' });
    expect(rewritten.warnings?.[0]).toContain('merged table cells');
    expect(rewritten.markdown).toBe('short');
    expect((await run('update_document', { id: document.id, title: 'Renamed' })).warnings).toBeUndefined();

    const task = await h.engine.tasks.create(h.owner, { title: 'Do it', body: merged() });
    const edited = await run('update_task', { id: task.id, markdown: 'short' });
    expect(edited.warnings?.[0]).toContain('merged table cells');
    expect((await run('update_task', { id: task.id, status: 'done' })).warnings).toBeUndefined();
  });

  it('stores a rich-text default the model wrote as a document, and shows it back as Markdown', async () => {
    const created = await run('create_field', {
      object: 'person',
      name: 'about',
      type: 'rich_text',
      label: 'About',
      defaultValue: 'Not **yet** known',
    });
    expect(created.field.defaultValue).toBe('Not **yet** known');
    const { index } = await h.engine.metadata.getSnapshot(h.workspaceId);
    const object = index.objectsByName.get('person');
    const field = index.fieldsByObjectId.get(object?.id ?? '')?.find((one) => one.name === 'about');
    expect(isRichTextDoc(field?.defaultValue)).toBe(true);
    const person = await h.engine.records.create(h.owner, 'person', { first_name: 'Ada' });
    expect(isRichTextDoc(person.about)).toBe(true);
  });
});
