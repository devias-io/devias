import { linkHref, linkOfMention, mentionAttrsOf, parseLink } from './links';
import { EMPTY_DOC, MENTION_NODE, type RichTextDoc, type RichTextNode, toRichTextDoc } from './rich-text';

/**
 * Markdown in and out of a `rich_text` value. The agent, the API and workflows write rich text as Markdown, since
 * that is what a model writes well; the engine stores the editor's document. A record is mentioned with a link whose
 * target is `record:<object>/<id>`, a workflow with `workflow:<id>` and a document with `document:<id>` (see
 * `links.ts`), which is how the agent already refers to them.
 *
 * It covers what the editor can make: headings, paragraphs, bullet, numbered and to-do lists (nested by indent),
 * quotes, code blocks, rules, pipe tables, and bold, italic, underline (as `<u>…</u>`, the one thing Markdown has no
 * syntax for), strike, inline code, links and mentions.
 *
 * Writing is built to read back as the same document: text that looks like syntax is escaped, and a paragraph that
 * would not survive is written with every delimiter escaped instead. What it still cannot keep (merged table cells,
 * a line break that starts or ends a block, code that holds the delimiters of the emphasis around it) is what
 * `markdownLosses` reports, so a caller that rewrites a value can say so. The fidelity test fuzzes this.
 */

type Mark = { type: string; attrs?: Record<string, unknown> };

// ---------------------------------------------------------------------------------------------
// Markdown → document
// ---------------------------------------------------------------------------------------------

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const TABLE_ROW = /^\s{0,3}\|?.*\|.*$/;
const TABLE_RULE = /^\s{0,3}\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => line.trim() === '';

const text = (value: string, marks: Mark[]): RichTextNode => ({
  type: 'text',
  text: value,
  ...(marks.length > 0 ? { marks } : {}),
});

/**
 * Punctuation a backslash can escape, so it reads as itself instead of as syntax (the body of a character class).
 * `<` is there for `<u>`, which is how underline is written.
 */
const ESCAPABLE = '\\\\`*_{}\\[\\]()#+\\-.!~>|<';

/**
 * The inline syntax, one alternative each. A backslash escape comes first, so an escaped delimiter is consumed before
 * it can open anything. A link destination is `<…>` (it may hold spaces and parentheses) or runs to the first space,
 * with one level of balanced parentheses allowed (`https://example.com/a_(b)`).
 */
/** A character, or a backslash and the character it escapes taken as one, so an escaped delimiter never closes anything. */
const UNIT = '(?:\\\\[\\s\\S]|[^\\\\])';
/** Like a unit, but not a space or the delimiter itself: what may start or end italic text. */
const EDGE = (delimiter: string) => `(?:\\\\[\\s\\S]|[^\\s${delimiter}\\\\])`;

const INLINE = new RegExp(
  [
    `(?<esc>\\\\[${ESCAPABLE}])`,
    '(?<code>`+)(?<codeText>.+?)\\k<code>',
    '\\[(?<label>(?:\\\\.|[^\\]\\\\])*)\\]\\((?:<(?<hrefA>[^>\\n]*)>|(?<href>(?:[^()\\s]|\\([^()\\s]*\\))+))(?:\\s+"[^"]*")?\\)',
    `\\*\\*\\*(?<boldItal>${UNIT}+?)\\*\\*\\*`,
    `\\*\\*(?<bold>${UNIT}+?)\\*\\*`,
    `__(?<boldU>${UNIT}+?)__`,
    `~~(?<strike>${UNIT}+?)~~`,
    `<u>(?<under>${UNIT}+?)</u>`,
    `\\*(?<ital>${EDGE('*')}(?:${UNIT}*?${EDGE('*')})??)\\*(?!\\*)`,
    `(?<![_\\w])_(?<italU>${EDGE('_')}(?:${UNIT}*?${EDGE('_')})??)_(?![_\\w])`,
  ].join('|'),
  'g',
);

const unescapeMarkdown = (value: string): string => value.replace(new RegExp(`\\\\([${ESCAPABLE}])`, 'g'), '$1');

