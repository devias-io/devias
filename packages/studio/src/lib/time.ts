import { formatDistanceToNowStrict } from 'date-fns';

/** How long ago something happened: "just now", "5 minutes ago". */
export const ago = (at: string | Date): string => {
  const date = typeof at === 'string' ? new Date(at) : at;

  return Date.now() - date.getTime() < 60_000 ? 'just now' : `${formatDistanceToNowStrict(date)} ago`;
};

/** When something is next due: "in 5 hours", or "now" once it is. */
export const due = (at: string | Date): string => {
  const date = typeof at === 'string' ? new Date(at) : at;

  return date.getTime() - Date.now() < 60_000 ? 'now' : formatDistanceToNowStrict(date, { addSuffix: true });
};
