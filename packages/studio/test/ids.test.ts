import { idListOf, idsInTree, isUuid } from '@devias/core';
import { expect, it } from 'vitest';
import { ids } from '../src/ids';
import { manifest } from '../src/manifest';

// The studio's nav items and pages are what its manifest declares; its palette commands and providers are keys of the
// code it registers, so they are written down too but are not in the manifest.
const declared = { nav: ids.nav, pages: ids.pages };

it('writes down exactly the ids the manifest declares, and the studio under its own id', () => {
  expect(idsInTree(declared).sort()).toEqual(idListOf(manifest).sort());
  expect(manifest.id).toBe(ids.module);
});

it('are uuids, each written once', () => {
  const written = idsInTree(ids);
  expect(written.filter((id) => !isUuid(id))).toEqual([]);
  expect(new Set(written).size).toBe(written.length);
});