/** Adjacent text with the same marks is one node: escapes and plain runs split it while reading. */
const mergeText = (nodes: RichTextNode[]): RichTextNode[] => {
  const out: RichTextNode[] = [];

  for (const node of nodes) {
    const previous = out[out.length - 1];

    if (
      previous?.type === 'text' &&
      node.type === 'text' &&
      JSON.stringify(previous.marks ?? []) === JSON.stringify(node.marks ?? [])
    ) {
      out[out.length - 1] = { ...previous, text: `${previous.text ?? ''}${node.text ?? ''}` };
    } else {
      out.push(node);
    }
  }

  return out;
};

const parseInline = (source: string, marks: Mark[] = []): RichTextNode[] => {
  const out: RichTextNode[] = [];
  const plain = (value: string) => {
    if (value) {
      out.push(text(value, marks));
    }
  };
  let last = 0;

  for (const match of source.matchAll(INLINE)) {
    plain(source.slice(last, match.index));
    last = (match.index ?? 0) + match[0].length;
    const g = match.groups ?? {};

    if (g.esc !== undefined) {
      plain(g.esc.slice(1));
    } else if (g.codeText !== undefined) {
      out.push(text(g.codeText.trim(), [...marks.filter((mark) => mark.type !== 'code'), { type: 'code' }]));
    } else if (g.href !== undefined || g.hrefA !== undefined) {
      const href = g.hrefA ?? g.href ?? '';
      const target = parseLink(href);

      if (target) {
        out.push({ type: MENTION_NODE, attrs: mentionAttrsOf(target, unescapeMarkdown(g.label ?? '') || target.id) });
      } else {
        out.push(...parseInline(g.label ?? '', [...marks, { type: 'link', attrs: { href } }]));
      }
    } else if (g.boldItal !== undefined) {
      out.push(...parseInline(g.boldItal, [...marks, { type: 'bold' }, { type: 'italic' }]));
    } else if (g.bold !== undefined || g.boldU !== undefined) {
      out.push(...parseInline(g.bold ?? g.boldU ?? '', [...marks, { type: 'bold' }]));
    } else if (g.strike !== undefined) {
      out.push(...parseInline(g.strike, [...marks, { type: 'strike' }]));
    } else if (g.under !== undefined) {
      out.push(...parseInline(g.under, [...marks, { type: 'underline' }]));
    } else {
      out.push(...parseInline(g.ital ?? g.italU ?? '', [...marks, { type: 'italic' }]));
    }
  }

  plain(source.slice(last));

  return mergeText(out);
};

const paragraph = (source: string): RichTextNode => {
  const content = parseInline(source);

  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
};

/** Lines of one paragraph keep their breaks, the way they were written. */
const rowsParagraph = (rows: string[]): RichTextNode => {
  const content = rows.flatMap((row, n) =>
    n === 0 ? parseInline(row.trim()) : [{ type: 'hardBreak' }, ...parseInline(row.trim())],
  );

  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
};

const startsBlock = (line: string): boolean =>
  FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line);

/** A table starts at a row of cells followed by its `---` rule row, which needs a pipe to tell it from a list or rule. */
const isTableStart = (lines: string[], i: number): boolean =>
  TABLE_ROW.test(lines[i] ?? '') && TABLE_RULE.test(lines[i + 1] ?? '') && (lines[i + 1] ?? '').includes('|');

/** The cells of a table row: split on pipes that are not escaped, without the edge pipes, trimmed. */
const cellsOf = (line: string): string[] => {
  const body = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');

  return body.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
};

const tableCell = (type: 'tableHeader' | 'tableCell', source: string): RichTextNode => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: [paragraph(source)],
});

const parseTable = (lines: string[], start: number): { node: RichTextNode; next: number } => {
  const header = cellsOf(lines[start] ?? '');
  const rows: RichTextNode[] = [{ type: 'tableRow', content: header.map((cell) => tableCell('tableHeader', cell)) }];
  let i = start + 2;

  // Rows go on until a blank line or another block; a row may leave out its pipes.
  while (i < lines.length && !isBlank(lines[i] ?? '') && !startsBlock(lines[i] ?? '')) {
    // Every row has as many cells as the header: short rows are filled in, long ones cut.
    const cells = cellsOf(lines[i] ?? '');
    rows.push({
      type: 'tableRow',
      content: header.map((_, n) => tableCell('tableCell', cells[n] ?? '')),
    });
    i++;
  }

  return { node: { type: 'table', content: rows }, next: i };
};

