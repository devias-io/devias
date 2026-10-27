import { describe, expect, it } from 'vitest';
import { cronOf, describeSchedule, type Schedule, scheduleOf, scheduleOfKind } from '../src/pages/workflows/schedule';

describe('schedule presets', () => {
  it('reads an expression as the preset a person would pick, and writes it back the same', () => {
    const presets: [string, Schedule][] = [
      ['* * * * *', { kind: 'minutes', every: 1 }],
      ['*/15 * * * *', { kind: 'minutes', every: 15 }],
      ['0 * * * *', { kind: 'hours', every: 1, minute: 0 }],
      ['30 */2 * * *', { kind: 'hours', every: 2, minute: 30 }],
      ['0 9 * * *', { kind: 'daily', hour: 9, minute: 0 }],
      ['30 18 * * 1-5', { kind: 'weekly', days: [1, 2, 3, 4, 5], hour: 18, minute: 30 }],
      ['0 10 * * 0,6', { kind: 'weekly', days: [0, 6], hour: 10, minute: 0 }],
      ['0 9 * * 1,3,5', { kind: 'weekly', days: [1, 3, 5], hour: 9, minute: 0 }],
      ['0 9 15 * *', { kind: 'monthly', day: 15, hour: 9, minute: 0 }],
    ];

    for (const [cron, schedule] of presets) {
      expect(scheduleOf(cron), cron).toEqual(schedule);
      expect(cronOf(schedule), cron).toBe(cron);
    }
  });

  it('writes the same schedule one way, whatever way it was written', () => {
    expect(cronOf(scheduleOf('*/1 * * * *'))).toBe('* * * * *');
    expect(cronOf(scheduleOf('0 */1 * * *'))).toBe('0 * * * *');
    // Sunday is 0 or 7.
    expect(cronOf(scheduleOf('0 9 * * 7'))).toBe('0 9 * * 0');
    expect(cronOf(scheduleOf('0 9 * * 5,1,3'))).toBe('0 9 * * 1,3,5');
    expect(cronOf({ kind: 'weekly', days: [0, 1, 2, 3], hour: 9, minute: 0 })).toBe('0 9 * * 0-3');
    // Two days in a row are a list, three or more a range.
    expect(cronOf({ kind: 'weekly', days: [1, 2], hour: 9, minute: 0 })).toBe('0 9 * * 1,2');
  });

  it('leaves what no preset says as custom', () => {
    for (const cron of [
      // The gaps are not even: 0 and 45, every hour.
      '*/45 * * * *',
      '*/7 * * * *',
      '0 */5 * * *',
      '0 9-17 * * *',
      '0,30 9 * * *',
      '0 9 * 6 *',
      // A day of the month and a day of the week: either one counts.
      '0 9 1 * 1',
      '0 9 * * mon',
      '5-1 * * * *',
      '0 9 * *',
      'every day',
      '',
    ]) {
      expect(scheduleOf(cron), cron).toEqual({ kind: 'custom', cron });
    }
  });

  it('carries the time of day over when the kind changes', () => {
    const evening: Schedule = { kind: 'daily', hour: 18, minute: 30 };
    expect(scheduleOfKind('weekly', evening)).toEqual({ kind: 'weekly', days: [1], hour: 18, minute: 30 });
    expect(scheduleOfKind('monthly', evening)).toEqual({ kind: 'monthly', day: 1, hour: 18, minute: 30 });
    expect(scheduleOfKind('hours', evening)).toEqual({ kind: 'hours', every: 1, minute: 30 });
    expect(scheduleOfKind('minutes', evening)).toEqual({ kind: 'minutes', every: 15 });
    // Nothing to carry: nine in the morning.
    expect(scheduleOfKind('daily', { kind: 'minutes', every: 5 })).toEqual({ kind: 'daily', hour: 9, minute: 0 });
    expect(scheduleOfKind('daily', { kind: 'custom', cron: 'x' })).toEqual({ kind: 'daily', hour: 9, minute: 0 });
  });
});

describe('describeSchedule', () => {
  it('says when it runs in words', () => {
    const words: [string, string][] = [
      ['* * * * *', 'Every minute'],
      ['*/15 * * * *', 'Every 15 minutes'],
      ['0 * * * *', 'Every hour'],
      ['30 * * * *', 'Every hour at :30'],
      ['5 */6 * * *', 'Every 6 hours at :05'],
      ['0 9 * * *', 'Every day at 09:00 UTC'],
      ['0 9 * * 0-6', 'Every day at 09:00 UTC'],
      ['30 18 * * 1-5', 'Weekdays at 18:30 UTC'],
      ['0 10 * * 0,6', 'Weekends at 10:00 UTC'],
      ['0 9 * * 1', 'Every Monday at 09:00 UTC'],
      ['0 9 * * 1,5', 'Every Monday and Friday at 09:00 UTC'],
      ['0 9 * * 1,3,5', 'Every Monday, Wednesday and Friday at 09:00 UTC'],
      ['0 9 * * 0', 'Every Sunday at 09:00 UTC'],
      ['0 9 1 * *', 'On the 1st of every month at 09:00 UTC'],
      ['0 9 2 * *', 'On the 2nd of every month at 09:00 UTC'],
      ['0 9 3 * *', 'On the 3rd of every month at 09:00 UTC'],
      ['0 9 11 * *', 'On the 11th of every month at 09:00 UTC'],
      ['0 9 22 * *', 'On the 22nd of every month at 09:00 UTC'],
      ['0 9 31 * *', 'On the 31st of every month at 09:00 UTC'],
      ['0 9 1 * 1', 'On the schedule 0 9 1 * 1 (UTC)'],
    ];

    for (const [cron, text] of words) {
      expect(describeSchedule(cron), cron).toBe(text);
    }
  });
});
