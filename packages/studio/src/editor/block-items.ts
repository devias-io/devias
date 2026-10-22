import type { ChainedCommands } from '@tiptap/react';
import type { MenuEntry } from './suggestion-menu';

export interface BlockItem extends MenuEntry {
  keywords: string[];
  run: (chain: ChainedCommands) => ChainedCommands;
}

/** The block menu, text blocks first, then lists, then the rest. `run` receives a chain with the typed `/query` already removed. */
export const BLOCK_ITEMS: BlockItem[] = [
  {
    key: 'text',
    title: 'Text',
    hint: 'Just start writing',
    glyph: 'Aa',
    keywords: ['paragraph'],
    run: (c) => c.setParagraph(),
  },
  {
    key: 'h1',
    title: 'Heading 1',
    hint: 'Big section heading',
    glyph: 'H1',
    keywords: ['title', '#'],
    run: (c) => c.setHeading({ level: 1 }),
  },
  {
    key: 'h2',
    title: 'Heading 2',
    hint: 'Medium section heading',
    glyph: 'H2',
    keywords: ['subtitle', '##'],
    run: (c) => c.setHeading({ level: 2 }),
  },
  {
    key: 'h3',
    title: 'Heading 3',
    hint: 'Small section heading',
    glyph: 'H3',
    keywords: ['###'],
    run: (c) => c.setHeading({ level: 3 }),
  },
  {
    key: 'bullets',
    title: 'Bulleted list',
    hint: 'A simple list',
    icon: 'list',
    keywords: ['ul', 'unordered'],
    run: (c) => c.toggleBulletList(),
  },
  {
    key: 'numbers',
    title: 'Numbered list',
    hint: 'A list with numbers',
    glyph: '1.',
    keywords: ['ol', 'ordered'],
    run: (c) => c.toggleOrderedList(),
  },
  {
    key: 'todo',
    title: 'To-do list',
    hint: 'Track tasks with checkboxes',
    icon: 'check-square',
    keywords: ['task', 'checkbox', 'check'],
    run: (c) => c.toggleTaskList(),
  },
  {
    key: 'quote',
    title: 'Quote',
    hint: 'Capture a quote',
    glyph: '“',
    keywords: ['blockquote', 'citation'],
    run: (c) => c.toggleBlockquote(),
  },
  {
    key: 'code',
    title: 'Code',
    hint: 'A code snippet',
    icon: 'code',
    keywords: ['codeblock', 'snippet'],
    run: (c) => c.toggleCodeBlock(),
  },
  {
    key: 'divider',
    title: 'Divider',
    hint: 'Separate sections',
    icon: 'minus',
    keywords: ['hr', 'rule', 'separator'],
    run: (c) => c.setHorizontalRule(),
  },
  {
    key: 'table',
    title: 'Table',
    hint: 'Rows and columns',
    icon: 'table',
    keywords: ['grid', 'spreadsheet', 'rows', 'columns'],
    run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  },
  {
    key: 'mention',
    title: 'Mention a record',
    hint: 'Link a person, company or document',
    icon: 'at-sign',
    keywords: ['link', 'record', 'page'],
    run: (c) => c.insertContent('@'),
  },
];

export const matchBlockItems = (query: string): BlockItem[] => {
  const q = query.trim().toLowerCase();

  if (!q) {
    return BLOCK_ITEMS;
  }

  return BLOCK_ITEMS.filter(
    (item) => item.title.toLowerCase().includes(q) || item.keywords.some((keyword) => keyword.startsWith(q)),
  );
};
