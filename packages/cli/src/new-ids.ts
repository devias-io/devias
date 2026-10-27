import { newId } from '@devias/core';

/** The most `devias id` prints at once: a module's whole `ids.ts` is a few hundred. */
export const MAX_NEW_IDS = 1000;

/** `count` fresh ids, one per line: what a module author pastes into `ids.ts`. */
export const newIds = (count: number): string[] => {
  if (!Number.isInteger(count) || count < 1 || count > MAX_NEW_IDS) {
    throw new Error(`Ask for a whole number of ids from 1 to ${MAX_NEW_IDS}`);
  }

  return Array.from({ length: count }, () => newId());
};
