import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/main';
import { MAX_NEW_IDS, newIds } from '../src/new-ids';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('devias id', () => {
  it('makes as many distinct uuids as asked for', () => {
    const ids = newIds(200);
    expect(ids).toHaveLength(200);
    expect(new Set(ids).size).toBe(200);
    expect(ids.every((id) => UUID_V7.test(id))).toBe(true);
  });

  it('refuses a count that is not a whole number from 1 to the most', () => {
    for (const count of [0, -1, 1.5, Number.NaN, MAX_NEW_IDS + 1]) {
      expect(() => newIds(count), String(count)).toThrow('whole number');
    }
  });

  it('is a command of the program', () => {
    expect(buildProgram().commands.map((command) => command.name())).toContain('id');
  });
});