const dedent = (lines: string[], by: number): string[] => lines.map((line) => line.slice(Math.min(by, indentOf(line))));

const kindOf = (marker: string): 'bullet' | 'ordered' => (/^\d/.test(marker) ? 'ordered' : 'bullet');

const parseList = (lines: string[], start: number): { node: RichTextNode; next: number } => {
  const first = ITEM.exec(lines[start] ?? '') as RegExpExecArray;
  const base = indentOf(lines[start] ?? '');
  const kind = kindOf(first[2] ?? '-');
  const firstIsTask = kind === 'bullet' && TASK.test(first[3] ?? '');
  const items: RichTextNode[] = [];
  let i = start;

  while (i < lines.length) {
    const match = ITEM.exec(lines[i] ?? '');

    if (!match || indentOf(lines[i] ?? '') !== base || kindOf(match[2] ?? '-') !== kind) {
      break;
    }

    const task = kind === 'bullet' ? TASK.exec(match[3] ?? '') : null;

    if (Boolean(task) !== firstIsTask) {
      break;
    }

    const head = task ? (task[2] ?? '') : (match[3] ?? '');
    const nested: string[] = [];
    let j = i + 1;

    while (j < lines.length && !isBlank(lines[j] ?? '') && indentOf(lines[j] ?? '') > base) {
      nested.push(lines[j] ?? '');
      j++;
    }

    const childIndent = nested.length > 0 ? Math.min(...nested.map(indentOf)) : 0;
    const inner = dedent(nested, childIndent);
    // Indented lines that do not start a block go on with the item's first paragraph, with a break between.
    let k = 0;

    while (k < inner.length && !startsBlock(inner[k] ?? '') && !isTableStart(inner, k)) {
      k++;
    }

    const content = [
      k > 0 ? rowsParagraph([head, ...inner.slice(0, k)]) : paragraph(head),
      ...parseBlocks(inner.slice(k)),
    ];
    items.push(
      firstIsTask
        ? { type: 'taskItem', attrs: { checked: task?.[1] !== ' ' }, content }
        : { type: 'listItem', content },
    );
    i = j;
  }

  const node: RichTextNode = firstIsTask
    ? { type: 'taskList', content: items }
    : kind === 'ordered'
      ? { type: 'orderedList', attrs: { start: Number.parseInt(first[2] ?? '1', 10) || 1 }, content: items }
      : { type: 'bulletList', content: items };

  return { node, next: i };
};

const parseBlocks = (lines: string[]): RichTextNode[] => {
  const blocks: RichTextNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (isBlank(line)) {
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      const { node, next } = parseTable(lines, i);
      blocks.push(node);
      i = next;
      continue;
    }

    const fence = FENCE.exec(line);

    if (fence) {
      const marker = fence[1] ?? '```';
      const body: string[] = [];
      i++;

      while (
        i < lines.length &&
        !new RegExp(`^\\s{0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`).test(lines[i] ?? '')
      ) {
        body.push(lines[i] ?? '');
        i++;
      }

      i++;
      const code = body.join('\n');
      blocks.push({
        type: 'codeBlock',
        attrs: { language: fence[2] || null },
        ...(code ? { content: [{ type: 'text', text: code }] } : {}),
      });
      continue;
    }

    const heading = HEADING.exec(line);

    if (heading) {
      blocks.push({
        type: 'heading',
        attrs: { level: (heading[1] ?? '#').length },
        content: parseInline(heading[2] ?? ''),
      });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];

      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        quoted.push(QUOTE.exec(lines[i] ?? '')?.[1] ?? '');
        i++;
      }

      const content = parseBlocks(quoted);
      blocks.push({ type: 'blockquote', content: content.length > 0 ? content : [{ type: 'paragraph' }] });
      continue;
    }

    if (ITEM.test(line)) {
      const { node, next } = parseList(lines, i);
      blocks.push(node);
      i = next;
      continue;
    }

    const rows: string[] = [];

    while (
      i < lines.length &&
      !isBlank(lines[i] ?? '') &&
      (rows.length === 0 || !(startsBlock(lines[i] ?? '') || isTableStart(lines, i)))
    ) {
      rows.push((lines[i] ?? '').trim());
      i++;
    }

    blocks.push(rowsParagraph(rows));
  }

  return blocks;
};

