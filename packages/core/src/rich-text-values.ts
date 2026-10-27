import { markdownToRichText, richTextToMarkdown } from './rich-text-markdown';

/** The part of a field these functions look at. */
interface RichTextFieldLike {
  name: string;
  type: string;
}

/**
 * Values written as text, ready to store: Markdown for a rich-text field becomes the editor's document. A value that
 * is not a string (a document, null) is left as it is, for the engine to check.
 */
export const richTextValuesFromText = (
  fields: readonly RichTextFieldLike[],
  values: Record<string, unknown>,
): Record<string, unknown> => {
  const out = { ...values };

  for (const field of fields) {
    const value = out[field.name];

    if (field.type === 'rich_text' && typeof value === 'string') {
      out[field.name] = markdownToRichText(value);
    }
  }

  return out;
};

/** Stored values as text for a reader that is not a program: each rich-text value becomes Markdown. */
export const richTextValuesToText = <T extends Record<string, unknown>>(
  fields: readonly RichTextFieldLike[],
  values: T,
): T => {
  const out: Record<string, unknown> = { ...values };

  for (const field of fields) {
    if (field.type === 'rich_text' && out[field.name] != null) {
      out[field.name] = richTextToMarkdown(out[field.name]);
    }
  }

  return out as T;
};
