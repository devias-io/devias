import { describe, expect, it } from 'vitest';
import { type ImportField, looksLikeHeader, matchColumns, parseNumber, readCell } from '../src/import/cells';

const field = (type: string, extra: Partial<ImportField> = {}): ImportField => ({
  name: type,
  label: type,
  type,
  ...extra,
});
const read = (f: ImportField, text: string, options = {}) => readCell(f, text, options);

describe('an empty cell', () => {
  it('is no value, whatever the type', () => {
    for (const type of ['text', 'number', 'date', 'select', 'relation', 'boolean', 'rich_text']) {
      expect(read(field(type), '  ')).toEqual({ kind: 'empty' });
    }
  });
});

describe('text and the types that check their text', () => {
  it('trims text and phone, and lets the field check an email, an address and a currency', () => {
    expect(read(field('text'), '  Acme ')).toEqual({ kind: 'value', value: 'Acme' });
    expect(read(field('phone'), ' +40 21 123 ')).toEqual({ kind: 'value', value: '+40 21 123' });
    expect(read(field('email'), ' Jane@Example.COM ')).toEqual({ kind: 'value', value: 'jane@example.com' });
    expect(read(field('email'), 'jane')).toMatchObject({ kind: 'error', message: '"jane" is not an email address' });
    expect(read(field('url'), 'acme.com/about')).toMatchObject({ kind: 'value' });
    expect(read(field('url'), 'not a url')).toMatchObject({ kind: 'error' });
    expect(read(field('currency'), 'eur')).toEqual({ kind: 'value', value: 'EUR' });
    expect(read(field('currency'), 'euro')).toMatchObject({ kind: 'error' });
  });
});

describe('numbers', () => {
  const cases: [string, number | null][] = [
    ['42', 42],
    ['-42', -42],
    ['12.5', 12.5],
    ['1,234.50', 1234.5],
    ['1.234,50', 1234.5],
    ['1,234', 1234],
    ['1.234', 1234],
    ['1,5', 1.5],
    ['0,125', 0.125],
    ['0.125', 0.125],
    ['1,234,567', 1234567],
    ['1.234.567', 1234567],
    ['€ 1 200', 1200],
    ['$1,200.00', 1200],
    ['(12.50)', -12.5],
    ['-€5', -5],
    ['12 345,67', 12345.67],
    ['1,2,3.4', null],
    ['12,34,567', null],
    ['1.234.56', null],
    ['1,234.567,8', null],
    ['abc', null],
    ['', null],
    ['-', null],
  ];

  for (const [text, expected] of cases) {
    it(`reads ${JSON.stringify(text)} as ${expected}`, () => {
      expect(parseNumber(text)).toBe(expected);
    });
  }

  it('is a number for number and money, an error otherwise', () => {
    expect(read(field('number'), '1.234,5')).toEqual({ kind: 'value', value: 1234.5 });
    expect(read(field('money'), '$ 9.99')).toEqual({ kind: 'value', value: 9.99 });
    expect(read(field('number'), 'many')).toMatchObject({ kind: 'error', message: '"many" is not a number' });
  });
});

describe('yes and no', () => {
  it('reads the usual words in any case', () => {
    for (const yes of ['true', 'YES', 'y', '1', 'x']) {
      expect(read(field('boolean'), yes)).toEqual({ kind: 'value', value: true });
    }

    for (const no of ['false', 'No', 'n', '0']) {
      expect(read(field('boolean'), no)).toEqual({ kind: 'value', value: false });
    }

    expect(read(field('boolean'), 'maybe')).toMatchObject({ kind: 'error' });
  });
});