/** Markdown as an editor document. Empty text is the empty document. */
export const markdownToRichText = (markdown: string): RichTextDoc => {
  const blocks = parseBlocks(markdown.replace(/\r\n?/g, '\n').split('\n'));

  return blocks.length > 0 ? { type: 'doc', content: blocks } : EMPTY_DOC;
};

// ---------------------------------------------------------------------------------------------
// Document → Markdown
// ---------------------------------------------------------------------------------------------

/** What to escape in a construct the reader would find in text, by the kind of match (see `escapeText`). */
const DELIMITERS: Record<string, string> = {
  codeText: '`',
  href: '[',
  hrefA: '[',
  boldItal: '*',
  bold: '*',
  boldU: '_',
  strike: '~',
  under: '<',
  ital: '*',
  italU: '_',
};

/** Put a backslash before each of `chars` in `value`, leaving what is already escaped alone. */
const escapeChars = (value: string, chars: string): string =>
  value.replace(new RegExp(`\\\\[\\s\\S]|[${chars.replace(/[\\\]^-]/g, '\\$&')}]`, 'g'), (token) =>
    token.length === 2 && token.startsWith('\\') ? token : `\\${token}`,
  );

/** Everything that could open inline syntax: for text the careful pass could not make safe. */
const escapeAll = (value: string): string => value.replace(/[\\`*_~[<]/g, '\\$&');

/**
 * Text written so that it reads back as the same text. A backslash that would escape something is doubled; then every
 * construct the reader would find in what is left is switched off by escaping its delimiters, until there is none.
 * Text that does not look like syntax (`snake_case`, `2 * 3`) is left as it is.
 */
const escapeText = (value: string): string => {
  let current = value.replace(new RegExp(`\\\\(?=[${ESCAPABLE}]|$)`, 'g'), '\\\\');

  for (let pass = 0; pass < 8; pass++) {
    let out = '';
    let last = 0;
    let changed = false;

    for (const match of current.matchAll(INLINE)) {
      const g = match.groups ?? {};
      const start = match.index ?? 0;
      out += current.slice(last, start);
      last = start + match[0].length;
      const kind = g.esc === undefined ? Object.keys(DELIMITERS).find((key) => g[key] !== undefined) : undefined;

      if (kind) {
        out += escapeChars(match[0], DELIMITERS[kind] ?? '');
        changed = true;
      } else {
        out += match[0];
      }
    }

    out += current.slice(last);

    if (!changed) {
      return out;
    }

    current = out;
  }

  return escapeAll(value);
};

type Mode = 'smart' | 'all';

/** Marks are written inside out: code first, then the others, the link around them all. */
const MARK_ORDER = ['code', 'underline', 'strike', 'bold', 'italic', 'link'];
const markRank = (mark: Mark): number => {
  const rank = MARK_ORDER.indexOf(mark.type);

  return rank < 0 ? MARK_ORDER.length : rank;
};

/** A code span: its fence is one backtick longer than any run inside, padded when the text starts or ends with one. */
const codeSpan = (value: string): string => {
  const longest = Math.max(0, ...[...value.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = value.startsWith('`') || value.endsWith('`') ? ' ' : '';

  return `${fence}${pad}${value}${pad}${fence}`;
};

/** A link destination: as it is when it can be, in angle brackets when it has spaces or parentheses. */
const destination = (href: string): string => {
  const safe = href.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\n/g, '%0A');

  return /[\s()]/.test(safe) ? `<${safe}>` : safe;
};

const wrap = (value: string, mark: Mark, italic = '*'): string => {
  switch (mark.type) {
    case 'bold':
      return `**${value}**`;
    case 'italic':
      return `${italic}${value}${italic}`;
    case 'strike':
      return `~~${value}~~`;
    case 'underline':
      return `<u>${value}</u>`;
    case 'code':
      return codeSpan(value);
    case 'link':
      return `[${value}](${destination(String(mark.attrs?.href ?? ''))})`;
    default:
      return value;
  }
};

const EMPHASIS = new Set(['underline', 'strike', 'bold', 'italic']);

const textMarkdown = (node: RichTextNode, mode: Mode, italic = '*'): string => {
  const marks = [...(node.marks ?? [])].sort((a, b) => markRank(a) - markRank(b));
  const isCode = marks.some((mark) => mark.type === 'code');
  let value = node.text ?? '';
  let lead = '';
  let trail = '';

  // Emphasis cannot start or end on a space (`**word **` is not bold), so the spaces go outside the markers.
  if (!isCode && marks.some((mark) => EMPHASIS.has(mark.type))) {
    const edges = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
    lead = edges?.[1] ?? '';
    value = edges?.[2] ?? value;
    trail = edges?.[3] ?? '';
  }

  // Code is literal; everything else is escaped, and inside a link the brackets too.
  if (!isCode) {
    value = mode === 'all' ? escapeAll(value) : escapeText(value);

    if (marks.some((mark) => mark.type === 'link')) {
      value = escapeChars(value, '[]');
    }
  }

  for (const mark of marks) {
    if (mark.type !== 'link' && value !== '') {
      value = wrap(value, mark, italic);
    }
  }

  return marks.filter((mark) => mark.type === 'link').reduce((out, mark) => wrap(out, mark), `${lead}${value}${trail}`);
};

/** A mention as the link the agent reads: `[Label](record:<object>/<id>)`. */
const mentionMarkdown = (node: RichTextNode): string => {
  const { object, id, label } = node.attrs ?? {};

  return object && id
    ? `[${String(label ?? id)
        .replace(/\n/g, ' ')
        .replace(/[\\[\]]/g, '\\$&')}](${linkHref(linkOfMention(String(object), String(id)))})`
    : `@${String(label ?? '')}`;
};

const inlineMarkdown = (nodes: RichTextNode[] | undefined, mode: Mode = 'smart'): string => {
  const merged = mergeText(nodes ?? []);
  const piece = (node: RichTextNode, italic = '*'): string => {
    if (node.type === 'hardBreak') {
      return '\n';
    }

    if (node.type === MENTION_NODE) {
      return mentionMarkdown(node);
    }

    return textMarkdown(node, mode, italic);
  };
  const pieces = merged.map((node) => piece(node));

  // Italic next to bold would be `**a***b*`, which cannot be told from other runs of stars: it is written with
  // underscores there, which have no such trouble.
  merged.forEach((node, n) => {
    const before = pieces[n - 1] ?? '';
    const after = pieces[n + 1] ?? '';

    // Underscores cannot open or close next to a letter or digit, so there the stars stay.
    if (
      node.type === 'text' &&
      node.marks?.some((mark) => mark.type === 'italic') &&
      (before.endsWith('*') || after.startsWith('*')) &&
      !/\w$/.test(before) &&
      !/^\w/.test(after)
    ) {
      pieces[n] = piece(node, '_');
    }
  });

  return pieces.join('');
};

// ---------------------------------------------------------------------------------------------
// Checking what was written: the writer reads its own output back and falls back to escaping everything
// ---------------------------------------------------------------------------------------------

const marksKey = (marks: Mark[] | undefined): string =>
  (marks ?? [])
    .map((mark) => (mark.type === 'link' ? `link:${String(mark.attrs?.href ?? '')}` : mark.type))
    .sort()
    .join(',');

/** Inline content as a string that two equivalent runs of nodes share: the same text and marks, spacing at the edges aside. */
const canonicalInline = (nodes: RichTextNode[] | undefined): string => {
  type Item = { kind: 'text'; marks: string; text: string } | { kind: 'break' } | { kind: 'mention'; value: string };
  const items: Item[] = [];

  for (const node of mergeText(nodes ?? [])) {
    if (node.type === 'hardBreak') {
      items.push({ kind: 'break' });
    } else if (node.type === MENTION_NODE) {
      const { object, id, label } = node.attrs ?? {};
      items.push({ kind: 'mention', value: JSON.stringify([object, id, label || id]) });
    } else {
      const marks = marksKey(node.marks);
      const plain = marksKey((node.marks ?? []).filter((mark) => !EMPHASIS.has(mark.type)));
      const raw = node.text ?? '';
      const edges = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
      // Spaces at the edges of emphasised text are written outside its markers, so they are not emphasised.
      const pieces: [string, string][] = marks.split(',').includes('code')
        ? [[marks, raw.trim()]]
        : marks === plain
          ? [[marks, raw]]
          : [
              [plain, edges?.[1] ?? ''],
              [(edges?.[2] ?? '') === '' ? plain : marks, edges?.[2] ?? ''],
              [plain, edges?.[3] ?? ''],
            ];

      for (const [key, value] of pieces.filter(([, text]) => text !== '')) {
        const previous = items[items.length - 1];

        if (previous?.kind === 'text' && previous.marks === key) {
          previous.text += value;
        } else {
          items.push({ kind: 'text', marks: key, text: value });
        }
      }
    }
  }

  // Spaces next to a break and at the ends are not kept when written; trimming can empty a run, so go on until stable.
  let kept = items;

  for (let again = true; again; ) {
    kept.forEach((item, n) => {
      if (item.kind !== 'text') {
        return;
      }

      if (n === 0 || kept[n - 1]?.kind === 'break') {
        item.text = item.text.trimStart();
      }

      if (n === kept.length - 1 || kept[n + 1]?.kind === 'break') {
        item.text = item.text.trimEnd();
      }
    });
    const next = kept.filter((item) => item.kind !== 'text' || item.text !== '');
    again = next.length !== kept.length;
    kept = next;
  }

  return JSON.stringify(kept);
};

/** Whether Markdown reads back as one block of this type with this inline content. */
const readsBack = (markdown: string, type: string, nodes: RichTextNode[] | undefined, level?: number): boolean => {
  const blocks = parseBlocks(markdown.split('\n'));
  const [block] = blocks;

  return (
    blocks.length === 1 &&
    block?.type === type &&
    (level === undefined || block.attrs?.level === level) &&
    canonicalInline(block.content) === canonicalInline(nodes)
  );
};

/** A line written with its first character escaped, so it is not read as the start of a block. */
const escapeBlockStart = (line: string): string => {
  const indent = line.length - line.trimStart().length;
  const body = line.slice(indent);
  // A list number is escaped at its dot: a digit is not something a backslash can escape.
  const number = /^(\d{1,9})([.)])/.exec(body)?.[1];

  return number
    ? `${line.slice(0, indent)}${number}\\${body.slice(number.length)}`
    : `${line.slice(0, indent)}\\${body}`;
};

/** A line that would start another block when read, written with its first character escaped instead. */
const escapeLineStarts = (markdown: string): string =>
  markdown
    .split('\n')
    .map((line) => (startsBlock(line) || (TABLE_RULE.test(line) && line.includes('|')) ? escapeBlockStart(line) : line))
    .join('\n');

const paragraphMarkdown = (nodes: RichTextNode[] | undefined): string => {
  if (!nodes || nodes.length === 0) {
    return '';
  }

  const build = (mode: Mode) => escapeLineStarts(inlineMarkdown(nodes, mode));
  const smart = build('smart');

  return readsBack(smart, 'paragraph', nodes) ? smart : build('all');
};

const headingMarkdown = (node: RichTextNode): string => {
  const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
  // A heading is one line, and a closing run of `#` would be read as its closing marker.
  const build = (mode: Mode) =>
    `${'#'.repeat(level)} ${inlineMarkdown(node.content, mode)
      .replace(/\n/g, ' ')
      .replace(/#+\s*$/, (run) => `\\${run}`)}`;
  const smart = build('smart');

  return readsBack(smart, 'heading', node.content, level) ? smart : build('all');
};

const indentBy = (value: string, spaces: number): string =>
  value
    .split('\n')
    .map((line) => (line ? ' '.repeat(spaces) + line : line))
    .join('\n');

const listMarkdown = (node: RichTextNode): string =>
  (node.content ?? [])
    .map((item, n) => {
      const marker =
        node.type === 'orderedList'
          ? `${Number(node.attrs?.start ?? 1) + n}. `
          : node.type === 'taskList'
            ? `- [${item.attrs?.checked ? 'x' : ' '}] `
            : '- ';
      const [first, ...rest] = (item.content ?? []).map(blockMarkdown).filter((part) => part !== '');
      // `- --` is a rule, and `- |` the rule line of a table, though `--` and `|` alone are text: the marker can turn
      // the head into one.
      const line = `${marker}${first?.split('\n')[0] ?? ''}`;
      const head =
        first !== undefined && (RULE.test(line) || (TABLE_RULE.test(line) && line.includes('|')))
          ? escapeBlockStart(first)
          : first;
      // The lines after a break in the first paragraph are indented under the marker, so they stay in the item.
      const [firstLine = '', ...more] = (head ?? '').split('\n');
      const body = [
        [firstLine, ...more.map((line) => ' '.repeat(marker.length) + line)].join('\n'),
        ...rest.map((part) => indentBy(part, marker.length)),
      ].join('\n');

      return marker + body;
    })
    .join('\n');

/** One cell on one line: its blocks side by side, pipes escaped, line breaks as spaces. */
const cellMarkdown = (cell: RichTextNode): string =>
  (cell.content ?? [])
    .map(blockMarkdown)
    .filter((part) => part !== '')
    .join(' ')
    .replace(/\n/g, ' ')
    .replace(/\|/g, '\\|');

/** The first row is the header, as Markdown needs one. */
const tableMarkdown = (node: RichTextNode): string => {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map(cellMarkdown));
  const [head, ...body] = rows;

  if (!head) {
    return '';
  }

  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;

  return [
    line(head),
    line(head.map(() => '---')),
    ...body.map((cells) => line(head.map((_, n) => cells[n] ?? ''))),
  ].join('\n');
};

