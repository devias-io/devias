import { idListOf, idsInTree } from '@devias/core';
import { expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { ids } from '../src/manifest/ids';

it('writes down exactly the ids the manifest declares', () => {
  expect(idsInTree(ids).sort()).toEqual(idListOf(manifest).sort());
});