describe('dates', () => {
  it('reads ISO days, with any separator, and refuses what is not a day', () => {
    expect(read(field('date'), '2026-11-13')).toEqual({ kind: 'value', value: '2026-11-13' });
    expect(read(field('date'), '2026/1/3')).toEqual({ kind: 'value', value: '2026-01-03' });
    expect(read(field('date'), '2026-02-30')).toMatchObject({ kind: 'error' });
    expect(read(field('date'), 'tomorrow')).toMatchObject({ kind: 'error' });
  });

  it('will not guess the order of day and month, and reads it when told', () => {
    expect(read(field('date'), '03/04/2026')).toMatchObject({ kind: 'error' });
    expect((read(field('date'), '03/04/2026') as { message: string }).message).toContain('choose the order');
    expect(read(field('date'), '03/04/2026', { dateOrder: 'dmy' })).toEqual({ kind: 'value', value: '2026-04-03' });
    expect(read(field('date'), '03/04/2026', { dateOrder: 'mdy' })).toEqual({ kind: 'value', value: '2026-03-04' });
    expect(read(field('date'), '13.11.26', { dateOrder: 'dmy' })).toEqual({ kind: 'value', value: '2026-11-13' });
    expect(read(field('date'), '13/11/1975', { dateOrder: 'dmy' })).toEqual({ kind: 'value', value: '1975-11-13' });
    expect(read(field('date'), '13/11/2026', { dateOrder: 'mdy' })).toMatchObject({ kind: 'error' });
  });

  it('reads a date and time with an offset as it is, and without one in the time zone asked for', () => {
    const dt = field('date_time');
    expect(read(dt, '2026-11-13T10:30:00+02:00')).toEqual({ kind: 'value', value: '2026-11-13T08:30:00.000Z' });
    expect(read(dt, '2026-11-13 10:30Z')).toEqual({ kind: 'value', value: '2026-11-13T10:30:00.000Z' });
    expect(read(dt, '2026-11-13 10:30')).toEqual({ kind: 'value', value: '2026-11-13T10:30:00.000Z' });
    expect(read(dt, '2026-11-13 10:30', { timeZone: 'Europe/Bucharest' })).toEqual({
      kind: 'value',
      value: '2026-11-13T08:30:00.000Z',
    });
    // Summer time has another offset.
    expect(read(dt, '2026-07-13T10:30', { timeZone: 'Europe/Bucharest' })).toEqual({
      kind: 'value',
      value: '2026-07-13T07:30:00.000Z',
    });
    expect(read(dt, '13/11/2026 14:05', { dateOrder: 'dmy' })).toEqual({
      kind: 'value',
      value: '2026-11-13T14:05:00.000Z',
    });
    expect(read(dt, '2026-11-13')).toEqual({ kind: 'value', value: '2026-11-13T00:00:00.000Z' });
    expect(read(dt, '2026-11-13 25:00')).toMatchObject({ kind: 'error' });
    expect(read(dt, '13/11/2026 14:05')).toMatchObject({ kind: 'error' });
    expect(read(dt, '2026-11-13 10:30', { timeZone: 'Nowhere/Land' })).toMatchObject({ kind: 'error' });
  });
});

describe('selects', () => {
  const stage = field('select', {
    label: 'Stage',
    settings: {
      options: [
        { value: 'new', label: 'New lead' },
        { value: 'won', label: 'Won' },
      ],
    },
  });
  const tags = { ...stage, type: 'multi_select', label: 'Tags' };

  it('reads an option by its value or its label, in any case', () => {
    expect(read(stage, 'new')).toEqual({ kind: 'value', value: 'new' });
    expect(read(stage, ' new LEAD ')).toEqual({ kind: 'value', value: 'new' });
    expect(read(stage, 'WON')).toEqual({ kind: 'value', value: 'won' });
  });

  it('names the options when it is none of them', () => {
    const cell = read(stage, 'lost');
    expect(cell).toMatchObject({ kind: 'error' });
    expect((cell as { message: string }).message).toContain('New lead, Won');
  });

  it('takes any text for a select with no options', () => {
    expect(read(field('select'), ' anything ')).toEqual({ kind: 'value', value: 'anything' });
  });

  it('splits a multi-select on ; | or , and keeps each once', () => {
    expect(read(tags, 'new; Won|new , won')).toEqual({ kind: 'value', value: ['new', 'won'] });
    expect(read(tags, 'new; lost')).toMatchObject({ kind: 'error' });
  });
});

describe('relations, members, rich text and what cannot be filled', () => {
  it('leaves a relation and a member to be found', () => {
    expect(read(field('relation'), ' Acme ')).toEqual({ kind: 'lookup', text: 'Acme' });
    expect(read(field('member'), 'ada@example.com')).toEqual({ kind: 'lookup', text: 'ada@example.com' });
  });

  it('reads Markdown into the editor document', () => {
    const cell = read(field('rich_text'), 'Met **Ada**');
    expect(cell).toMatchObject({ kind: 'value', value: { type: 'doc' } });
  });

  it('refuses json and a type a module added', () => {
    expect(read(field('json'), '{}')).toMatchObject({ kind: 'error' });
    expect(read(field('lab.colour'), 'red')).toMatchObject({ kind: 'error' });
  });
});

describe('columns', () => {
  const fields = [
    { id: 'crm.person.first_name', name: 'first_name', label: 'First name', type: 'text' },
    { id: 'crm.person.email', name: 'email', label: 'Email', type: 'email' },
    { id: 'crm.person.data', name: 'data', label: 'Data', type: 'json' },
  ] satisfies ImportField[];

  it('matches a header to a field by label, API name or id, in any case and punctuation', () => {
    expect(matchColumns(['First Name', 'EMAIL', 'Phone'], fields).map((f) => f?.name ?? null)).toEqual([
      'first_name',
      'email',
      null,
    ]);
    expect(matchColumns(['first_name', 'crm.person.email'], fields).map((f) => f?.name)).toEqual([
      'first_name',
      'email',
    ]);
  });

  it('gives a field to the first column that names it, and none to a type that cannot be filled', () => {
    expect(matchColumns(['Email', 'email', 'Data'], fields).map((f) => f?.name ?? null)).toEqual(['email', null, null]);
  });

  it('knows a header row from a row of data', () => {
    expect(looksLikeHeader(['First name', 'Email'], fields)).toBe(true);
    expect(looksLikeHeader(['Full name', 'Where from'], fields)).toBe(true);
    expect(looksLikeHeader(['Ada', 'ada@example.com'], fields)).toBe(false);
    expect(looksLikeHeader(['Ada', '42'], fields)).toBe(false);
    expect(looksLikeHeader(['', ''], fields)).toBe(false);
  });
});