function blockMarkdown(node: RichTextNode): string {
  switch (node.type) {
    case 'table':
      return tableMarkdown(node);
    case 'paragraph':
      return paragraphMarkdown(node.content);
    case 'heading':
      return headingMarkdown(node);
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return listMarkdown(node);
    case 'blockquote':
      return (node.content ?? [])
        .map(blockMarkdown)
        .filter((part) => part !== '')
        .join('\n\n')
        .split('\n')
        .map((line) => `> ${line}`.trimEnd())
        .join('\n');
    case 'codeBlock': {
      const code = (node.content ?? []).map((child) => child.text ?? '').join('');
      // The fence is longer than any run of backticks inside, so the code cannot close it early.
      const fence = '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((run) => run[0].length + 1)));

      return `${fence}${String(node.attrs?.language ?? '')}\n${code}\n${fence}`;
    }
    case 'horizontalRule':
      return '---';
    default:
      return paragraphMarkdown(node.content);
  }
}

// ---------------------------------------------------------------------------------------------
// What Markdown cannot keep
// ---------------------------------------------------------------------------------------------

/** What the converter handles; the editor's schema must stay inside these (a test checks it). */
export const MARKDOWN_NODES: readonly string[] = [
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  MENTION_NODE,
];
export const MARKDOWN_MARKS: readonly string[] = ['bold', 'italic', 'strike', 'underline', 'code', 'link'];

