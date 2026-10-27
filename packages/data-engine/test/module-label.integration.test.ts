import { parseManifest } from '@devias/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toInstalledModule } from '../src/metadata/rows';
import { createTestEngine, type TestEngine } from './helpers/db';

describe('the label of an installed module', () => {
  let t: TestEngine;
  beforeAll(async () => {
    t = await createTestEngine({ seed: false });
  });
  afterAll(() => t.close());

  const labelOf = async (moduleId: string) => {
    const snapshot = await t.engine.metadata.getSnapshot(t.workspaceId);

    return snapshot.schema.modules.find((module) => module.id === moduleId)?.label;
  };

  it('is the one the manifest gives, or its id', async () => {
    await t.engine.modules.apply(
      t.owner,
      parseManifest({ id: '01a1751f-5f05-7675-8a95-6259e0501ad4', version: '0.1.0' }),
    );
    await t.engine.modules.apply(
      t.owner,
      parseManifest({ id: '01a1751f-5f0d-769d-975f-6888901e069a', version: '0.1.0', label: 'A named one' }),
    );
    expect(await labelOf('01a1751f-5f05-7675-8a95-6259e0501ad4')).toBe('01a1751f-5f05-7675-8a95-6259e0501ad4');
    expect(await labelOf('01a1751f-5f0d-769d-975f-6888901e069a')).toBe('A named one');
  });

  it('is the id for a manifest stored before it had one, which then reads bare', () => {
    const row = {
      id: '01a1751f-5f0e-7530-b194-c6df0b20336a',
      version: '0.1.0',
      manifestHash: 'h',
      installedAt: new Date(),
      updatedAt: new Date(),
      manifest: {
        id: '01a1751f-5f0e-7530-b194-c6df0b20336a',
        displayName: 'Old name',
        actions: [{ id: '01a1751f-5f0d-769d-975f-65e4c98e7efc', label: 'Go' }],
      },
    } as unknown as Parameters<typeof toInstalledModule>[0];
    expect(toInstalledModule(row)).toMatchObject({
      id: '01a1751f-5f0e-7530-b194-c6df0b20336a',
      label: '01a1751f-5f0e-7530-b194-c6df0b20336a',
      actions: [],
      connections: [],
    });
  });
});
