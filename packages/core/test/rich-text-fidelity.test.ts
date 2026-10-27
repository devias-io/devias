import { describe, expect, it } from 'vitest';
import { MENTION_NODE, markdownLosses, markdownToRichText, type RichTextNode, richTextToMarkdown } from '../src';

type Mark = { type: string; attrs?: Record<string, unknown> };

const text = (value: string, ...marks: (string | Mark)[]): RichTextNode => ({
  type: 'text',
  text: value,
  ...(marks.length > 0 ? { marks: marks.map((mark) => (typeof mark === 'string' ? { type: mark } : mark)) } : {}),
});
const link = (href: string): Mark => ({ type: 'link', attrs: { href } });
const p = (...content: RichTextNode[]): RichTextNode => ({ type: 'paragraph', content });
const doc = (...content: RichTextNode[]) => ({ type: 'doc', content });
const mention = (label: string): RichTextNode => ({
  type: MENTION_NODE,
  attrs: { object: 'company', id: 'c1', label },
});
const list = (type: string, ...items: RichTextNode[][]): RichTextNode => ({
  type,
  content: items.map((content) => ({ type: type === 'taskList' ? 'taskItem' : 'listItem', content })),
});

/** The text a document writes as, read back, written again. */
const roundTrip = (value: unknown) => richTextToMarkdown(markdownToRichText(richTextToMarkdown(value)));

describe('what survives a round trip through Markdown', () => {
  const kept: Record<string, ReturnType<typeof doc>> = {
    paragraphs: doc(p(text('one')), p(text('two'))),
    'bold, italic, strike and code': doc(
      p(
        text('a '),
        text('b', 'bold'),
        text(' '),
        text('i', 'italic'),
        text(' '),
        text('s', 'strike'),
        text(' '),
        text('c', 'code'),
      ),
    ),
    underline: doc(p(text('under', 'underline'))),
    'bold and italic together': doc(p(text('both', 'bold', 'italic'))),
    'bold around code': doc(p(text('x = 1', 'bold', 'code'))),
    links: doc(p(text('site', link('https://example.com')))),
    'a link with parentheses': doc(p(text('wiki', link('https://en.wikipedia.org/wiki/Foo_(bar)')))),
    'a link with a space': doc(p(text('file', link('https://example.com/a b')))),
    'a link in bold': doc(p(text('go', 'bold', link('https://example.com')))),
    headings: doc({ type: 'heading', attrs: { level: 3 }, content: [text('Title')] }),
    'a heading that ends with #': doc({ type: 'heading', attrs: { level: 2 }, content: [text('Learning C#')] }),
    'bullet, numbered and nested lists': doc(
      list('bulletList', [p(text('one')), list('bulletList', [p(text('inner'))])], [p(text('two'))]),
      list('orderedList', [p(text('first'))], [p(text('second'))]),
    ),
    'to-do lists': doc({
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [p(text('done'))] },
        { type: 'taskItem', attrs: { checked: false }, content: [p(text('todo'))] },
      ],
    }),
    quotes: doc({ type: 'blockquote', content: [p(text('quoted'))] }),
    'code blocks': doc({ type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = 1;')] }),
    'a code block with a fence inside': doc({
      type: 'codeBlock',
      attrs: { language: null },
      content: [text('```\nnot a fence\n```')],
    }),
    rules: doc(p(text('a')), { type: 'horizontalRule' }, p(text('b'))),
    'line breaks': doc(p(text('line one'), { type: 'hardBreak' }, text('line two'))),
    mentions: doc(p(text('See '), mention('Acme'))),
    'a mention with brackets in its label': doc(p(mention('Acme [EU] Ltd'))),
    'a table with a header row': doc({
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [p(text('A'))] },
            { type: 'tableHeader', content: [p(text('B'))] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [p(text('1'))] },
            { type: 'tableCell', content: [p(text('2'))] },
          ],
        },
      ],
    }),
    // Text that only looks like syntax stays text.
    'text with asterisks': doc(p(text('use **kwargs and 2 * 3 * 4'))),
    'text in backticks': doc(p(text('call `run()` then `stop()`'))),
    'text with a literal link': doc(p(text('see [a](b) for more'))),
    'text with a literal underline tag': doc(p(text('type <u>x</u> to underline'))),
    'text with snake_case and a_b_c': doc(p(text('set lead_score and a_b_c'))),
    'text with backslashes': doc(p(text('C:\\Users\\*.txt and a\\*b and a\\'))),
    'text that starts like a heading': doc(p(text('# not a heading'))),
    'text that starts like a list': doc(p(text('1. not a list')), p(text('- nor this')), p(text('* nor this'))),
    'text that starts like a quote, a fence or a rule': doc(
      p(text('> not a quote')),
      p(text('```not a fence')),
      p(text('---')),
      p(text('***')),
    ),
    'a list item that is only a pipe, after a line with one': doc({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p(text('a|b'))] },
        { type: 'listItem', content: [p(text('|'))] },
      ],
    }),
    'a line that starts like a list after a break': doc(p(text('first'), { type: 'hardBreak' }, text('- second'))),
  };

  for (const [name, value] of Object.entries(kept)) {
    it(`keeps ${name}`, () => {
      expect(markdownLosses(value)).toEqual([]);
      // And what is written is stable: writing what was read changes nothing.
      expect(roundTrip(value)).toBe(richTextToMarkdown(value));
    });
  }

  it('writes the cases that were damaged before the way they read back', () => {
    expect(richTextToMarkdown(doc(p(text('both', 'bold', 'italic'))))).toBe('***both***');
    expect(richTextToMarkdown(doc(p(text('under', 'underline'))))).toBe('<u>under</u>');
    expect(richTextToMarkdown(doc(p(text('call `x`'))))).toBe('call \\`x\\`');
    expect(richTextToMarkdown(doc(p(text('# not a heading'))))).toBe('\\# not a heading');
    expect(richTextToMarkdown(doc(p(text('1. not a list'))))).toBe('1\\. not a list');
    expect(richTextToMarkdown(doc(p(text('[a](b)'))))).toBe('\\[a](b)');
    expect(richTextToMarkdown(doc(p(text('go', link('https://example.com/a b')))))).toBe(
      '[go](<https://example.com/a b>)',
    );
    expect(richTextToMarkdown(doc(p(text('run `ls`', 'code'))))).toBe('`` run `ls` ``');
    // Plain text that needs no escaping is left alone.
    expect(richTextToMarkdown(doc(p(text('set lead_score to 5 for 2 * 3'))))).toBe('set lead_score to 5 for 2 * 3');
  });

  it('reads what a model writes by hand', () => {
    const read = (markdown: string) => markdownToRichText(markdown).content?.[0]?.content;
    expect(read('***both***')).toEqual([text('both', 'bold', 'italic')]);
    expect(read('<u>under</u> and **bold**')).toEqual([
      text('under', 'underline'),
      text(' and '),
      text('bold', 'bold'),
    ]);
    expect(read('see [x](https://en.wikipedia.org/wiki/Foo_(bar)) now')).toEqual([
      text('see '),
      text('x', link('https://en.wikipedia.org/wiki/Foo_(bar)')),
      text(' now'),
    ]);
    expect(read('\\*not italic\\*')).toEqual([text('*not italic*')]);
    expect(markdownToRichText('## C#').content?.[0]).toEqual({
      type: 'heading',
      attrs: { level: 2 },
      content: [text('C#')],
    });
  });
});

