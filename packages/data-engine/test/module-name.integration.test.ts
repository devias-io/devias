import { parseManifest } from '@devias/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toInstalledModule } from '../src/metadata/rows';
import { createTestEngine, type TestEngine } from './helpers/db';

describe('the name of an installed module', () => {
  let t: TestEngine;
  beforeAll(async () => {
    t = await createTestEngine({ seed: false });
  });
  afterAll(() => t.close());

  const nameOf = async (moduleId: string) => {
    const snapshot = await t.engine.metadata.getSnapshot(t.workspaceId);

    return snapshot.schema.modules.find((module) => module.moduleId === moduleId)?.name;
  };

  it('is the one the manifest gives, or its id', async () => {
    await t.engine.modules.apply(t.owner, parseManifest({ id: 'plain', version: '0.1.0' }));
    await t.engine.modules.apply(t.owner, parseManifest({ id: 'named', version: '0.1.0', name: 'A named one' }));
    expect(await nameOf('plain')).toBe('plain');
    expect(await nameOf('named')).toBe('A named one');
  });

  it('is the id for a manifest stored before it had one, which then reads bare', () => {
    const row = {
      moduleId: 'old',
      version: '0.1.0',
      manifestHash: 'h',
      installedAt: new Date(),
      updatedAt: new Date(),
      manifest: { id: 'old', displayName: 'Old name', actions: [{ id: 'old.go', label: 'Go' }] },
    } as unknown as Parameters<typeof toInstalledModule>[0];
    expect(toInstalledModule(row)).toMatchObject({ moduleId: 'old', name: 'old', actions: [], connections: [] });
  });
});
