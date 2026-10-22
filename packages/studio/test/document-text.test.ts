import { collapseText, MENTION_NODE, markdownToRichText, plainText, type RichTextDoc } from '@devias/core';
import { Mention } from '@tiptap/extension-mention';
import { TableKit } from '@tiptap/extension-table';
import { Node } from '@tiptap/pm/model';
import { getSchema } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { anchorOfSelection, documentText, placeAnchor } from '../src/editor/document-text';

const schema = getSchema([StarterKit, TableKit, Mention.extend({ name: MENTION_NODE })]);
const nodeOf = (doc: unknown) => Node.fromJSON(schema, doc);
const paragraphs = (...lines: string[]) => ({
  type: 'doc',
  content: lines.map((line) =>
    line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' },
  ),
});

describe('the text comments are anchored to', () => {
  it('reads the editor document the way the engine reads the saved one', () => {
    const docs: unknown[] = [
      paragraphs('The price list is attached.', '', '  See the   price list again.  '),
      markdownToRichText('# Title\n\n- one\n- two with **bold**\n\n> quoted line\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'),
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Ask ' },
              { type: MENTION_NODE, attrs: { id: 'r1', label: 'Ada', object: 'contacts' } },
              { type: 'hardBreak' },
              { type: 'text', text: 'about it' },
            ],
          },
          { type: 'horizontalRule' },
          { type: 'paragraph' },
          { type: 'paragraph', content: [{ type: 'text', text: 'end' }] },
        ],
      },
    ];

    for (const doc of docs) {
      expect(documentText(nodeOf(doc)).text).toBe(collapseText(plainText(doc as RichTextDoc)));
    }
  });

  it('says where a stretch of text is in the editor, across blocks and mentions', () => {
    const doc = nodeOf(paragraphs('The price list', 'is attached.'));
    const projected = documentText(doc);
    expect(projected.text).toBe('The price list is attached.');
    // The first paragraph opens at 0, its text starts at 1; the second opens at 16, its text starts at 17.
    expect(projected.rangeOf(4, 9)).toEqual({ from: 5, to: 10 });
    expect(projected.rangeOf(4, 19)).toEqual({ from: 5, to: 21 });
    expect(doc.textBetween(5, 21, ' ')).toBe('price list is a');

    const mention = documentText(
      nodeOf({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Ask ' },
              { type: MENTION_NODE, attrs: { id: 'r1', label: 'Ada', object: 'contacts' } },
              { type: 'text', text: ' now' },
            ],
          },
        ],
      }),
    );
    expect(mention.text).toBe('Ask @Ada now');
    // A mention is one unit: a range that touches it covers all of it.
    expect(mention.rangeOf(5, 6)).toEqual({ from: 5, to: 6 });
  });

  it('anchors a selection and finds it again, the right one of a repeated text', () => {
    const doc = nodeOf(paragraphs('The price list is attached.', 'See the price list again.'));
    const projected = documentText(doc);
    const second = projected.text.lastIndexOf('price list');
    const range = projected.rangeOf(second, second + 'price list'.length);
    expect(range).not.toBeNull();
    const anchor = anchorOfSelection(doc, range?.from ?? 0, range?.to ?? 0);
    expect(anchor).toMatchObject({ quote: 'price list', hint: second, prefix: 'The price list is attached. See the ' });
    expect(placeAnchor(projected, anchor as NonNullable<typeof anchor>)).toEqual(range);

    // Words added before it move it, and the context still picks the second one.
    const edited = documentText(
      nodeOf(paragraphs('Intro.', 'The price list is attached.', 'See the price list again.')),
    );
    const moved = placeAnchor(edited, anchor as NonNullable<typeof anchor>);
    const at = edited.text.lastIndexOf('price list');
    expect(moved).toEqual(edited.rangeOf(at, at + 'price list'.length));

    // Without the text, there is nothing to place.
    expect(
      placeAnchor(documentText(nodeOf(paragraphs('Nothing here.'))), anchor as NonNullable<typeof anchor>),
    ).toBeNull();
  });

  it('trims a selection that takes in spaces or a block edge, and refuses empty or too long ones', () => {
    const doc = nodeOf(paragraphs('Alpha beta', 'gamma delta'));
    // From the space after "Alpha" to the start of the second paragraph's text: only "beta" is text.
    expect(anchorOfSelection(doc, 6, 13)?.quote).toBe('beta');
    // From before "beta" to after "gamma": spans the block boundary.
    expect(anchorOfSelection(doc, 7, 18)?.quote).toBe('beta gamma');
    expect(anchorOfSelection(doc, 6, 7)).toBeNull();
    expect(anchorOfSelection(nodeOf(paragraphs('x'.repeat(600))), 1, 601)).toBeNull();
  });
});
