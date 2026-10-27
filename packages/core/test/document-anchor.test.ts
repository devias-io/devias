import { describe, expect, it } from 'vitest';
import { anchorOf, collapseText, findAnchor, quoteOf } from '../src';

describe('anchors', () => {
  it('collapses whitespace the same way for text and quotes', () => {
    expect(collapseText('a  b\n\nc\t d')).toBe('a b c d');
    expect(quoteOf('  the   price \n list ')).toBe('the price list');
  });

  it('keeps the context and the place of a quote it finds', () => {
    const text = 'The price list was updated. See the price list again.';
    const anchor = anchorOf(text, 'price list');
    expect(anchor).toMatchObject({ quote: 'price list', prefix: 'The ', hint: 4 });
    expect(anchor?.suffix.startsWith(' was updated. See the price list')).toBe(true);
    // A repeat, chosen by where the selection was.
    const second = anchorOf(text, 'price list', {}, 1);
    expect(second?.hint).toBe(text.lastIndexOf('price list'));
    expect(anchorOf(text, 'price list', { hint: 40 })?.hint).toBe(40);
  });

  it('refuses a quote that is empty, too long or not in the text', () => {
    expect(anchorOf('hello', '   ')).toBeNull();
    expect(anchorOf('hello', 'bye')).toBeNull();
    expect(anchorOf('a'.repeat(600), 'a'.repeat(501))).toBeNull();
  });

  it('finds the occurrence whose surroundings match, wherever the text moved', () => {
    const before = 'Intro. The deadline is Friday. Notes. The deadline is Monday.';
    const anchor = anchorOf(before, 'deadline', { prefix: 'Notes. The ', suffix: ' is Monday.', hint: 40 });
    expect(anchor).not.toBeNull();
    // Text was added at the top and in between: the anchor still means the second one.
    const after = `A new first paragraph that moves everything down. ${before.replace('Notes.', 'Notes and more notes.')}`;
    const found = findAnchor(after, anchor as NonNullable<typeof anchor>);
    expect(after.slice(found?.start, found?.end)).toBe('deadline');
    expect(after.slice(found?.start ?? 0)).toMatch(/^deadline is Monday/);
  });

  it('falls back to the nearest occurrence when the context changed', () => {
    const text = 'one two one two one';
    const anchor = { quote: 'two', prefix: 'something else ', suffix: ' entirely', hint: 12 };
    expect(findAnchor(text, anchor)?.start).toBe(12);
  });

  it('does not find text that was changed or removed', () => {
    const anchor = anchorOf('The old wording stays here.', 'old wording');
    expect(findAnchor('The new wording stays here.', anchor as NonNullable<typeof anchor>)).toBeNull();
    expect(findAnchor('', { quote: '', prefix: '', suffix: '', hint: 0 })).toBeNull();
  });
});
