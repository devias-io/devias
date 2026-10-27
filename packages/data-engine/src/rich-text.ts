import { cleanRichText, EMPTY_DOC, markdownToRichText, type RichTextDoc, richTextProblem } from '@devias/core';
import { validationError } from './errors';

/** Throws a validation error when `body` cannot be stored as rich text (not a document, too large, too deep). */
export const checkedRichText = (body: RichTextDoc, path = 'body'): RichTextDoc => {
  const problem = richTextProblem(body);

  if (problem) {
    throw validationError(problem, { path });
  }

  return body;
};

/**
 * The text of a write that carries one: `markdown` is converted, a `body` is checked and cleaned. Undefined when the
 * write carries neither.
 */
export const richTextOf = (input: { body?: unknown; markdown?: string | undefined }): RichTextDoc | undefined => {
  if (input.markdown !== undefined) {
    return markdownToRichText(input.markdown);
  }

  if (input.body === undefined) {
    return undefined;
  }

  const problem = richTextProblem(input.body);

  if (problem) {
    throw validationError(problem, { path: 'body' });
  }

  return cleanRichText(input.body as RichTextDoc);
};

/** The text of a write, or the empty document when it carries none. */
export const richTextOrEmpty = (input: { body?: unknown; markdown?: string | undefined }): RichTextDoc =>
  richTextOf(input) ?? EMPTY_DOC;
