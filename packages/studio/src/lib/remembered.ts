import { browserStorage } from './browser-storage';

/** A choice the person made earlier (a view, a filter), if it is one of `allowed`, else `fallback`. */
export const remembered = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const value = browserStorage('local')().getItem(key);

    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
};

/** Keeps a choice for next time. */
export const remember = (key: string, value: string) => {
  try {
    browserStorage('local')().setItem(key, value);
  } catch {
    // a view that is not remembered is still a view
  }
};