/** Blocks as something two equivalent documents share: spacing and default attributes are left out. */
const canonicalBlocks = (nodes: RichTextNode[] | undefined): unknown[] =>
  (nodes ?? [])
    .filter((node) => !(node.type === 'paragraph' && canonicalInline(node.content) === '[]'))
    .map((node): unknown => {
      switch (node.type) {
        case 'paragraph':
          return ['p', canonicalInline(node.content)];
        case 'heading':
          return ['h', Number(node.attrs?.level ?? 1), canonicalInline(node.content)];
        case 'bulletList':
        case 'orderedList':
        case 'taskList':
          return [
            node.type,
            node.type === 'orderedList' ? Number(node.attrs?.start ?? 1) : 0,
            (node.content ?? []).map((item) => [item.attrs?.checked === true, canonicalBlocks(item.content)]),
          ];
        case 'blockquote':
          return ['q', canonicalBlocks(node.content)];
        case 'codeBlock':
          return [
            'code',
            String(node.attrs?.language ?? ''),
            (node.content ?? []).map((child) => child.text ?? '').join(''),
          ];
        case 'horizontalRule':
          return ['hr'];
        case 'table':
          return [
            'table',
            (node.content ?? []).map((row) =>
              (row.content ?? []).map((cell) => [
                cell.type,
                Number(cell.attrs?.colspan ?? 1),
                Number(cell.attrs?.rowspan ?? 1),
                canonicalBlocks(cell.content),
              ]),
            ),
          ];
        default:
          return [node.type, canonicalInline(node.content)];
      }
    });

