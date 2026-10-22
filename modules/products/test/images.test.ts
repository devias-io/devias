import { describe, expect, it } from 'vitest';
import { imagesOf, MAX_IMAGES, withCover, withImage, withoutImage } from '../src/lib/images';

describe('product images', () => {
  it('reads what is stored: strings only, trimmed, without blanks or repeats', () => {
    expect(imagesOf([' a.png ', '', 'a.png', 3, 'b.png'])).toEqual(['a.png', 'b.png']);
    expect(imagesOf(null)).toEqual([]);
    expect(imagesOf('a.png')).toEqual([]);
  });

  it('adds at the end, ignoring a blank, a repeat, or a ninth picture', () => {
    expect(withImage(['a'], ' b ')).toEqual(['a', 'b']);
    expect(withImage(['a'], 'a')).toEqual(['a']);
    expect(withImage(['a'], '  ')).toEqual(['a']);
    const full = Array.from({ length: MAX_IMAGES }, (_, i) => `p${i}`);
    expect(withImage(full, 'extra')).toBe(full);
  });

  it('removes one, and moves one to the front to make it the cover', () => {
    expect(withoutImage(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
    expect(withCover(['a', 'b', 'c'], 2)).toEqual(['c', 'a', 'b']);
    expect(withCover(['a'], 5)).toEqual(['a']);
  });
});
