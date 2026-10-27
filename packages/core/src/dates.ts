/** Calendar dates the way `date` fields keep them: YYYY-MM-DD, in local time. */

/** YYYY-MM-DD in local time, the format of `date` fields. */
export const localDate = (date: Date): string =>
  [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');

/** Whole days from one YYYY-MM-DD to another. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** Monday 00:00 of the week `now` falls in, local time. */
export const startOfWeek = (now: Date): Date => {
  const start = new Date(now);

  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  start.setHours(0, 0, 0, 0);

  return start;
};
