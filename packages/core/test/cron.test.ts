import { describe, expect, it } from 'vitest';
import { cronMatches, cronProblem, nextCronTime, parseCron, previousCronTime } from '../src';

const at = (iso: string) => new Date(iso);
const iso = (date: Date | null) => date?.toISOString() ?? null;

describe('cron', () => {
  it('reads the five fields with lists, ranges and steps, and says what is wrong', () => {
    const schedule = parseCron('*/15 9-17 * * 1-5');
    expect([...schedule.minutes]).toEqual([0, 15, 30, 45]);
    expect([...schedule.hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...schedule.weekdays]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron('5/20 0 1,15 * 7').minutes]).toEqual([5, 25, 45]);
    // 7 is Sunday, like 0.
    expect([...parseCron('0 0 * * 7').weekdays]).toEqual([0]);
    expect(() => parseCron('0 3 * *')).toThrow('five fields');
    expect(() => parseCron('60 3 * * *')).toThrow('Cron minute "60" is not valid');
    expect(() => parseCron('0 3 * * mon')).toThrow('Cron day of week "mon"');
    expect(() => parseCron('*/0 * * * *')).toThrow('Cron minute');
    expect(() => parseCron('5-1 * * * *')).toThrow('Cron minute "5-1"');
  });

  it('matches minutes in UTC, either day field when both are set', () => {
    expect(cronMatches('0 3 * * *', at('2026-10-11T03:00:30Z'))).toBe(true);
    expect(cronMatches('0 3 * * *', at('2026-10-11T03:01:00Z'))).toBe(false);
    // The 13th, or any Friday: 2026-11-06 is a Friday, 2026-11-13 too, 2026-11-14 neither.
    expect(cronMatches('0 0 13 * 5', at('2026-11-06T00:00:00Z'))).toBe(true);
    expect(cronMatches('0 0 13 * 5', at('2026-11-13T00:00:00Z'))).toBe(true);
    expect(cronMatches('0 0 13 * 5', at('2026-11-14T00:00:00Z'))).toBe(false);
  });

  it('finds the next and the previous fire time across days, months and years', () => {
    expect(iso(nextCronTime('0 3 * * *', at('2026-10-11T02:59:59Z')))).toBe('2026-10-11T03:00:00.000Z');
    expect(iso(nextCronTime('0 3 * * *', at('2026-10-11T03:00:00Z')))).toBe('2026-10-12T03:00:00.000Z');
    expect(iso(nextCronTime('30 9 1 1 *', at('2026-10-11T00:00:00Z')))).toBe('2027-01-01T09:30:00.000Z');
    expect(iso(nextCronTime('0 0 29 2 *', at('2026-03-01T00:00:00Z')))).toBe('2028-02-29T00:00:00.000Z');
    expect(iso(previousCronTime('0 3 * * *', at('2026-10-11T03:00:45Z')))).toBe('2026-10-11T03:00:00.000Z');
    expect(iso(previousCronTime('0 3 * * *', at('2026-10-11T02:59:00Z')))).toBe('2026-10-10T03:00:00.000Z');
    expect(iso(previousCronTime('*/15 9-17 * * 1-5', at('2026-10-11T12:00:00Z')))).toBe('2026-10-09T17:45:00.000Z');
    expect(iso(previousCronTime('0 0 31 * *', at('2026-10-01T00:00:00Z')))).toBe('2026-08-31T00:00:00.000Z');
    // February 30th never comes.
    expect(nextCronTime('0 0 30 2 *', at('2026-01-01T00:00:00Z'))).toBeNull();
  });

  it('says why an expression cannot be a schedule, or nothing when it can', () => {
    expect(cronProblem('*/15 * * * *')).toBeNull();
    expect(cronProblem('0 9 * * 1-5')).toBeNull();
    // A leap day only comes every fourth year, but it comes.
    expect(cronProblem('0 0 29 2 *')).toBeNull();
    expect(cronProblem('0 3 * *')).toContain('five fields');
    expect(cronProblem('60 3 * * *')).toContain('Cron minute "60" is not valid');
    expect(cronProblem('')).toContain('five fields');
    expect(cronProblem('0 0 30 2 *')).toBe('Cron "0 0 30 2 *" never fires');
  });
});
