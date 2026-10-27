/**
 * A cron expression the way a person says it. The editor offers these; an expression that is none of them is
 * `custom`. Every time is UTC, as cron is read everywhere in Devias.
 */
export type Schedule =
  | { kind: 'minutes'; every: number }
  | { kind: 'hours'; every: number; minute: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; days: number[]; hour: number; minute: number }
  | { kind: 'monthly'; day: number; hour: number; minute: number }
  | { kind: 'custom'; cron: string };

export type ScheduleKind = Schedule['kind'];

/** Steps that divide an hour or a day evenly, so the gap between two runs is always the same. */
export const MINUTE_STEPS = [1, 2, 5, 10, 15, 20, 30] as const;
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12] as const;

/** The days of the week as cron numbers them (Sunday is 0), Monday first. */
export const WEEKDAYS = [
  { value: 1, label: 'Mon', name: 'Monday' },
  { value: 2, label: 'Tue', name: 'Tuesday' },
  { value: 3, label: 'Wed', name: 'Wednesday' },
  { value: 4, label: 'Thu', name: 'Thursday' },
  { value: 5, label: 'Fri', name: 'Friday' },
  { value: 6, label: 'Sat', name: 'Saturday' },
  { value: 0, label: 'Sun', name: 'Sunday' },
] as const;

const pad = (value: number): string => String(value).padStart(2, '0');

/** `09:30`, for a time input and for words. */
export const clockText = (hour: number, minute: number): string => `${pad(hour)}:${pad(minute)}`;

const whole = (text: string, min: number, max: number): number | null => {
  if (!/^\d+$/.test(text)) {
    return null;
  }

  const value = Number(text);

  return value >= min && value <= max ? value : null;
};

/** `*` is every one, `*\/5` every fifth; only the steps in `steps` count. */
const stepOf = (text: string, steps: readonly number[]): number | null => {
  if (text === '*') {
    return 1;
  }

  const step = /^\*\/(\d+)$/.exec(text)?.[1];

  return step !== undefined && steps.includes(Number(step)) ? Number(step) : null;
};

/** The days a weekday field names (`1,3`, `1-5`), Sunday as 0 whether written 0 or 7; null when it is anything else. */
const weekdaysOf = (text: string): number[] | null => {
  const days = new Set<number>();

  for (const part of text.split(',')) {
    const range = /^([0-7])(?:-([0-7]))?$/.exec(part);

    if (!range) {
      return null;
    }

    const from = Number(range[1]);
    const to = range[2] === undefined ? from : Number(range[2]);

    if (from > to) {
      return null;
    }

    for (let day = from; day <= to; day++) {
      days.add(day % 7);
    }
  }

  return [...days].sort((a, b) => a - b);
};

/** `1,2,3,4,5` written `1-5`: runs of three or more days become a range. */
const weekdayField = (days: number[]): string => {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const parts: string[] = [];

  for (let i = 0; i < sorted.length; ) {
    let end = i;

    while (end + 1 < sorted.length && (sorted[end + 1] as number) === (sorted[end] as number) + 1) {
      end++;
    }

    const from = sorted[i] as number;
    const to = sorted[end] as number;

    if (end - i >= 2) {
      parts.push(`${from}-${to}`);
    } else {
      for (let k = i; k <= end; k++) {
        parts.push(String(sorted[k]));
      }
    }

    i = end + 1;
  }

  return parts.join(',');
};

