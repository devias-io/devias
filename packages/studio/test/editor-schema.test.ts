import { MARKDOWN_MARKS, MARKDOWN_NODES } from '@devias/core';
import { getSchema } from '@tiptap/react';
import { describe, expect, it } from 'vitest';
import { createRecordMention } from '../src/editor/record-mention';
import { contentExtensions } from '../src/editor/schema';

// What a person can write in the editor is what the Markdown converter in core has to be able to carry. Adding a
// node or a mark to the editor fails this until the converter (and `markdownLosses`) know about it.
describe('the editor schema and the Markdown converter', () => {
  const schema = getSchema([...contentExtensions, createRecordMention(async () => [])]);

  it('has no node the converter does not handle', () => {
    expect(Object.keys(schema.nodes).filter((name) => !MARKDOWN_NODES.includes(name))).toEqual([]);
  });

  it('has no mark the converter does not handle', () => {
    expect(Object.keys(schema.marks).filter((name) => !MARKDOWN_MARKS.includes(name))).toEqual([]);
  });

  it('has every node and mark the converter lists', () => {
    expect(MARKDOWN_NODES.filter((name) => !(name in schema.nodes))).toEqual([]);
    expect(MARKDOWN_MARKS.filter((name) => !(name in schema.marks))).toEqual([]);
  });
});
