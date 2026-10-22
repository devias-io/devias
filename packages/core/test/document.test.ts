import { describe, expect, it } from 'vitest';
import {
  cleanDocumentBody,
  DocumentAppendSchema,
  DocumentInputSchema,
  DocumentPatchSchema,
  DocumentQuerySchema,
  decodeDocumentCursor,
  documentBodyProblem,
  documentIdsOf,
  encodeDocumentCursor,
  previewOf,
  type RichTextDoc,
} from '../src';

const doc = (content: RichTextDoc['content']): RichTextDoc => ({ type: 'doc', content });

describe('document input', () => {
  it('wants a title, and a body or Markdown but not both', () => {
    expect(DocumentInputSchema.safeParse({ title: ' Plan ' }).data).toEqual({ title: 'Plan' });
    expect(DocumentInputSchema.safeParse({ title: '' }).success).toBe(false);
    expect(DocumentInputSchema.safeParse({ title: 'x'.repeat(201) }).success).toBe(false);
    expect(DocumentInputSchema.safeParse({ title: 'x', markdown: 'y' }).success).toBe(true);
    expect(DocumentInputSchema.safeParse({ title: 'x', markdown: 'y', body: doc([]) }).success).toBe(false);
  });

  it('wants a change to change something', () => {
    expect(DocumentPatchSchema.safeParse({}).success).toBe(false);
    expect(DocumentPatchSchema.safeParse({ expectedVersion: 2 }).success).toBe(false);
    expect(DocumentPatchSchema.safeParse({ title: 'x', expectedVersion: 2 }).success).toBe(true);
    expect(DocumentPatchSchema.safeParse({ expectedVersion: 0, title: 'x' }).success).toBe(false);
    expect(DocumentAppendSchema.safeParse({ markdown: '' }).success).toBe(false);
  });

  it('reads a query from strings', () => {
    expect(DocumentQuerySchema.parse({ limit: '10', search: ' pricing ' })).toEqual({ limit: 10, search: 'pricing' });
    expect(DocumentQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(DocumentQuerySchema.safeParse({ updatedAfter: 'yesterday' }).success).toBe(false);
    expect(documentIdsOf('a, b,,a')).toEqual(['a', 'b']);
    expect(documentIdsOf(undefined)).toEqual([]);
  });
});

describe('document cursors', () => {
  it('round-trips and refuses nonsense', () => {
    const at = '2026-10-22T10:00:00.000Z';
    expect(decodeDocumentCursor(encodeDocumentCursor(at, 'abc'))).toEqual({ updatedAt: at, id: 'abc' });
    expect(decodeDocumentCursor('nonsense')).toBeUndefined();
    expect(decodeDocumentCursor('nope|abc')).toBeUndefined();
  });
});

describe('a document body', () => {
  it('must be a doc, small and shallow', () => {
    expect(documentBodyProblem(doc([{ type: 'paragraph' }]))).toBeNull();
    expect(documentBodyProblem({ type: 'paragraph' })).toMatch(/editor document/);
    let nested: RichTextDoc['content'] = [{ type: 'paragraph' }];

    for (let i = 0; i < 70; i += 1) {
      nested = [{ type: 'blockquote', content: nested }];
    }

    expect(documentBodyProblem(doc(nested))).toMatch(/nested too deeply/);
    expect(
      documentBodyProblem(doc([{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(1_000_001) }] }])),
    ).toMatch(/too large/);
  });

  it('loses links that are not safe and keeps the text', () => {
    const link = (href: string) => ({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] });
    const cleaned = cleanDocumentBody(
      doc([
        {
          type: 'paragraph',
          content: [
            link('javascript:alert(1)'),
            link('https://example.com'),
            link('mailto:a@b.c'),
            link('document:abc'),
            link('/records'),
            link('data:text/html,x'),
          ],
        },
      ]),
    );
    const kept = cleaned.content?.[0]?.content?.filter((node) => node.marks?.length).map((node) => node.text);
    expect(kept).toEqual(['https://example.com', 'mailto:a@b.c', 'document:abc', '/records']);
    expect(cleaned.content?.[0]?.content).toHaveLength(6);
  });

  it('previews on one line', () => {
    expect(previewOf('  one\n\n two   three ')).toBe('one two three');
    expect(previewOf('x'.repeat(500))).toHaveLength(240);
  });
});
