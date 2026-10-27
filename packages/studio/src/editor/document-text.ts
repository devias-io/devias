import { ANCHOR_CONTEXT_LENGTH, anchorOf, findAnchor, MENTION_NODE, type TextAnchor } from '@devias/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** The editor's document as the text comments are anchored to, with the editor position of each character. */
export interface DocumentText {
  /** Plain text with whitespace collapsed, as the engine reads a document (`collapseText(plainText(body))`). */
  text: string;
  /** The editor range of the text between two indexes (the end exclusive), or null when the range is empty. */
  rangeOf: (start: number, end: number) => { from: number; to: number } | null;
  /** The indexes of the text a selection covers (the end exclusive), without the spaces at its edges. */
  indexesOf: (from: number, to: number) => { start: number; end: number } | null;
}

/**
 * Reads a document as one line of text: mentions as `@label`, a break or the start of another block as a space,
 * runs of whitespace as one space, nothing at the edges. The engine reads the saved body the same way, so a quote
 * taken here is found there. Each character remembers the editor positions it came from; the space that stands for a
 * block boundary has none of its own.
 */
export const documentText = (doc: ProseMirrorNode): DocumentText => {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const push = (char: string, from: number, to: number) => {
    chars.push(char);
    starts.push(from);
    ends.push(to);
  };
  let first = true;

  doc.descendants((node, pos) => {
    if (node.isText) {
      const value = node.text ?? '';

      for (let i = 0; i < value.length; i += 1) {
        push(value.charAt(i), pos + i, pos + i + 1);
      }

      return false;
    }

    if (node.type.name === MENTION_NODE) {
      const label = `@${String(node.attrs.label ?? '')}`;

      for (let i = 0; i < label.length; i += 1) {
        push(label.charAt(i), pos, pos + node.nodeSize);
      }

      return false;
    }

    if (node.type.name === 'hardBreak') {
      push('\n', pos, pos + 1);

      return false;
    }

    if (node.isTextblock) {
      if (!first) {
        push('\n', pos, pos);
      }

      first = false;
    }

    return true;
  });

  const text: string[] = [];
  const from: number[] = [];
  const to: number[] = [];

  chars.forEach((char, i) => {
    const start = starts[i] as number;
    const end = ends[i] as number;

    if (!/\s/.test(char)) {
      text.push(char);
      from.push(start);
      to.push(end);

      return;
    }

    const last = text.length - 1;

    if (last < 0) {
      return;
    }

    if (text[last] === ' ') {
      to[last] = Math.max(to[last] as number, end);

      return;
    }

    text.push(' ');
    from.push(start);
    to.push(end);
  });

  if (text[text.length - 1] === ' ') {
    text.pop();
    from.pop();
    to.pop();
  }

  return {
    text: text.join(''),
    rangeOf: (start, end) => (end > start ? { from: from[start] as number, to: to[end - 1] as number } : null),
    indexesOf: (selectionFrom, selectionTo) => {
      let start = to.findIndex((at) => at > selectionFrom);

      if (start < 0) {
        return null;
      }

      let end = start;

      while (end < text.length && (from[end] as number) < selectionTo) {
        end += 1;
      }

      while (start < end && text[start] === ' ') {
        start += 1;
      }

      while (end > start && text[end - 1] === ' ') {
        end -= 1;
      }

      return end > start ? { start, end } : null;
    },
  };
};

/**
 * The anchor of what is selected: the text, the words around it and where it is. Null when nothing but spaces is
 * selected or the selection is longer than an anchor may be.
 */
export const anchorOfSelection = (
  doc: ProseMirrorNode,
  selectionFrom: number,
  selectionTo: number,
): TextAnchor | null => {
  const projected = documentText(doc);
  const covered = projected.indexesOf(selectionFrom, selectionTo);

  if (!covered) {
    return null;
  }

  const { text } = projected;

  return anchorOf(text, text.slice(covered.start, covered.end), {
    prefix: text.slice(Math.max(0, covered.start - ANCHOR_CONTEXT_LENGTH), covered.start),
    suffix: text.slice(covered.end, covered.end + ANCHOR_CONTEXT_LENGTH),
    hint: covered.start,
  });
};

/** Where in the editor an anchor is now, or null when its text is no longer in the document. */
export const placeAnchor = (projected: DocumentText, anchor: TextAnchor): { from: number; to: number } | null => {
  const found = findAnchor(projected.text, anchor);

  return found ? projected.rangeOf(found.start, found.end) : null;
};
