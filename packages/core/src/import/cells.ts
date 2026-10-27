import { valueSchemaForField } from '../metadata/field-types';
import { markdownToRichText } from '../rich-text-markdown';

/** What a cell of a file is read as; the part of a field these functions look at. */
export interface ImportField {
  id?: string;
  name: string;
  label: string;
  type: string;
  settings?: Record<string, unknown> | undefined;
}

/** How a file writes its dates: `13/11/2026` is `dmy`, `11/13/2026` is `mdy`. A file cannot say, so a person does. */
export type DateOrder = 'dmy' | 'mdy';

export interface CellOptions {
  dateOrder?: DateOrder | undefined;
  /** The time zone (`Europe/Bucharest`) a date and time without an offset is in; UTC when left out. */
  timeZone?: string | undefined;
}

/**
 * What one cell is:
 * - `empty`: no value (the field is left out on create and left as it is on update);
 * - `value`: the stored value;
 * - `lookup`: a relation or a member, as written, for the caller to find the record or the person;
 * - `error`: why it cannot be read, as a sentence for the person.
 */
export type Cell =
  | { kind: 'empty' }
  | { kind: 'value'; value: unknown }
  | { kind: 'lookup'; text: string }
  | { kind: 'error'; message: string };

const empty: Cell = { kind: 'empty' };
const value = (stored: unknown): Cell => ({ kind: 'value', value: stored });
const error = (message: string): Cell => ({ kind: 'error', message });

/** Types a file can fill: everything the editor can type into a form except `json` and what a module adds. */
const IMPORTABLE = new Set([
  'text',
  'phone',
  'email',
  'url',
  'number',
  'money',
  'currency',
  'boolean',
  'date',
  'date_time',
  'select',
  'multi_select',
  'relation',
  'member',
  'rich_text',
]);

export const isImportable = (field: Pick<ImportField, 'type'>): boolean => IMPORTABLE.has(field.type);

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

/**
 * A number as people write it. Signs of currency and spaces are dropped, `(12.50)` is negative. When both `.` and `,`
 * appear the last one is the decimal point; a separator that appears more than once, or once with exactly three digits
 * after it and one to three (not 0) before it, is a thousands separator (`1,234` is 1234, `1.234.567` is 1234567);
 * any other single one is the decimal point (`1,5` is 1.5, `0.125` is 0.125).
 */
export const parseNumber = (text: string): number | null => {
  const trimmed = text.trim();
  const negative = /^\(.*\)$/.test(trimmed) || /^[^\d]*-/.test(trimmed);
  const kept = trimmed.replace(/[^\d.,]/g, '');

  if (!/\d/.test(kept)) {
    return null;
  }

  const lastDot = kept.lastIndexOf('.');
  const lastComma = kept.lastIndexOf(',');
  /** Groups of thousands: one to three digits, then groups of exactly three. */
  const grouped = (integer: string, separator: string): boolean =>
    new RegExp(`^\\d{1,3}(\\${separator}\\d{3})+$`).test(integer);
  let digits: string;

  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    const [integer = '', fraction = '', ...rest] = kept.split(decimal);

    if (rest.length > 0 || (integer.includes(decimal) ? false : !grouped(integer, thousands))) {
      return null;
    }

    digits = `${integer.split(thousands).join('')}.${fraction}`;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const separator = lastDot >= 0 ? '.' : ',';
    const parts = kept.split(separator);
    const [before = '', after = ''] = parts;

    if (parts.length > 2) {
      if (!grouped(kept, separator)) {
        return null;
      }

      digits = parts.join('');
    } else {
      const thousands = after.length === 3 && /^[1-9]\d{0,2}$/.test(before);
      digits = thousands ? parts.join('') : `${before}.${after}`;
    }
  } else {
    digits = kept;
  }

  const number = Number(digits);

  if (!Number.isFinite(number) || digits === '' || digits === '.') {
    return null;
  }

  return negative ? -number : number;
};

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

interface Day {
  year: number;
  month: number;
  day: number;
}

const realDay = ({ year, month, day }: Day): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

