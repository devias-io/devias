import { modules } from 'virtual:devias/modules';
import { defineStudio } from '@devias/core';
import { agentImages } from './agent-images';

/**
 * The studio: its modules come from `devias.config.ts` (the studio's own first). Customize it here: the title, the
 * sidebar structure, or contributions of your own (`fieldTypes`, `blocks`, `overrides`, …), which merge last.
 */
export const studioConfig = defineStudio({
  name: 'default',
  title: 'Devias',
  modules,
  structure: (S) => S.list().items([S.navItems()]),
  agentImages,
  contact: { href: `mailto:contact@devias.io?${new URLSearchParams({ subject: 'Hello from Devias' })}` },
  dev: { autoApplyModules: import.meta.env.DEV },
});

export default studioConfig;
