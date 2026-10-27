import type { FilterCondition } from './query/ir';

/** Tiptap (ProseMirror) JSON, as stored in a `rich_text` field. */
export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export type RichTextDoc = RichTextNode & { type: 'doc' };

export const EMPTY_DOC: RichTextDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Node type of an @mention; its attrs carry the record's object (singular name), id and label. */
export const MENTION_NODE = 'mention';

export interface RecordMention {
  object: string;
  id: string;
  label: string;
}

export const isRichTextDoc = (value: unknown): value is RichTextDoc =>
  typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'doc';

/** A stored value as a document. Plain strings (e.g. written through the API) become one paragraph per line. */
export const toRichTextDoc = (value: unknown): RichTextDoc => {
  if (isRichTextDoc(value)) {
    return value;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return EMPTY_DOC;
  }

  return {
    type: 'doc',
    content: value
      .split('\n')
      .map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
  };
};

const INLINE = new Set(['text', MENTION_NODE, 'hardBreak']);

const textOf = (node: RichTextNode): string => {
  if (node.type === 'text') {
    return node.text ?? '';
  }

  if (node.type === MENTION_NODE) {
    return `@${String(node.attrs?.label ?? '')}`;
  }

  if (node.type === 'hardBreak') {
    return '\n';
  }

  const children = node.content ?? [];
  // Text blocks join their inline children; containers put each block on its own line.
  const inline = children.some((child) => INLINE.has(child.type));

  return children.map(textOf).join(inline ? '' : '\n');
};

/** The document as plain text (mentions as `@label`), one line per block. */
export const plainText = (value: unknown): string =>
  textOf(toRichTextDoc(value))
    .replace(/\n{2,}/g, '\n')
    .trim();

/** Every record mentioned in the document, once each, in order of appearance. */
export const mentionsOf = (value: unknown): RecordMention[] => {
  if (!isRichTextDoc(value)) {
    return [];
  }

  const seen = new Map<string, RecordMention>();
  const visit = (node: RichTextNode) => {
    const { object, id, label } = node.attrs ?? {};

    if (node.type === MENTION_NODE && typeof object === 'string' && typeof id === 'string') {
      const key = `${object}:${id}`;

      if (!seen.has(key)) {
        seen.set(key, { object, id, label: typeof label === 'string' ? label : id });
      }
    }

    for (const child of node.content ?? []) {
      visit(child);
    }
  };
  visit(value);

  return [...seen.values()];
};

/**
 * Matches records whose rich-text `field` mentions the record. Mentions store the record id as a JSON string, and the
 * engine searches rich-text values as JSON text, so the quoted id is the needle.
 */
export const mentionsRecordFilter = (recordId: string, field = 'body'): FilterCondition => ({
  field,
  op: 'contains',
  value: `"${recordId}"`,
});

/** The size of a rich text as JSON text, in characters, and how deep it may nest. */
export const RICH_TEXT_MAX_LENGTH = 1_000_000;
export const RICH_TEXT_MAX_DEPTH = 64;

/** Links a rich text may carry: the web, mail, phone, and the studio's own links. Anything else loses its link. */
const SAFE_HREF = /^(https?:|mailto:|tel:|record:|workflow:|document:|task:|member:|agent:|\/|#)/i;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Why `node` and what it holds are not a document's nodes (checked down to the depth limit), or null. */
const nodeProblem = (node: unknown, depth: number): string | null => {
  if (depth > RICH_TEXT_MAX_DEPTH) {
    return `The text is nested too deeply (at most ${RICH_TEXT_MAX_DEPTH} levels)`;
  }

  if (!isObject(node) || typeof node.type !== 'string') {
    return 'The text holds a node that is not an object with a type';
  }

  if (node.text !== undefined && typeof node.text !== 'string') {
    return 'The text of a node must be a string';
  }

  if (node.attrs !== undefined && node.attrs !== null && !isObject(node.attrs)) {
    return 'The attrs of a node must be an object';
  }

  if (
    node.marks !== undefined &&
    (!Array.isArray(node.marks) ||
      node.marks.some(
        (mark) => !isObject(mark) || typeof mark.type !== 'string' || (mark.attrs != null && !isObject(mark.attrs)),
      ))
  ) {
    return 'The marks of a node must be a list of objects with a type';
  }

  if (node.content === undefined) {
    return null;
  }

  if (!Array.isArray(node.content)) {
    return 'The content of a node must be a list of nodes';
  }

  for (const child of node.content) {
    const problem = nodeProblem(child, depth + 1);

    if (problem) {
      return problem;
    }
  }

  return null;
};

/** Why `value` cannot be stored as rich text, or null when it can. */
export const richTextProblem = (value: unknown): string | null => {
  if (!isRichTextDoc(value)) {
    return 'The text must be an editor document: an object of type "doc"';
  }

  const problem = nodeProblem(value, 1);

  if (problem) {
    return problem;
  }

  if (JSON.stringify(value).length > RICH_TEXT_MAX_LENGTH) {
    return `The text is too large (at most ${RICH_TEXT_MAX_LENGTH} characters as JSON)`;
  }

  return null;
};

const cleanNode = (node: RichTextNode): RichTextNode => {
  const marks = node.marks?.filter(
    (mark) => mark.type !== 'link' || (typeof mark.attrs?.href === 'string' && SAFE_HREF.test(mark.attrs.href)),
  );
  const content = node.content?.map(cleanNode);

  return {
    ...node,
    ...(marks ? { marks } : {}),
    ...(content ? { content } : {}),
  };
};

/** The document without the links it may not carry (the text stays). Check it with `richTextProblem` first. */
export const cleanRichText = (doc: RichTextDoc): RichTextDoc => cleanNode(doc) as RichTextDoc;
