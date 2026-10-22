/**
 * Five-field cron expressions (minute hour day-of-month month day-of-week), read in UTC, for module schedules. Each
 * field takes `*`, numbers, lists (`1,15`), ranges (`1-5`) and steps (`*\/15`, `0-30/10`, `5/10`). Day of week runs
 * 0-7, with both 0 and 7 Sunday. When both day fields are restricted, a day matching either one counts, as in classic
 * cron.
 */
export interface CronSchedule {
  expression: string;
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  daysRestricted: boolean;
  weekdaysRestricted: boolean;
}

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
] as const;

const parseField = (text: string, field: (typeof FIELDS)[number]): Set<number> => {
  const values = new Set<number>();
  const bad = (part: string) => new Error(`Cron ${field.name} "${part}" is not valid (${field.min}-${field.max})`);

  for (const part of text.split(',')) {
    const [range = '', stepText, extra] = part.split('/');

    if (extra !== undefined) {
      throw bad(part);
    }

    const step = stepText === undefined ? 1 : Number(stepText);

    if (!Number.isInteger(step) || step < 1) {
      throw bad(part);
    }

    let from: number;
    let to: number;

    if (range === '*') {
      from = field.min;
      to = field.max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      from = Number(a);
      to = Number(b);
    } else {
      from = Number(range);
      // `5/10` runs from 5 to the end of the field.
      to = stepText === undefined ? from : field.max;
    }

    if (
      range === '' ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < field.min ||
      to > field.max ||
      from > to
    ) {
      throw bad(part);
    }

    for (let value = from; value <= to; value += step) {
      values.add(field.name === 'day of week' && value === 7 ? 0 : value);
    }
  }

  return values;
};

/** Parse an expression, or throw saying what is wrong with it. */
export const parseCron = (expression: string): CronSchedule => {
  const parts = expression.trim().split(/\s+/);

  if (parts.length !== 5) {
    throw new Error(`Cron expressions have five fields (minute hour day month weekday): "${expression}"`);
  }

  const [minutes, hours, days, months, weekdays] = parts.map((part, i) => parseField(part, FIELDS[i] as never));

  return {
    expression,
    minutes: minutes as Set<number>,
    hours: hours as Set<number>,
    days: days as Set<number>,
    months: months as Set<number>,
    weekdays: weekdays as Set<number>,
    daysRestricted: parts[2] !== '*',
    weekdaysRestricted: parts[4] !== '*',
  };
};

const scheduleOf = (schedule: CronSchedule | string): CronSchedule =>
  typeof schedule === 'string' ? parseCron(schedule) : schedule;

const dayMatches = (schedule: CronSchedule, date: Date): boolean => {
  const day = schedule.days.has(date.getUTCDate());
  const weekday = schedule.weekdays.has(date.getUTCDay());

  if (schedule.daysRestricted && schedule.weekdaysRestricted) {
    return day || weekday;
  }

  if (schedule.daysRestricted) {
    return day;
  }

  if (schedule.weekdaysRestricted) {
    return weekday;
  }

  return true;
};

/** Does the schedule fire in the minute `date` falls in? */
export const cronMatches = (schedule: CronSchedule | string, date: Date): boolean => {
  const s = scheduleOf(schedule);

  return (
    s.minutes.has(date.getUTCMinutes()) &&
    s.hours.has(date.getUTCHours()) &&
    s.months.has(date.getUTCMonth() + 1) &&
    dayMatches(s, date)
  );
};

/** Enough steps to cross several years of a sparse schedule; an impossible one (February 30th) gives up. */
const MAX_STEPS = 50_000;

/** The latest minute at or before `at` the schedule fires in, or null when it never does. */
export const previousCronTime = (schedule: CronSchedule | string, at: Date): Date | null => {
  const s = scheduleOf(schedule);
  const t = new Date(at.getTime());
  t.setUTCSeconds(0, 0);

  for (let step = 0; step < MAX_STEPS; step++) {
    if (!s.months.has(t.getUTCMonth() + 1)) {
      // The last minute of the month before.
      t.setUTCDate(1);
      t.setUTCHours(0, -1, 0, 0);
    } else if (!dayMatches(s, t)) {
      t.setUTCHours(0, -1, 0, 0);
    } else if (!s.hours.has(t.getUTCHours())) {
      t.setUTCMinutes(-1, 0, 0);
    } else if (!s.minutes.has(t.getUTCMinutes())) {
      t.setUTCMinutes(t.getUTCMinutes() - 1, 0, 0);
    } else {
      return t;
    }
  }

  return null;
};

/** The first minute after `after` the schedule fires in, or null when it never does. */
export const nextCronTime = (schedule: CronSchedule | string, after: Date): Date | null => {
  const s = scheduleOf(schedule);
  const t = new Date(after.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);

  for (let step = 0; step < MAX_STEPS; step++) {
    if (!s.months.has(t.getUTCMonth() + 1)) {
      t.setUTCMonth(t.getUTCMonth() + 1, 1);
      t.setUTCHours(0, 0, 0, 0);
    } else if (!dayMatches(s, t)) {
      t.setUTCDate(t.getUTCDate() + 1);
      t.setUTCHours(0, 0, 0, 0);
    } else if (!s.hours.has(t.getUTCHours())) {
      t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0);
    } else if (!s.minutes.has(t.getUTCMinutes())) {
      t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0);
    } else {
      return t;
    }
  }

  return null;
};
