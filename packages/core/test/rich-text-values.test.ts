import { describe, expect, it } from 'vitest';
import { valueSchemaForField } from '../src/metadata/field-types';
import { RICH_TEXT_MAX_DEPTH, RICH_TEXT_MAX_LENGTH } from '../src/rich-text';
import { richTextToMessage } from '../src/rich-text-markdown';
import { richTextValuesFromText, richTextValuesToText } from '../src/rich-text-values';

const FIELDS = [
  { name: 'notes', type: 'rich_text' },
  { name: 'title', type: 'text' },
];

describe('rich text values', () => {
  it('turns Markdown into documents for rich-text fields only', () => {
    const out = richTextValuesFromText(FIELDS, { notes: 'a **b**', title: '**not** a document', other: 'x' });
    expect(out.notes).toMatchObject({ type: 'doc' });
    expect(out.title).toBe('**not** a document');
    expect(out.other).toBe('x');
  });

  it('leaves a document, null and a missing value for the engine to check', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(richTextValuesFromText(FIELDS, { notes: doc }).notes).toBe(doc);
    expect(richTextValuesFromText(FIELDS, { notes: null }).notes).toBeNull();
    expect('notes' in richTextValuesFromText(FIELDS, {})).toBe(false);
  });

  it('does not change what it was given', () => {
    const values = { notes: 'a' };
    richTextValuesFromText(FIELDS, values);
    expect(values.notes).toBe('a');
  });

  it('reads documents back as Markdown, and leaves null and other fields alone', () => {
    const stored = richTextValuesFromText(FIELDS, { notes: 'a **b**' });
    expect(richTextValuesToText(FIELDS, { ...stored, title: 'T' })).toEqual({ notes: 'a **b**', title: 'T' });
    expect(richTextValuesToText(FIELDS, { notes: null })).toEqual({ notes: null });
  });
});

describe('a message typed in a plain box', () => {
  const p = (...content: unknown[]) => ({ type: 'paragraph', content });
  const text = (value: string) => ({ type: 'text', text: value });

  it('keeps the text as typed, with breaks, paragraphs and mentions as links', () => {
    const doc = {
      type: 'doc',
      content: [
        p(text('# not a heading, **not bold** '), { type: 'hardBreak' }, text('1. nor a list')),
        p({ type: 'mention', attrs: { object: 'company', id: 'c1', label: 'Initech' } }),
      ],
    };
    expect(richTextToMessage(doc)).toBe(
      '# not a heading, **not bold** \n1. nor a list\n\n[Initech](record:company/c1)',
    );
    expect(richTextToMessage(null)).toBe('');
  });
});

describe('the value of a rich-text field', () => {
  const schema = valueSchemaForField({ type: 'rich_text' });
  const doc = (...content: unknown[]) => ({ type: 'doc', content });
  const para = (...content: unknown[]) => ({ type: 'paragraph', content });

  it('accepts a document and null', () => {
    const value = doc(para({ type: 'text', text: 'hi' }));
    expect(schema.parse(value)).toEqual(value);
    expect(schema.parse(null)).toBeNull();
  });

  it('refuses a string, and says how to write Markdown', () => {
    const result = valueSchemaForField({ type: 'rich_text', name: 'notes' }).safeParse('Met **Ada**');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'Field notes is rich text: send an editor document. To write Markdown, convert it with markdownToRichText from @devias/core',
    );
    expect(schema.safeParse('').success).toBe(false);
  });

  it('refuses what is not a document', () => {
    for (const value of [1, true, { type: 'paragraph' }, { hello: 'world' }, ['doc'], { type: 'doc', content: 'x' }]) {
      expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it('refuses a document that is too large or nested too deeply', () => {
    expect(schema.safeParse(doc(para({ type: 'text', text: 'x'.repeat(RICH_TEXT_MAX_LENGTH) }))).success).toBe(false);
    let deep: unknown = para({ type: 'text', text: 'x' });

    for (let n = 0; n <= RICH_TEXT_MAX_DEPTH; n++) {
      deep = { type: 'blockquote', content: [deep] };
    }

    expect(schema.safeParse(doc(deep)).success).toBe(false);
  });

  it('strips a link it may not carry and keeps the text', () => {
    const link = (href: string) => ({ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] });
    expect(schema.parse(doc(para(link('javascript:alert(1)'))))).toEqual(
      doc(para({ type: 'text', text: 'x', marks: [] })),
    );
    expect(schema.parse(doc(para(link('https://example.com'))))).toEqual(doc(para(link('https://example.com'))));
  });

  it('rejects null when the field is required', () => {
    expect(valueSchemaForField({ type: 'rich_text', isRequired: true }).safeParse(null).success).toBe(false);
  });
});
