import { describe, expect, it, vi } from 'vitest';
import { chordFromEvent, createSequenceMatcher, formatShortcut, parseShortcut } from '../src/commands/keybindings';

describe('keybindings', () => {
  it('parses shortcuts into normalized chords', () => {
    expect(parseShortcut('mod+k')).toEqual(['mod+k']);
    expect(parseShortcut('Cmd+Shift+P')).toEqual(['mod+shift+p']);
    expect(parseShortcut('g p')).toEqual(['g', 'p']);
    expect(chordFromEvent({ key: 'K', metaKey: true })).toBe('mod+k');
    expect(chordFromEvent({ key: 'Shift', shiftKey: true })).toBeNull();
    expect(formatShortcut('mod+k', true)).toBe('⌘K');
    expect(formatShortcut('g p', false)).toBe('G P');
  });

  it('matches single chords and multi-key sequences within the timeout', () => {
    let now = 0;
    const open = vi.fn();
    const goPeople = vi.fn();
    const goProjects = vi.fn();
    const matcher = createSequenceMatcher(
      [
        { keys: 'mod+k', run: open, global: true },
        { keys: 'g p', run: goPeople },
        { keys: 'g r', run: goProjects },
      ],
      { timeoutMs: 500, now: () => now },
    );
    expect(matcher.handle({ key: 'k', metaKey: true })).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);

    expect(matcher.handle({ key: 'g' })).toBe(true); // prefix of two bindings
    now = 100;
    expect(matcher.handle({ key: 'p' })).toBe(true);
    expect(goPeople).toHaveBeenCalledTimes(1);
    expect(goProjects).not.toHaveBeenCalled();

    matcher.handle({ key: 'g' });
    now = 2000; // timed out
    expect(matcher.handle({ key: 'r' })).toBe(false);
    expect(goProjects).not.toHaveBeenCalled();

    expect(matcher.handle({ key: 'x' })).toBe(false);
    expect(matcher.handle({ key: 'g' })).toBe(true);
    expect(matcher.handle({ key: 'r' })).toBe(true);
    expect(goProjects).toHaveBeenCalledTimes(1);
  });

  it('ignores plain keys while typing but keeps global modifier chords', () => {
    const open = vi.fn();
    const goPeople = vi.fn();
    const matcher = createSequenceMatcher([
      { keys: 'mod+k', run: open, global: true },
      { keys: 'g p', run: goPeople },
    ]);
    const input = { tagName: 'INPUT' };
    expect(matcher.handle({ key: 'g', target: input })).toBe(false);
    expect(matcher.handle({ key: 'p', target: input })).toBe(false);
    expect(goPeople).not.toHaveBeenCalled();
    expect(matcher.handle({ key: 'k', ctrlKey: true, target: input })).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
