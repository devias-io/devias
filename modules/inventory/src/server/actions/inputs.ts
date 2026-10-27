import { z } from 'zod';

/** Template-rendered inputs arrive as strings and a blank field as ''; treat blanks as absent. */
export const blank = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema.optional());

export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** Today as YYYY-MM-DD, in the server's time zone. */
export const today = (): string => {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