/** The year of `26` is 2026, and of `75` is 1975. */
const fullYear = (text: string): number =>
  text.length === 2 ? (Number(text) < 70 ? 2000 : 1900) + Number(text) : Number(text);

/** A day in `YYYY-MM-DD` (also with `/` or `.`), or, when the order is known, in `D/M/YYYY` or `M/D/YYYY` (also `-`, `.`). */
const parseDay = (text: string, order: DateOrder | undefined): Day | 'ambiguous' | null => {
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);

  if (iso) {
    const day = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };

    return realDay(day) ? day : null;
  }

  const other = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(text);

  if (!other) {
    return null;
  }

  if (!order) {
    return 'ambiguous';
  }

  const [first, second] = [Number(other[1]), Number(other[2])];
  const day = {
    year: fullYear(other[3] as string),
    month: order === 'dmy' ? second : first,
    day: order === 'dmy' ? first : second,
  };

  return realDay(day) ? day : null;
};

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The instant a wall-clock time is, in a time zone. */
const instantIn = (day: Day, hour: number, minute: number, second: number, timeZone: string): number => {
  const asUtc = Date.UTC(day.year, day.month - 1, day.day, hour, minute, second);
  const offsetAt = (instant: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);

    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - instant;
  };
  // Twice, so a zone whose offset changes between the guess and the answer (a clock change) settles.
  const first = asUtc - offsetAt(asUtc);

  return asUtc - offsetAt(first);
};

const knownZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });

    return true;
  } catch {
    return false;
  }
};

const dateHelp = 'Write it as YYYY-MM-DD, or choose the order of day and month for 13/11/2026';

const readDate = (text: string, options: CellOptions): Cell => {
  const day = parseDay(text.trim(), options.dateOrder);

  if (day === 'ambiguous') {
    return error(`"${text.trim()}" is a date whose order a file cannot say. ${dateHelp}`);
  }

  return day
    ? value(`${pad(day.year, 4)}-${pad(day.month)}-${pad(day.day)}`)
    : error(`"${text.trim()}" is not a date. ${dateHelp}`);
};

const readDateTime = (text: string, options: CellOptions): Cell => {
  const trimmed = text.trim();
  const withOffset = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.exec(trimmed);

  if (withOffset) {
    const instant = Date.parse(
      trimmed
        .replace(' ', 'T')
        .replace(/\s+/g, '')
        .replace(/([+-]\d{2})(\d{2})$/, '$1:$2'),
    );

    return Number.isNaN(instant)
      ? error(`"${trimmed}" is not a date and time`)
      : value(new Date(instant).toISOString());
  }

  const split = /^(.+?)(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed);
  const day = split ? parseDay((split[1] ?? '').trim(), options.dateOrder) : null;

  if (day === 'ambiguous') {
    return error(`"${trimmed}" is a date whose order a file cannot say. ${dateHelp}`);
  }

  const [hour, minute, second] = [Number(split?.[2] ?? 0), Number(split?.[3] ?? 0), Number(split?.[4] ?? 0)];

  if (!day || hour > 23 || minute > 59 || second > 59) {
    return error(`"${trimmed}" is not a date and time. ${dateHelp}, then the time as HH:MM`);
  }

  const zone = options.timeZone ?? 'UTC';

  if (!knownZone(zone)) {
    return error(`"${zone}" is not a time zone`);
  }

  return value(new Date(instantIn(day, hour, minute, second, zone)).toISOString());
};

// ---------------------------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------------------------

const TRUE = new Set(['true', 'yes', 'y', '1', 'x']);
const FALSE = new Set(['false', 'no', 'n', '0']);

interface Option {
  value: string;
  label: string;
}

const optionsOf = (field: ImportField): Option[] =>
  ((field.settings as { options?: Option[] } | undefined)?.options ?? []).filter(
    (option) => typeof option?.value === 'string',
  );

const readOption = (field: ImportField, text: string): Cell => {
  const options = optionsOf(field);
  const needle = text.trim().toLowerCase();

  if (options.length === 0) {
    return value(text.trim());
  }

  const found = options.find(
    (option) => option.value.toLowerCase() === needle || (option.label ?? '').toLowerCase() === needle,
  );

  if (found) {
    return value(found.value);
  }

  const some = options
    .slice(0, 8)
    .map((option) => option.label || option.value)
    .join(', ');

  return error(
    `"${text.trim()}" is not one of the options of ${field.label}: ${some}${options.length > 8 ? ', …' : ''}`,
  );
};

