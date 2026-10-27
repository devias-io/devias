import { describe, expect, it } from 'vitest';
import {
  defineModule,
  defineModuleStudio,
  manifestFrom,
  moduleOptionsOf,
  modulePackageOf,
  studioModuleFrom,
} from '../src';

const manifest = defineModule({ id: '01a1751f-5f0d-769d-975f-603c8bc7416f', version: '1.0.0', name: 'Acme' });
const acme = defineModuleStudio(manifest);

describe('devias.config entries', () => {
  it('reads a package name with or without options', () => {
    expect(modulePackageOf('@acme/mod')).toBe('@acme/mod');
    expect(moduleOptionsOf('@acme/mod')).toBeUndefined();
    expect(modulePackageOf({ package: '@acme/mod', options: { a: 1 } })).toBe('@acme/mod');
    expect(moduleOptionsOf({ package: '@acme/mod', options: { a: 1 } })).toEqual({ a: 1 });
  });

  it('takes the default export, else the only module among the named ones', () => {
    expect(studioModuleFrom({ default: acme, helper: () => 1 }, '@acme/mod')).toBe(acme);
    expect(studioModuleFrom({ acme, helper: () => 1, LABEL: 'x' }, '@acme/mod')).toBe(acme);
    expect(() => studioModuleFrom({ helper: () => 1 }, '@acme/mod')).toThrow(
      '"@acme/mod/studio" exports no module: export it as default',
    );
    const other = defineModuleStudio(
      defineModule({ id: '01a1751f-5f0f-73b8-8e84-3f002a154d9e', version: '1.0.0', name: 'Other' }),
    );
    expect(() => studioModuleFrom({ acme, other }, '@acme/mod')).toThrow('exports 2 modules');
  });

  it('finds the manifest as `manifest` or as the default export', () => {
    expect(manifestFrom({ manifest, ids: {} }, '@acme/mod')).toBe(manifest);
    expect(manifestFrom({ default: manifest }, '@acme/mod')).toBe(manifest);
    expect(() => manifestFrom({ ids: {} }, '@acme/mod')).toThrow('"@acme/mod/manifest" exports no module');
  });
});
