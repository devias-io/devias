import { describe, expect, it } from 'vitest';
import {
  contentDispositionOf,
  detectFileType,
  fileVariantKeyOf,
  fileVariantUrl,
  isInlineSafe,
  isRasterImage,
} from '../src';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);
const withTail = (head: number[], length = 64) => {
  const out = new Uint8Array(length);
  out.set(head);

  return out;
};

describe('detectFileType', () => {
  it('knows pictures and PDFs by their first bytes', () => {
    expect(detectFileType(withTail([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectFileType(withTail([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectFileType(text('GIF89a......'))).toBe('image/gif');
    expect(detectFileType(text('GIF87a......'))).toBe('image/gif');
    expect(detectFileType(text('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
    expect(detectFileType(text('\u0000\u0000\u0000\u001cftypavif\u0000\u0000\u0000\u0000'))).toBe('image/avif');
    expect(detectFileType(text('%PDF-1.7\n%âãÏÓ'))).toBe('application/pdf');
  });

  it('ignores the name and what the client said when the bytes say something else', () => {
    // A program renamed to .png, and a picture called .exe.
    expect(detectFileType(text('MZ\u0090\u0000\u0003'), 'photo.png')).toBe('application/octet-stream');
    expect(detectFileType(withTail([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'setup.exe')).toBe('image/png');
    expect(detectFileType(text('MZ\u0090\u0000\u0003'), 'setup.exe')).toBe('application/octet-stream');
  });

  it('calls text by its extension only when the bytes are text', () => {
    expect(detectFileType(text('a,b\n1,2\n'), 'table.CSV')).toBe('text/csv');
    expect(detectFileType(text('# Title'), 'notes.md')).toBe('text/markdown');
    expect(detectFileType(text('{"a":1}'), 'data.json')).toBe('application/json');
    expect(detectFileType(text('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'logo.svg')).toBe('image/svg+xml');
    expect(detectFileType(text('<script>alert(1)</script>'), 'page.html')).toBe('text/html');
    expect(detectFileType(bytes(0x00, 0xff, 0xfe, 0x01), 'notes.txt')).toBe('application/octet-stream');
    expect(detectFileType(text('plain'), 'noextension')).toBe('application/octet-stream');
  });

  it('accepts a sample that ends inside a character', () => {
    const sample = text('café€');

    expect(detectFileType(sample.subarray(0, sample.length - 1), 'a.txt')).toBe('text/plain');
  });
});

describe('what may be shown in place', () => {
  it('allows only pictures and PDFs, never SVG or HTML', () => {
    expect(
      ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'application/pdf'].every(isInlineSafe),
    ).toBe(true);
    expect(['image/svg+xml', 'text/html', 'application/octet-stream', 'text/plain'].some(isInlineSafe)).toBe(false);
    expect(isRasterImage('image/png')).toBe(true);
    expect(isRasterImage('image/svg+xml')).toBe(false);
    expect(isRasterImage('application/pdf')).toBe(false);
  });
});

describe('contentDispositionOf', () => {
  it('encodes the name so it cannot end the header', () => {
    const header = contentDispositionOf('attachment', 'a"b; c\r\nd é.txt');

    expect(header).toBe(`attachment; filename="a_b_ c__d _.txt"; filename*=UTF-8''a%22b%3B%20c%0D%0Ad%20%C3%A9.txt`);
    expect(header).not.toMatch(/[\r\n]/);
  });
});

describe('variants', () => {
  it('names a variant, and adds it to the link of a file', () => {
    expect(fileVariantKeyOf({ width: 256, fit: 'cover' })).toBe('w256-cover');
    expect(fileVariantKeyOf({ width: 64, fit: 'inside' })).toBe('w64-inside');
    expect(fileVariantUrl('http://x/files/1?exp=9&sig=a', { w: 128 })).toBe('http://x/files/1?exp=9&sig=a&w=128');
    expect(fileVariantUrl('/files/1?exp=9&sig=a', { w: 256, fit: 'cover' })).toBe(
      '/files/1?exp=9&sig=a&w=256&fit=cover',
    );
    expect(fileVariantUrl('/files/1', { w: 64 })).toBe('/files/1?w=64');
  });
});
