import { evaluateFilter, parseManifest } from '@devias/core';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_DOC,
  mentionsOf,
  mentionsRecordFilter,
  plainText,
  type RichTextDoc,
  toRichTextDoc,
} from '../src/editor/rich-text';
import { manifest } from '../src/manifest';

const mention = (object: string, id: string, label: string) => ({ type: 'mention', attrs: { object, id, label } });

const doc: RichTextDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Kickoff' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Met ' },
        mention('person', 'p1', 'Ada'),
        { type: 'text', text: ' from ' },
        mention('company', 'c1', 'Globex'),
      ],
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Follow up' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [mention('person', 'p1', 'Ada')] }] },
      ],
    },
  ],
};

describe('rich text', () => {
  it('renders plain text with mentions as @label, one line per block', () => {
    expect(plainText(doc)).toBe('Kickoff\nMet @Ada from @Globex\nFollow up\n@Ada');
    expect(plainText(EMPTY_DOC)).toBe('');
    expect(plainText(42)).toBe('');
  });

  it('reads plain strings (e.g. written through the API) as paragraphs', () => {
    expect(toRichTextDoc('One\n\nTwo')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] },
      ],
    });
    expect(plainText('One\n\nTwo')).toBe('One\nTwo');
    expect(toRichTextDoc(null)).toBe(EMPTY_DOC);
  });

  it('lists each mentioned record once, in order', () => {
    expect(mentionsOf(doc)).toEqual([
      { object: 'person', id: 'p1', label: 'Ada' },
      { object: 'company', id: 'c1', label: 'Globex' },
    ]);
    expect(mentionsOf(null)).toEqual([]);
  });

  it('finds documents mentioning a record by its quoted id', () => {
    const record = { id: 'd1', createdAt: '', updatedAt: '', title: 'Kickoff', body: doc };
    expect(evaluateFilter(record, mentionsRecordFilter('c1'))).toBe(true);
    expect(evaluateFilter(record, mentionsRecordFilter('c'))).toBe(false);
    expect(evaluateFilter(record, mentionsRecordFilter('p2'))).toBe(false);
  });

  it('ships a valid manifest', () => {
    expect(() => parseManifest(manifest)).not.toThrow();
  });
});
