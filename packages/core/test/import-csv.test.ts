import { describe, expect, it } from 'vitest';
import { detectDelimiter, formatCsv, parseCsv } from '../src/import/csv';

describe('reading CSV', () => {
  it('splits cells and lines, and ends without an empty row', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\r1,2\r')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n')).toEqual([['']]);
  });

  it('reads quoted cells with the delimiter, line breaks and doubled quotes in them', () => {
    expect(parseCsv('name,note\n"Doe, Jane","she said ""hi""\nthen left"\n')).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'she said "hi"\nthen left'],
    ]);
    expect(parseCsv('"",x')).toEqual([['', 'x']]);
    expect(parseCsv('a,"b"\n')).toEqual([['a', 'b']]);
  });

  it('drops a byte-order mark, keeps empty cells and ragged rows as they are', () => {
    expect(parseCsv('﻿a,b,c\n1,,3\n4,5\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
      ['4', '5'],
    ]);
    expect(parseCsv('a,b,')).toEqual([['a', 'b', '']]);
  });

  it('keeps a quote that is not at the start of a cell as text', () => {
    expect(parseCsv('5" pipe,ok')).toEqual([['5" pipe', 'ok']]);
  });

  it('finds the delimiter from the first lines', () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2\n')).toBe('\t');
    expect(detectDelimiter('a,b\n1,2\n')).toBe(',');
    expect(detectDelimiter('one column\nonly')).toBe(',');
    // A semicolon inside quotes is not a delimiter, and a decimal comma does not make a file comma separated.
    expect(detectDelimiter('name;price\n"a;b";1,5\n"c;d";2,5\n')).toBe(';');
    expect(parseCsv('name;price\nrice;1,5\n')).toEqual([
      ['name', 'price'],
      ['rice', '1,5'],
    ]);
  });
});

describe('writing CSV', () => {
  it('quotes what needs it, so reading it back gives the same rows', () => {
    const rows = [
      ['name', 'note'],
      ['Doe, Jane', 'said "hi"\nleft'],
      [' padded ', ''],
    ];
    expect(formatCsv(rows)).toBe('name,note\r\n"Doe, Jane","said ""hi""\nleft"\r\n" padded ",');
    expect(parseCsv(formatCsv(rows), ',')).toEqual(rows);
  });

  it('keeps a row of one empty cell as a row', () => {
    expect(parseCsv(formatCsv([['a'], ['']]), ',')).toEqual([['a'], ['']]);
  });

  it('round trips random tables with every delimiter', () => {
    let seed = 20261022;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;

      return seed / 0x100000000;
    };
    const pieces = ['a', 'b c', ',', ';', '\t', '"', '""', '\n', '\r\n', ' ', 'é', '', '1,5', '\\'];
    const cell = () =>
      Array.from({ length: Math.floor(next() * 4) }, () => pieces[Math.floor(next() * pieces.length)]).join('');

    for (let n = 0; n < 500; n++) {
      const width = 1 + Math.floor(next() * 4);
      const rows = Array.from({ length: 1 + Math.floor(next() * 5) }, () => Array.from({ length: width }, cell));
      const delimiter = ([',', ';', '\t'] as const)[Math.floor(next() * 3)] as ',' | ';' | '\t';

      // A line break inside a cell is read back as `\n` or `\r\n` as written, so compare what was written.
      expect(parseCsv(formatCsv(rows, delimiter), delimiter), JSON.stringify(rows)).toEqual(rows);
    }
  });
});
