// Types for what the `devias()` Vite plugin generates. Reference it from the app's `vite-env.d.ts`:
// /// <reference types="@devias/studio/client" />

declare module 'virtual:devias/modules' {
  import type { ModuleManifest, StudioModule } from '@devias/core';

  /** The studio side of every module in `devias.config.ts`, the studio's own first: what `defineStudio` lists. */
  export const modules: StudioModule[];
  /** The manifest of every module in `devias.config.ts`, server-only ones included: what the mock backend serves. */
  export const manifests: ModuleManifest[];
}