/** The stored value, through the field's own check (email lower-cased, an address without its scheme, a currency code). */
const checked = (field: ImportField, text: string, label: string): Cell => {
  const result = valueSchemaForField({ type: field.type, settings: field.settings, isRequired: true }).safeParse(text);

  return result.success ? value(result.data) : error(`"${text}" is not ${label}`);
};

/**
 * One cell of a file as the stored value of `field`. The rules are in "Import records" in the docs: text is trimmed,
 * numbers and dates are read as people write them, a select by value or label, a relation or a member is left for the
 * caller to find (`lookup`), rich text is Markdown. An empty cell is `empty`, whatever the type.
 */
export const readCell = (field: ImportField, text: string, options: CellOptions = {}): Cell => {
  const trimmed = text.trim();

  if (trimmed === '') {
    return empty;
  }

  switch (field.type) {
    case 'text':
    case 'phone':
      return value(trimmed);
    case 'email':
      return checked(field, trimmed, 'an email address');
    case 'url':
      return checked(field, trimmed, 'a web address');
    case 'currency':
      return checked(field, trimmed.toUpperCase(), 'a currency code such as EUR');
    case 'number':
    case 'money': {
      const number = parseNumber(trimmed);

      return number === null ? error(`"${trimmed}" is not a number`) : value(number);
    }
    case 'boolean': {
      const word = trimmed.toLowerCase();

      return TRUE.has(word) ? value(true) : FALSE.has(word) ? value(false) : error(`"${trimmed}" is not yes or no`);
    }
    case 'date':
      return readDate(trimmed, options);
    case 'date_time':
      return readDateTime(trimmed, options);
    case 'select':
      return readOption(field, trimmed);
    case 'multi_select': {
      const parts = trimmed
        .split(/[;|,]/)
        .map((part) => part.trim())
        .filter(Boolean);
      const cells = parts.map((part) => readOption(field, part));
      const bad = cells.find((cell) => cell.kind === 'error');

      return (
        bad ??
        value(
          [...new Set(cells.map((cell) => (cell.kind === 'value' ? cell.value : null)))].filter((one) => one !== null),
        )
      );
    }
    case 'relation':
    case 'member':
      return { kind: 'lookup', text: trimmed };
    case 'rich_text':
      return value(markdownToRichText(trimmed));
    default:
      return error(`${field.label} cannot be filled from a file`);
  }
};

// ---------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------

const normal = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * The field each column's header names, by label, API name or id, in any case and with any punctuation (`First name`,
 * `first_name`); null for a header no field matches. A field is taken by one column only, the first.
 */
export const matchColumns = (headers: readonly string[], fields: readonly ImportField[]): (ImportField | null)[] => {
  const taken = new Set<string>();

  return headers.map((header) => {
    const needle = normal(header);

    if (!needle) {
      return null;
    }

    const found = fields.find(
      (field) =>
        isImportable(field) &&
        !taken.has(field.name) &&
        [field.label, field.name, field.id ?? ''].some((name) => name && normal(name) === needle),
    );

    if (found) {
      taken.add(found.name);
    }

    return found ?? null;
  });
};

/** Does the first row look like a header? It does when its cells name fields, or when none of them reads as data. */
export const looksLikeHeader = (row: readonly string[], fields: readonly ImportField[]): boolean => {
  const cells = row.filter((cell) => cell.trim() !== '');

  if (cells.length === 0) {
    return false;
  }

  const matched = matchColumns(row, fields).filter(Boolean).length;

  if (matched * 2 >= cells.length) {
    return true;
  }

  const dataLike = (cell: string) =>
    parseNumber(cell) !== null || /^\S+@\S+\.\S+$/.test(cell.trim()) || /^\d{4}-\d{2}-\d{2}/.test(cell.trim());

  return !cells.some(dataLike);
};
