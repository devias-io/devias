import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACTIONS } from '@devias/core';
import { expect, it } from 'vitest';
import { builtinAdapters } from '../src/tools/adapters';
import { builtinTools } from '../src/tools/builtin';

const dir = fileURLToPath(new URL('../src/tools/adapters/', import.meta.url));

it('keeps adapters to mapping and shaping: none imports the engine', () => {
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
    expect(readFileSync(`${dir}${file}`, 'utf8'), file).not.toMatch(/@devias\/data-engine/);
  }
});

it('serves only actions that exist and whose tool is generated from them', () => {
  const handWritten = new Set(builtinTools.map((tool) => tool.name));

  for (const id of Object.keys(builtinAdapters)) {
    const spec = ACTIONS.find((one) => one.id === id);

    expect(spec, id).toBeDefined();
    expect(spec?.ai.tool, id).not.toBeNull();
    expect(handWritten.has(spec?.ai.tool ?? ''), `${id} has a hand-written tool as well`).toBe(false);
  }
});
