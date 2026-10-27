import { RICH_TEXT_MAX_DEPTH, RICH_TEXT_MAX_LENGTH } from '@devias/core';
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

const text = (value: string, href?: string) => ({
  type: 'text',
  text: value,
  ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}),
});
const doc = (...content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });

describe('what the engine stores for a rich-text field', () => {
  let t: TestEngine;
  let id: string;

  beforeAll(async () => {
    t = await createTestEngine();
    const company = (await t.engine.metadata.objects.list(t.owner)).find((object) => object.nameSingular === 'company');

    if (!company) {
      throw new Error('company');
    }

    await t.engine.metadata.fields.create(t.owner, {
      objectId: company.id,
      name: 'brief',
      type: 'rich_text',
      label: 'Brief',
    });
    await t.engine.metadata.fields.create(t.owner, {
      objectId: company.id,
      name: 'code',
      type: 'text',
      label: 'Code',
      isUnique: true,
    });
    id = (await t.engine.records.create(t.owner, 'company', { name: 'Base', code: 'base' })).id;
  });
  afterAll(() => t.close());

  const tooDeep = () => {
    let node: unknown = { type: 'paragraph' };

    for (let n = 0; n <= RICH_TEXT_MAX_DEPTH; n++) {
      node = { type: 'blockquote', content: [node] };
    }

    return { type: 'doc', content: [node] };
  };
  const refused: Record<string, unknown> = {
    'a string': 'Met **Ada**',
    'a number': 3,
    'an object that is not a document': { hello: 'world' },
    'a document that is too large': doc(text('x'.repeat(RICH_TEXT_MAX_LENGTH))),
    'a document nested too deeply': tooDeep(),
    'a document whose content is not a list': { type: 'doc', content: 'x' },
    'a document holding something that is not a node': { type: 'doc', content: [3] },
  };

  for (const [name, value] of Object.entries(refused)) {
    it(`refuses ${name} on create, update, upsert and batch`, async () => {
      expect(await codeOf(t.engine.records.create(t.owner, 'company', { name: 'A', brief: value }))).toBe('VALIDATION');
      expect(await codeOf(t.engine.records.update(t.owner, 'company', id, { brief: value }))).toBe('VALIDATION');
      expect(await codeOf(t.engine.records.upsert(t.owner, 'company', { code: 'base' }, { brief: value }))).toBe(
        'VALIDATION',
      );
      expect(
        await codeOf(t.engine.records.batch(t.owner, 'company', { update: [{ id, patch: { brief: value } }] })),
      ).toBe('VALIDATION');
      expect(await codeOf(t.engine.records.batch(t.owner, 'company', { create: [{ name: 'B', brief: value }] }))).toBe(
        'VALIDATION',
      );
    });
  }

  it('strips a link it may not carry, wherever the value is written, and keeps the text', async () => {
    const unsafe = doc(text('click', 'javascript:alert(1)'), text(' or '), text('here', 'https://example.com'));
    const created = await t.engine.records.create(t.owner, 'company', { name: 'Links', brief: unsafe });
    const updated = await t.engine.records.update(t.owner, 'company', id, { brief: unsafe });
    const upserted = await t.engine.records.upsert(t.owner, 'company', { code: 'base' }, { brief: unsafe });
    const batched = await t.engine.records.batch(t.owner, 'company', { update: [{ id, patch: { brief: unsafe } }] });
    const clean = doc(text('click'), text(' or '), text('here', 'https://example.com'));
    const marksOf = (value: unknown) =>
      JSON.stringify(value).includes('javascript')
        ? 'unsafe'
        : JSON.stringify(value).includes('example.com')
          ? 'kept'
          : '';

    for (const value of [created.brief, updated.brief, upserted.record.brief, batched.updated[0]?.brief]) {
      expect(marksOf(value)).toBe('kept');
      expect(JSON.stringify(value)).toContain('click');
    }

    expect(created.brief).toMatchObject({ type: 'doc' });
    expect(JSON.stringify(created.brief).replace(/,"marks":\[\]/g, '')).toBe(JSON.stringify(clean));
  });

  it('keeps a valid document exactly, and null', async () => {
    const value = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [text('Title')] }, { type: 'paragraph' }],
    };
    expect((await t.engine.records.update(t.owner, 'company', id, { brief: value })).brief).toEqual(value);
    expect((await t.engine.records.update(t.owner, 'company', id, { brief: null })).brief).toBeNull();
  });

  it('refuses a string with the way to write Markdown, and still reads one stored before', async () => {
    const error = await t.engine.records.update(t.owner, 'company', id, { brief: 'Met **Ada**' }).catch((e) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect(JSON.stringify((error as EngineError).details)).toContain(
      'Field brief is rich text: send an editor document',
    );
    expect(JSON.stringify((error as EngineError).details)).toContain('markdownToRichText');

    // A value from before the check is a string in the database: it reads as it was, and other writes leave it.
    await t.client.query(`update record set data = jsonb_set(data, '{brief}', '"legacy text"') where id = $1`, [id]);
    const legacy = await t.engine.records.get(t.owner, 'company', id);
    expect(legacy.brief).toBe('legacy text');
    expect((await t.engine.records.update(t.owner, 'company', id, { name: 'Renamed' })).brief).toBe('legacy text');
  });
});
