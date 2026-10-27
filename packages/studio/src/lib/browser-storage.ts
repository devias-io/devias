import type { StateStorage } from 'zustand/middleware';

const memoryStorage = (): StateStorage => {
  const map = new Map<string, string>();

  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

/**
 * The browser's local or session storage for zustand's `persist`, or memory when it is unavailable (Node 25 exposes
 * non-functional globals, so always go through `window`).
 */
export const browserStorage = (kind: 'local' | 'session') => (): StateStorage => {
  try {
    const storage = typeof window !== 'undefined' ? window[`${kind}Storage`] : undefined;

    if (storage) {
      storage.getItem('devias.studio.probe');

      return storage;
    }
  } catch {
    // fall through
  }

  return memoryStorage();
};