const typesIn = (node: RichTextNode, nodes: Set<string>, marks: Set<string>): void => {
  nodes.add(node.type);

  for (const mark of node.marks ?? []) {
    marks.add(mark.type);
  }

  for (const child of node.content ?? []) {
    typesIn(child, nodes, marks);
  }
};

/**
 * What a whole-text rewrite through Markdown would change in a document, beyond spacing: an empty list when it would
 * change nothing. Meant for a writer that reads the text as Markdown and sends it back (the agent), to warn it.
 */
export const markdownLosses = (value: unknown): string[] => {
  const doc = toRichTextDoc(value);
  const back = markdownToRichText(richTextToMarkdown(doc));

  if (JSON.stringify(canonicalBlocks(doc.content)) === JSON.stringify(canonicalBlocks(back.content))) {
    return [];
  }

  const nodes = new Set<string>();
  const marks = new Set<string>();
  typesIn(doc, nodes, marks);
  const losses: string[] = [];
  const tables = [...(doc.content ?? [])].flatMap(function find(node): RichTextNode[] {
    return node.type === 'table' ? [node] : (node.content ?? []).flatMap(find);
  });

  if (
    tables.some((table) =>
      table.content?.some((row) =>
        row.content?.some((cell) => Number(cell.attrs?.colspan ?? 1) > 1 || Number(cell.attrs?.rowspan ?? 1) > 1),
      ),
    )
  ) {
    losses.push('merged table cells');
  }

  if (tables.some((table) => table.content?.[0]?.content?.some((cell) => cell.type !== 'tableHeader'))) {
    losses.push('a table without a header row');
  }

  for (const type of [...nodes].filter((one) => !MARKDOWN_NODES.includes(one))) {
    losses.push(`${type} blocks`);
  }

  for (const type of [...marks].filter((one) => !MARKDOWN_MARKS.includes(one))) {
    losses.push(`${type} formatting`);
  }

  return losses.length > 0 ? losses : ['formatting that Markdown cannot express'];
};

