import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown, markdownToRichText, mentionsOf, richTextToMarkdown } from '../src';

const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });

describe('markdownToRichText', () => {
  it('reads headings, paragraphs and breaks inside a paragraph', () => {
    expect(markdownToRichText('# Site visit\n\nMeasured the bathroom.\nCall back Monday.')).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [t('Site visit')] },
        p(t('Measured the bathroom.'), { type: 'hardBreak' }, t('Call back Monday.')),
      ],
    });
    expect(markdownToRichText('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('reads bullet, numbered and to-do lists, nested by indent', () => {
    const doc = markdownToRichText('- one\n  - inner\n- two\n\n1. first\n2. second\n\n- [ ] open\n- [x] done');
    const [bullets, ordered, tasks] = doc.content ?? [];
    expect(bullets?.type).toBe('bulletList');
    expect(bullets?.content).toHaveLength(2);
    expect(bullets?.content?.[0]?.content?.[1]?.type).toBe('bulletList');
    expect(ordered).toMatchObject({ type: 'orderedList', attrs: { start: 1 } });
    expect(tasks?.type).toBe('taskList');
    expect(tasks?.content?.map((item) => item.attrs?.checked)).toEqual([false, true]);
  });

  it('reads quotes, code blocks and rules, and leaves markup alone inside code', () => {
    const doc = markdownToRichText('> said so\n\n```ts\nconst a = **1**;\n```\n\n---');
    expect(doc.content?.map((node) => node.type)).toEqual(['blockquote', 'codeBlock', 'horizontalRule']);
    expect(doc.content?.[1]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [t('const a = **1**;')],
    });
  });

  it('reads bold, italic, strike, code and links', () => {
    expect(
      markdownToRichText('**b** and *i* and ~~s~~ and `c` and [site](https://x.test) and snake_case_name'),
    ).toEqual({
      type: 'doc',
      content: [
        p(
          t('b', [{ type: 'bold' }]),
          t(' and '),
          t('i', [{ type: 'italic' }]),
          t(' and '),
          t('s', [{ type: 'strike' }]),
          t(' and '),
          t('c', [{ type: 'code' }]),
          t(' and '),
          t('site', [{ type: 'link', attrs: { href: 'https://x.test' } }]),
          t(' and snake_case_name'),
        ),
      ],
    });
  });

  it('turns record links into mentions', () => {
    const doc = markdownToRichText('Call [Ana Pop](record:person/7f3c) about [the quote](record:quote/9a1b).');
    expect(mentionsOf(doc)).toEqual([
      { object: 'person', id: '7f3c', label: 'Ana Pop' },
      { object: 'quote', id: '9a1b', label: 'the quote' },
    ]);
  });
});

describe('richTextToMarkdown', () => {
  it('writes what it reads back', () => {
    const source = [
      '# Plan',
      '',
      'Meet [Ana](record:person/p1) on **Monday**.',
      '',
      '- one',
      '  - inner',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '- [ ] open',
      '- [x] done',
      '',
      '> a quote',
      '',
      '```js',
      'let a = 1;',
      '```',
      '',
      '---',
    ].join('\n');
    expect(richTextToMarkdown(markdownToRichText(source))).toBe(source);
  });

  it('passes plain strings through and reads an empty value as nothing', () => {
    expect(richTextToMarkdown('Just text')).toBe('Just text');
    expect(richTextToMarkdown(null)).toBe('');
  });
});

describe('tables', () => {
  const source = '| Item | Qty |\n| --- | --- |\n| Cable | 12 |\n| **Pump** | [Ana](record:person/p1) |';

  it('reads a pipe table: the first row as the header, inline Markdown inside cells', () => {
    const [table] = markdownToRichText(source).content ?? [];
    expect(table?.type).toBe('table');
    const rows = table?.content ?? [];
    expect(rows.map((row) => row.content?.map((cell) => cell.type))).toEqual([
      ['tableHeader', 'tableHeader'],
      ['tableCell', 'tableCell'],
      ['tableCell', 'tableCell'],
    ]);
    expect(rows[2]?.content?.[0]?.content?.[0]).toEqual(p(t('Pump', [{ type: 'bold' }])));
    expect(mentionsOf(markdownToRichText(source))).toEqual([{ object: 'person', id: 'p1', label: 'Ana' }]);
  });

  it('writes the table back, and keeps the text around it as it was', () => {
    const document = `Before\n\n${source}\n\nAfter`;
    expect(richTextToMarkdown(markdownToRichText(document))).toBe(document);
  });

  it('fills short rows, cuts long ones, and keeps escaped pipes inside a cell', () => {
    const doc = markdownToRichText('a | b\n--|--\n1\n2 | 3 | 4\nx \\| y | z');
    const rows = doc.content?.[0]?.content ?? [];
    expect(rows.map((row) => row.content?.length)).toEqual([2, 2, 2, 2]);
    expect(richTextToMarkdown(doc)).toBe('| a | b |\n| --- | --- |\n| 1 |  |\n| 2 | 3 |\n| x \\| y | z |');
  });

  it('is not a table without a rule row, and does not swallow the paragraph before it', () => {
    expect(markdownToRichText('a | b\nnot a rule').content?.map((node) => node.type)).toEqual(['paragraph']);
    expect(markdownToRichText('Intro line\n| a | b |\n|---|---|\n| 1 | 2 |').content?.map((node) => node.type)).toEqual(
      ['paragraph', 'table'],
    );
  });

  it('counts as Markdown when pasted', () => {
    expect(looksLikeMarkdown(source)).toBe(true);
    expect(looksLikeMarkdown('just a | pipe')).toBe(false);
  });
});

describe('workflow mentions', () => {
  it('reads a workflow link as a mention of the object "workflow", and writes it back', () => {
    const doc = markdownToRichText('Run [Nightly cleanup](workflow:wf-1) after [Ana](record:person/p1).');
    expect(mentionsOf(doc)).toEqual([
      { object: 'workflow', id: 'wf-1', label: 'Nightly cleanup' },
      { object: 'person', id: 'p1', label: 'Ana' },
    ]);
    expect(richTextToMarkdown(doc)).toBe('Run [Nightly cleanup](workflow:wf-1) after [Ana](record:person/p1).');
  });
});
