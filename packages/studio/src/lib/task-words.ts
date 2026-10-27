import { daysBetween } from '@devias/core';

const shortDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/** "Oct 22" for a `YYYY-MM-DD`. */
export const dayOf = (date: string): string => shortDay.format(new Date(`${date}T00:00:00`));

/** "Due today", "Due in 3 days", "2 days overdue", from two `YYYY-MM-DD` dates. */
export const dueWords = (date: string, today: string): string => {
  const days = daysBetween(today, date);

  if (days === 0) {
    return 'Due today';
  }

  if (days === 1) {
    return 'Due tomorrow';
  }

  if (days > 1) {
    return `Due in ${days} days`;
  }

  return days === -1 ? '1 day overdue' : `${-days} days overdue`;
};