/** The preset an expression is, or `custom` when it is any other. */
export const scheduleOf = (cron: string): Schedule => {
  const custom: Schedule = { kind: 'custom', cron };
  const parts = cron.trim().split(/\s+/);

  if (parts.length !== 5) {
    return custom;
  }

  const [minute, hour, day, month, weekday] = parts as [string, string, string, string, string];

  if (month !== '*') {
    return custom;
  }

  if (day === '*' && weekday === '*') {
    if (hour === '*') {
      const every = stepOf(minute, MINUTE_STEPS);

      if (every !== null) {
        return { kind: 'minutes', every };
      }
    }

    const at = whole(minute, 0, 59);

    if (at === null) {
      return custom;
    }

    const every = stepOf(hour, HOUR_STEPS);

    if (every !== null) {
      return { kind: 'hours', every, minute: at };
    }

    const when = whole(hour, 0, 23);

    return when === null ? custom : { kind: 'daily', hour: when, minute: at };
  }

  const at = whole(minute, 0, 59);
  const when = whole(hour, 0, 23);

  if (at === null || when === null) {
    return custom;
  }

  if (day === '*') {
    const days = weekdaysOf(weekday);

    return days ? { kind: 'weekly', days, hour: when, minute: at } : custom;
  }

  if (weekday === '*') {
    const date = whole(day, 1, 31);

    return date === null ? custom : { kind: 'monthly', day: date, hour: when, minute: at };
  }

  return custom;
};

/** The expression a preset stands for. */
export const cronOf = (schedule: Schedule): string => {
  switch (schedule.kind) {
    case 'minutes':
      return schedule.every === 1 ? '* * * * *' : `*/${schedule.every} * * * *`;
    case 'hours':
      return `${schedule.minute} ${schedule.every === 1 ? '*' : `*/${schedule.every}`} * * *`;
    case 'daily':
      return `${schedule.minute} ${schedule.hour} * * *`;
    case 'weekly':
      return `${schedule.minute} ${schedule.hour} * * ${weekdayField(schedule.days)}`;
    case 'monthly':
      return `${schedule.minute} ${schedule.hour} ${schedule.day} * *`;
    case 'custom':
      return schedule.cron;
  }
};

/** What a person picks when they change how often it runs: the time of day and the minute carry over. */
export const scheduleOfKind = (kind: Exclude<ScheduleKind, 'custom'>, from: Schedule): Schedule => {
  const hour = 'hour' in from ? from.hour : 9;
  const minute = 'minute' in from ? from.minute : 0;

  switch (kind) {
    case 'minutes':
      return { kind, every: 15 };
    case 'hours':
      return { kind, every: 1, minute };
    case 'daily':
      return { kind, hour, minute };
    case 'weekly':
      return { kind, days: [1], hour, minute };
    case 'monthly':
      return { kind, day: 1, hour, minute };
  }
};

const ordinal = (value: number): string => {
  const tens = value % 100;

  if (tens >= 11 && tens <= 13) {
    return `${value}th`;
  }

  return `${value}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] ?? 'th'}`;
};

const joinNames = (names: string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** `Weekdays`, `Every Monday and Friday`. */
const describeDays = (days: number[]): string => {
  const set = new Set(days);
  const same = (wanted: number[]) => set.size === wanted.length && wanted.every((day) => set.has(day));

  if (set.size === 7) {
    return 'Every day';
  }

  if (same([1, 2, 3, 4, 5])) {
    return 'Weekdays';
  }

  if (same([6, 0])) {
    return 'Weekends';
  }

  return `Every ${joinNames(WEEKDAYS.filter((day) => set.has(day.value)).map((day) => day.name))}`;
};

/** One line saying when an expression runs: `Every 15 minutes`, `Weekdays at 09:00 UTC`. */
export const describeSchedule = (cron: string): string => {
  const schedule = scheduleOf(cron);

  switch (schedule.kind) {
    case 'minutes':
      return schedule.every === 1 ? 'Every minute' : `Every ${schedule.every} minutes`;
    case 'hours': {
      const every = schedule.every === 1 ? 'Every hour' : `Every ${schedule.every} hours`;

      return schedule.minute === 0 ? every : `${every} at :${pad(schedule.minute)}`;
    }
    case 'daily':
      return `Every day at ${clockText(schedule.hour, schedule.minute)} UTC`;
    case 'weekly':
      return `${describeDays(schedule.days)} at ${clockText(schedule.hour, schedule.minute)} UTC`;
    case 'monthly':
      return `On the ${ordinal(schedule.day)} of every month at ${clockText(schedule.hour, schedule.minute)} UTC`;
    case 'custom':
      return `On the schedule ${schedule.cron} (UTC)`;
  }
};
