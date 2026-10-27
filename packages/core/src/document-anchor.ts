/**
 * Where in a document a comment is: the text it was made on. The anchor is held by the comment and found again in
 * the document's plain text each time the page is drawn, so a comment never writes to the document.
 *
 * Everything here works on text whose whitespace is collapsed (`collapseText`): the studio builds it from the
 * editor's document, the engine from `plainText(body)`, and the two agree wherever a line break, a paragraph or a
 * list item separates words.
 */

export const ANCHOR_QUOTE_MAX_LENGTH = 500;
/** How much text before and after the quote is kept to tell apart several occurrences of it. */
export const ANCHOR_CONTEXT_LENGTH = 40;

export interface TextAnchor {
  /** The selected text, whitespace collapsed. */
  quote: string;
  /** The text just before it. */
  prefix: string;
  /** The text just after it. */
  suffix: string;
  /** Where it started in the document's collapsed text when the comment was made: a hint, not a position. */
  hint: number;
}

/** Runs of whitespace become one space. The document's text keeps its edges; a quote is trimmed (`quoteOf`). */
export const collapseText = (text: string): string => text.replace(/\s+/g, ' ');

export const quoteOf = (text: string): string => collapseText(text).trim();

const commonSuffixLength = (a: string, b: string): number => {
  let n = 0;

  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) {
    n += 1;
  }

  return n;
};

const commonPrefixLength = (a: string, b: string): number => {
  let n = 0;

  while (n < a.length && n < b.length && a[n] === b[n]) {
    n += 1;
  }

  return n;
};

/** Every place `quote` occurs in `text`, overlaps included. */
const occurrences = (text: string, quote: string): number[] => {
  const found: number[] = [];

  for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) {
    found.push(at);
  }

  return found;
};

/**
 * Where the anchor's text is now: the occurrence whose surroundings match the kept context best, and among equals
 * the one nearest to where it was. Null when the text is no longer there.
 */
export const findAnchor = (text: string, anchor: TextAnchor): { start: number; end: number } | null => {
  if (anchor.quote === '') {
    return null;
  }

  let best: { start: number; score: number; distance: number } | null = null;

  for (const start of occurrences(text, anchor.quote)) {
    const before = text.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start);
    const after = text.slice(start + anchor.quote.length, start + anchor.quote.length + ANCHOR_CONTEXT_LENGTH);
    const score = commonSuffixLength(before, anchor.prefix) + commonPrefixLength(after, anchor.suffix);
    const distance = Math.abs(start - anchor.hint);

    if (!best || score > best.score || (score === best.score && distance < best.distance)) {
      best = { start, score, distance };
    }
  }

  return best ? { start: best.start, end: best.start + anchor.quote.length } : null;
};

/**
 * An anchor for `quote` in `text`. Context and hint the caller already has (the studio, from the selection) are kept;
 * otherwise they are taken from the first occurrence (or the `occurrence`th, from 0). Null when the quote is empty,
 * too long or not in the text.
 */
export const anchorOf = (
  text: string,
  quote: string,
  given: { prefix?: string | undefined; suffix?: string | undefined; hint?: number | undefined } = {},
  occurrence = 0,
): TextAnchor | null => {
  const wanted = quoteOf(quote);

  if (wanted === '' || wanted.length > ANCHOR_QUOTE_MAX_LENGTH) {
    return null;
  }

  const places = occurrences(text, wanted);
  const near = given.hint;
  const start =
    near !== undefined && places.length > 0
      ? places.reduce((nearest, at) => (Math.abs(at - near) < Math.abs(nearest - near) ? at : nearest))
      : places[occurrence];

  if (start === undefined) {
    return null;
  }

  return {
    quote: wanted,
    prefix: given.prefix ?? text.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start),
    suffix: given.suffix ?? text.slice(start + wanted.length, start + wanted.length + ANCHOR_CONTEXT_LENGTH),
    hint: given.hint ?? start,
  };
};
