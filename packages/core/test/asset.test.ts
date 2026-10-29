import { describe, expect, it } from 'vitest';
import { assetGroupOf, assetIdsOf, assetNameOf, decodeAssetCursor, encodeAssetCursor } from '../src';

describe('asset groups', () => {
  it('groups files for the library', () => {
    expect(assetGroupOf('image/svg+xml')).toBe('image');
    expect(assetGroupOf('application/pdf')).toBe('pdf');
    expect(assetGroupOf('text/csv')).toBe('text');
    expect(assetGroupOf('application/json')).toBe('text');
    expect(assetGroupOf('application/octet-stream')).toBe('other');
  });
});

describe('assetNameOf', () => {
  it('keeps the last part of a path and drops control characters', () => {
    expect(assetNameOf('C:\\Users\\me\\report.pdf')).toBe('report.pdf');
    expect(assetNameOf('../../etc/passwd')).toBe('passwd');
    expect(assetNameOf('  a\u0000b\nc.txt ')).toBe('abc.txt');
    expect(assetNameOf('dir/')).toBe('file');
    expect(assetNameOf('..')).toBe('file');
    expect(assetNameOf('')).toBe('file');
  });

  it('shortens a long name but keeps its extension', () => {
    const name = assetNameOf(`${'x'.repeat(400)}.pdf`);

    expect(name).toHaveLength(255);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('queries', () => {
  it('round-trips cursors and reads id lists', () => {
    const at = '2026-10-29T10:00:00.000Z';

    expect(decodeAssetCursor(encodeAssetCursor(at, 'abc'))).toEqual({ updatedAt: at, id: 'abc' });
    expect(decodeAssetCursor('nonsense')).toBeUndefined();
    expect(assetIdsOf(' a, b ,a,,c')).toEqual(['a', 'b', 'c']);
    expect(assetIdsOf(undefined)).toEqual([]);
  });
});
