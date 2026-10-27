import { idListOf, idsInTree, isUuid } from '@devias/core';
import { expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { ids } from '../src/manifest/ids';

// The module's own id is no declaration of its manifest; everything else in `ids` is.
const { module: ownId, ...declared } = ids;

it('writes down exactly the ids the manifest declares, and the module under its own id', () => {
  expect(idsInTree(declared).sort()).toEqual(idListOf(manifest).sort());
  expect(manifest.id).toBe(ownId);
});

it('are uuids, each written once', () => {
  const written = idsInTree(ids);
  expect(written.filter((id) => !isUuid(id))).toEqual([]);
  expect(new Set(written).size).toBe(written.length);
});