describe('the limits of the round trip, which the writer is told about', () => {
  it('cannot keep code that holds the delimiters of the emphasis around it', () => {
    expect(markdownLosses(doc(p(text('a**b', 'bold', 'code'))))).not.toEqual([]);
    expect(markdownLosses(doc(p(text('</u>', 'underline', 'code'))))).not.toEqual([]);
    // Plain code inside emphasis is fine.
    expect(markdownLosses(doc(p(text('ls -la', 'bold', 'code'))))).toEqual([]);
  });

  it('cannot start a paragraph with a line break', () => {
    expect(markdownLosses(doc(p({ type: 'hardBreak' }, text('after'))))).not.toEqual([]);
  });
});

describe('what a rewrite through Markdown would still lose', () => {
  const cell = (type: string, value: string, attrs: Record<string, unknown> = {}): RichTextNode => ({
    type,
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    content: [p(text(value))],
  });
  const table = (...rows: RichTextNode[][]): RichTextNode => ({
    type: 'table',
    content: rows.map((content) => ({ type: 'tableRow', content })),
  });

  it('says nothing for what is kept, and for spacing', () => {
    expect(markdownLosses(doc(p(text('plain'))))).toEqual([]);
    expect(markdownLosses(doc(p(text('a')), { type: 'paragraph' }, { type: 'paragraph' }, p(text('b'))))).toEqual([]);
    expect(markdownLosses('a plain string')).toEqual([]);
    expect(markdownLosses(null)).toEqual([]);
  });

  it('names merged table cells and a table with no header row', () => {
    expect(markdownLosses(doc(table([cell('tableCell', 'wide', { colspan: 2 })])))).toContain('merged table cells');
    expect(markdownLosses(doc(table([cell('tableCell', 'a')], [cell('tableCell', 'b')])))).toContain(
      'a table without a header row',
    );
  });

  it('names a block or a mark the converter does not know', () => {
    expect(markdownLosses(doc({ type: 'callout', content: [p(text('careful'))] }))).toContain('callout blocks');
    expect(markdownLosses(doc(p(text('lit', 'highlight'))))).toContain('highlight formatting');
  });
});

