import { formatCsv, type ImportReport } from '@devias/core';

type Problem = ImportReport['errors'][number];

/** The reports of the chunks of one import, added up: what was done and the problems, by row. */
export interface ImportTotals {
  created: number;
  updated: number;
  skipped: number;
  errorCount: number;
  errors: Problem[];
  importIds: string[];
}

export const emptyTotals = (): ImportTotals => ({
  created: 0,
  updated: 0,
  skipped: 0,
  errorCount: 0,
  errors: [],
  importIds: [],
});

export const addReport = (totals: ImportTotals, report: ImportReport): ImportTotals => ({
  created: totals.created + report.created,
  updated: totals.updated + report.updated,
  skipped: totals.skipped + report.skipped,
  errorCount: totals.errorCount + report.errorCount,
  errors: [...totals.errors, ...report.errors],
  importIds: report.importId ? [...totals.importIds, report.importId] : totals.importIds,
});

/** Consecutive slices of at most `size`. */
export const chunksOf = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }

  return out;
};

/**
 * The rows that had problems, as CSV the person can fix and import again: the header (when the file had one) with a
 * `Problem` column, then each such row as it was, with what was wrong with it. `firstRow` is the spreadsheet number
 * of `rows[0]`.
 */
export const problemRowsCsv = (
  header: readonly string[] | null,
  rows: readonly (readonly string[])[],
  errors: readonly Problem[],
  firstRow: number,
): string => {
  const byRow = new Map<number, string[]>();

  for (const error of errors) {
    const reasons = byRow.get(error.row) ?? [];
    reasons.push(error.field ? `${error.field}: ${error.message}` : error.message);
    byRow.set(error.row, reasons);
  }

  const out: string[][] = header ? [[...header, 'Problem']] : [];

  for (const [row, reasons] of [...byRow].sort((a, b) => a[0] - b[0])) {
    const cells = rows[row - firstRow];

    if (cells) {
      // Padded to the header, so the Problem column is the last one on every line.
      const padding = Array.from({ length: Math.max(0, (header?.length ?? 0) - cells.length) }, () => '');
      out.push([...cells, ...padding, reasons.join('; ')]);
    }
  }

  return formatCsv(out);
};
