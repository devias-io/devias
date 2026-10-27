/** Small helpers for reading records, which are plain JSON, so fields come back loosely typed. */

/** A finite number, or 0 for anything else (empty fields come back as null). */
export const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** A string, or '' for anything else. */
export const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Money is kept to two decimals. */
export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** "1 deal", "3 deals". */
export const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
