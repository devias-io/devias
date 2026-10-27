/** The delimiters a file may use: a comma, a semicolon (where the comma is the decimal point) or a tab. */
export const CSV_DELIMITERS = [',', ';', '\t'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/**
 * The delimiter a text uses, from its first lines: the one that splits them into the same number of cells (more than
 * one) outside quotes, the commonest. A comma when nothing says otherwise.
 */
export const detectDelimiter = (text: string): CsvDelimiter => {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r\n|\n|\r/)
    .slice(0, 8);
  let best: { delimiter: CsvDelimiter; score: number } = { delimiter: ',', score: 0 };

  for (const delimiter of CSV_DELIMITERS) {
    const counts = lines
      .filter((line) => line.trim() !== '')
      .map((line) => {
        let quoted = false;
        let count = 0;

        for (const char of line) {
          if (char === '"') {
            quoted = !quoted;
          } else if (char === delimiter && !quoted) {
            count++;
          }
        }

        return count;
      });
    const first = counts[0] ?? 0;
    const consistent = counts.length > 0 && first > 0 && counts.every((count) => count === first);
    // A consistent split beats a ragged one; then more cells win.
    const score = consistent ? 1000 + first : first;

    if (score > best.score) {
      best = { delimiter, score };
    }
  }

  return best.delimiter;
};

/**
 * Rows of cells from CSV text (RFC 4180): a cell may be quoted, hold the delimiter and line breaks, and write a quote as
 * two. A byte-order mark is dropped, and a line ends with `\n`, `\r\n` or `\r`. Rows are as long as they are written:
 * ragged ones stay ragged, and a trailing line break adds no row.
 */
export const parseCsv = (text: string, delimiter: CsvDelimiter = detectDelimiter(text)): string[][] => {
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  let i = 0;

  const endCell = () => {
    row.push(cell);
    cell = '';
    wasQuoted = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i] as string;

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }

        quoted = false;
        i++;
        continue;
      }

      cell += char;
      i++;
      continue;
    }

    if (char === '"' && cell === '' && !wasQuoted) {
      quoted = true;
      wasQuoted = true;
      i++;
    } else if (char === delimiter) {
      endCell();
      i++;
    } else if (char === '\r' || char === '\n') {
      endRow();
      i += char === '\r' && input[i + 1] === '\n' ? 2 : 1;
    } else {
      cell += char;
      i++;
    }
  }

  // The last line, unless the text ended with a line break (or is empty).
  if (cell !== '' || row.length > 0 || wasQuoted) {
    endRow();
  }

  return rows;
};

const needsQuotes = (cell: string, delimiter: string): boolean =>
  cell.includes(delimiter) || cell.includes('"') || cell.includes('\n') || cell.includes('\r') || cell !== cell.trim();

/** CSV text from rows, quoting what needs it; `parseCsv` reads it back as it was. Lines end with `\r\n`. */
export const formatCsv = (rows: readonly (readonly string[])[], delimiter: CsvDelimiter = ','): string =>
  rows
    .map((row) =>
      row
        // A row of one empty cell is quoted, or it would be an empty line, which is no row at the end of a text.
        .map((cell) =>
          needsQuotes(cell, delimiter) || (row.length === 1 && cell === '') ? `"${cell.replace(/"/g, '""')}"` : cell,
        )
        .join(delimiter),
    )
    .join('\r\n');