// A seeded generator, so a failure can be reproduced.
const random = (seed: number) => () => {
  seed += 0x6d2b79f5;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('a round trip over text that looks like syntax', () => {
  const FRAGMENTS = [
    'a',
    'b',
    'word',
    'x y',
    ' ',
    '*',
    '**',
    '***',
    '_',
    '__',
    '~',
    '~~',
    '`',
    '``',
    '[',
    ']',
    '(',
    ')',
    '#',
    '1.',
    '- ',
    '> ',
    '|',
    '\\',
    '\\*',
    '<u>',
    '</u>',
    '<',
    '>',
    '--',
    'http://x.y/a_(b)',
    '2 * 3',
    'snake_case',
  ];
  const MARKS = ['bold', 'italic', 'strike', 'underline', 'code'];
  const HREFS = ['https://example.com', 'https://en.wikipedia.org/wiki/Foo_(bar)', 'https://example.com/a b'];

  /** Text that is only emphasised or only code, for a node whose marks the writer can keep apart. */
  const inline = (next: () => number, breaks = true): RichTextNode[] => {
    const nodes: RichTextNode[] = [];
    const count = 1 + Math.floor(next() * 4);

    for (let n = 0; n < count; n++) {
      const roll = next();
      const last = nodes[nodes.length - 1];

      if (roll < 0.08 && breaks) {
        // Known limit: a line break cannot start or end a paragraph, or sit next to a space (see below).
        if (last && last.type !== 'hardBreak' && (last.type !== 'text' || /\S$/.test(last.text ?? ''))) {
          nodes.push({ type: 'hardBreak' });
        }
      } else if (roll < 0.14) {
        nodes.push(mention(FRAGMENTS[Math.floor(next() * FRAGMENTS.length)] ?? 'x'));
      } else {
        let value = '';
        const pieces = 1 + Math.floor(next() * 4);

        for (let i = 0; i < pieces; i++) {
          value += FRAGMENTS[Math.floor(next() * FRAGMENTS.length)] ?? '';
        }

        const marks: (string | Mark)[] = MARKS.filter(() => next() < 0.18);

        if (next() < 0.12) {
          marks.push(link(HREFS[Math.floor(next() * HREFS.length)] ?? 'https://example.com'));
        }

        // Known limits: code that holds the delimiters of the emphasis around it, and emphasis that touches other
        // emphasis with no character between (see below). A plain space goes between marked runs.
        const code = marks.includes('code') && marks.length > 1;

        if (last?.type === 'text' && (last.marks?.length ?? 0) > 0 && marks.length > 0) {
          nodes.push(text(' '));
        }

        // Known limit: a line break next to a run of nothing but spaces.
        const bare = last?.type === 'hardBreak' && !value.trim();

        nodes.push(text(code ? 'code' : bare ? 'x' : value || 'x', ...marks));
      }
    }

    while (nodes[nodes.length - 1]?.type === 'hardBreak') {
      nodes.pop();
    }

    // A paragraph of nothing but a line break has nothing to write.
    if (nodes.every((node) => node.type === 'hardBreak')) {
      return [text('x')];
    }

    const first = nodes[0];

    return first?.type === 'text' && /^\s/.test(first.text ?? '') && nodes[1]?.type === 'hardBreak' ? [] : nodes;
  };

  const block = (next: () => number): RichTextNode => {
    const roll = next();

    if (roll < 0.15) {
      return { type: 'heading', attrs: { level: 1 + Math.floor(next() * 3) }, content: inline(next, false) };
    }

    if (roll < 0.3) {
      return list('bulletList', [p(...inline(next))], [p(...inline(next))]);
    }

    if (roll < 0.4) {
      return { type: 'blockquote', content: [p(...inline(next))] };
    }

    return p(...inline(next));
  };

  it('holds for generated documents', () => {
    const failures: string[] = [];
    const next = random(20260101);

    for (let n = 0; n < 4000; n++) {
      const value = doc(
        ...Array.from({ length: 1 + Math.floor(next() * 3) }, () => block(next)).filter(
          (b) => JSON.stringify(b).includes('"text"') || JSON.stringify(b).includes('mention'),
        ),
      );

      if (markdownLosses(value).length > 0) {
        failures.push(`${JSON.stringify(richTextToMarkdown(value))}\n   from ${JSON.stringify(value)}`);
      }
    }

    expect(failures.slice(0, 5), `${failures.length} of 4000 documents changed`).toEqual([]);
  });
});
