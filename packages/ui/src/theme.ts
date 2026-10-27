import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'devias.theme';

/** Always go through window.localStorage: Node 25 exposes a non-functional global `localStorage`. */
const storage = (): Storage | undefined => (typeof window !== 'undefined' ? window.localStorage : undefined);
const listeners = new Set<() => void>();
/** In-memory copy so the preference survives when storage is unavailable or non-persistent. */
let memory: Theme | undefined;

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

export const getTheme = (): Theme => {
  if (memory) {
    return memory;
  }

  try {
    const stored = storage()?.getItem(STORAGE_KEY);

    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
};

const prefersDark = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

export const resolveTheme = (theme: Theme): ResolvedTheme =>
  theme === 'system' ? (prefersDark() ? 'dark' : 'light') : theme;

/** Persist the preference and toggle the `dark` class on <html>. Safe to call before React mounts. */
export const applyTheme = (theme: Theme): void => {
  memory = theme;

  try {
    storage()?.setItem(STORAGE_KEY, theme);
  } catch {
    // storage may be unavailable (private mode, sandboxed iframes)
  }

  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', resolveTheme(theme) === 'dark');
    document.documentElement.style.colorScheme = resolveTheme(theme);
  }

  notify();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const media = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
  const onMedia = () => {
    if (getTheme() === 'system') {
      applyTheme('system');
    }
  };
  media?.addEventListener('change', onMedia);

  return () => {
    listeners.delete(listener);
    media?.removeEventListener('change', onMedia);
  };
};

export const useTheme = () => {
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'system' as Theme);

  return { theme, resolvedTheme: resolveTheme(theme), setTheme: applyTheme };
};
