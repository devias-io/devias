/**
 * Keyboard shortcuts: single chords like `mod+k` and sequences like `g p`. Pure, so it is unit-testable;
 * the commands provider wires it to `window.keydown`.
 */

export interface KeyEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
}

export interface KeyBinding {
  /** e.g. `mod+k`, `g p`, `shift+?` */
  keys: string;
  run: () => void;
  /** Fire even when the user is typing in an input (default: only for chords with a modifier). */
  global?: boolean;
}

const MODIFIER_KEYS = new Set(['shift', 'meta', 'control', 'alt', 'os']);
const ALIASES: Record<string, string> = {
  cmd: 'mod',
  command: 'mod',
  meta: 'mod',
  ctrl: 'mod',
  control: 'mod',
  option: 'alt',
  esc: 'escape',
  ' ': 'space',
  return: 'enter',
};

const normalizeToken = (raw: string): string => {
  const parts = raw
    .toLowerCase()
    .split('+')
    .map((p) => ALIASES[p] ?? p)
    .filter(Boolean);
  const key = parts.filter((p) => p !== 'mod' && p !== 'alt' && p !== 'shift').at(-1) ?? '';
  const mods = ['mod', 'alt', 'shift'].filter((m) => parts.includes(m));

  return [...mods, key].join('+');
};

/** `"mod+k"` → `["mod+k"]`, `"g p"` → `["g", "p"]`. */
export const parseShortcut = (shortcut: string): string[] =>
  shortcut.trim().split(/\s+/).filter(Boolean).map(normalizeToken);

/** The chord token for a key event, or null for a lone modifier key. */
export const chordFromEvent = (event: KeyEventLike): string | null => {
  const key = event.key.toLowerCase();

  if (MODIFIER_KEYS.has(key)) {
    return null;
  }

  const mods: string[] = [];

  if (event.metaKey || event.ctrlKey) {
    mods.push('mod');
  }

  if (event.altKey) {
    mods.push('alt');
  }

  if (event.shiftKey && key.length > 1) {
    mods.push('shift');
  }

  return [...mods, ALIASES[key] ?? key].join('+');
};

export const isTypingTarget = (target: unknown): boolean => {
  if (!target || typeof target !== 'object') {
    return false;
  }

  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  };
  const tag = el.tagName?.toLowerCase();

  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return true;
  }

  if (el.isContentEditable) {
    return true;
  }

  return el.getAttribute?.('role') === 'textbox';
};

export interface SequenceMatcher {
  handle: (event: KeyEventLike) => boolean;
  reset: () => void;
}

export const createSequenceMatcher = (
  bindings: KeyBinding[],
  options: { timeoutMs?: number; now?: () => number } = {},
): SequenceMatcher => {
  const timeoutMs = options.timeoutMs ?? 1000;
  const now = options.now ?? (() => Date.now());
  const parsed = bindings.map((b) => ({ ...b, chords: parseShortcut(b.keys) })).filter((b) => b.chords.length > 0);
  let buffer: string[] = [];
  let lastAt = 0;

  const reset = () => {
    buffer = [];
  };

  const attempt = (sequence: string[], typing: boolean): 'match' | 'prefix' | 'none' => {
    let prefix = false;

    for (const binding of parsed) {
      if (typing && !binding.global && !binding.chords.every((c) => c.includes('mod+'))) {
        continue;
      }

      const startsWith = sequence.every((token, i) => binding.chords[i] === token);

      if (!startsWith) {
        continue;
      }

      if (binding.chords.length === sequence.length) {
        binding.run();

        return 'match';
      }

      prefix = true;
    }

    return prefix ? 'prefix' : 'none';
  };

  const handle = (event: KeyEventLike): boolean => {
    const token = chordFromEvent(event);

    if (!token) {
      return false;
    }

    const typing = isTypingTarget(event.target);
    const at = now();

    if (at - lastAt > timeoutMs) {
      buffer = [];
    }

    lastAt = at;
    buffer.push(token);
    let result = attempt(buffer, typing);

    if (result === 'none' && buffer.length > 1) {
      buffer = [token];
      result = attempt(buffer, typing);
    }

    if (result !== 'prefix') {
      reset();
    }

    return result !== 'none';
  };

  return { handle, reset };
};

/** Human-readable shortcut for menus: `mod+k` → `⌘K` on macOS, `Ctrl+K` elsewhere; `g p` → `G P`. */
export const formatShortcut = (shortcut: string, isMac = detectMac()): string =>
  parseShortcut(shortcut)
    .map((token) =>
      token
        .split('+')
        .map((part) => {
          if (part === 'mod') {
            return isMac ? '⌘' : 'Ctrl';
          }

          if (part === 'shift') {
            return isMac ? '⇧' : 'Shift';
          }

          if (part === 'alt') {
            return isMac ? '⌥' : 'Alt';
          }

          return part.length === 1 ? part.toUpperCase() : part;
        })
        .join(isMac ? '' : '+'),
    )
    .join(' ');

export const detectMac = (): boolean =>
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform ?? navigator.userAgent ?? '');