/**
 * A message typed in a plain box: the text exactly as typed (what looks like Markdown stays as it is, nothing is
 * escaped), its line breaks and paragraphs, and mentions as links.
 */
export const richTextToMessage = (value: unknown): string =>
  (toRichTextDoc(value).content ?? [])
    .map((block) =>
      (block.content ?? [])
        .map((node) =>
          node.type === 'hardBreak' ? '\n' : node.type === MENTION_NODE ? mentionMarkdown(node) : (node.text ?? ''),
        )
        .join(''),
    )
    .join('\n\n');

/** A stored value as Markdown (what the agent reads); a plain string passes through. */
export const richTextToMarkdown = (value: unknown): string =>
  (toRichTextDoc(value).content ?? [])
    .map(blockMarkdown)
    .filter((part) => part !== '')
    .join('\n\n');

const BLOCK_SYNTAX = /^\s{0,3}(#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>\s?|`{3,}|~{3,}|[-*_]{3,}\s*$)/m;
const INLINE_SYNTAX = /\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)/;

const TABLE_SYNTAX = /\|[^\n]*\n\s*\|?\s*:?-{2,}:?\s*\|/;

/**
 * Whether pasted plain text is Markdown worth converting: a heading, list, quote, code fence or rule at the start of a
 * line, or bold, strike, code or a link inside one. Ordinary text stays as it is.
 */
export const looksLikeMarkdown = (value: string): boolean =>
  BLOCK_SYNTAX.test(value) || INLINE_SYNTAX.test(value) || TABLE_SYNTAX.test(value);
