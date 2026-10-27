import { defineModule, defineNavItem, definePage } from '@devias/core';
import { ids } from './ids';

/**
 * The studio itself as a module: it declares no workspace objects, but it is listed, installed and reasoned about like
 * every other module, so there is one concept. Core: part of every workspace, never uninstalled. Its top rows (Home, Tasks, Documents, Workflows, Agents, Skills) are
 * pinned nav items: above the sections whatever the workspace arranged, and not arranged in Settings.
 */
export const manifest = defineModule({
  id: ids.module,
  version: '0.0.0',
  label: 'Studio',
  description: "The studio's own field types, views, blocks, pages, commands and settings.",
  icon: 'layout-dashboard',
  core: true,
  pages: [
    definePage({ id: ids.pages.home, label: 'Home', icon: 'house' }),
    definePage({ id: ids.pages.tasks, label: 'Tasks', icon: 'check-square' }),
    definePage({ id: ids.pages.documents, label: 'Documents', icon: 'file-text' }),
    definePage({ id: ids.pages.workflows, label: 'Workflows', icon: 'workflow' }),
    definePage({ id: ids.pages.agents, label: 'Agents', icon: 'bot' }),
    definePage({ id: ids.pages.skills, label: 'Skills', icon: 'book-open' }),
  ],
  navItems: [
    defineNavItem({
      id: ids.nav.home,
      label: 'Home',
      icon: 'house',
      target: { kind: 'page', pageId: ids.pages.home },
      position: -30,
      pinned: true,
    }),
    defineNavItem({
      id: ids.nav.tasks,
      label: 'Tasks',
      icon: 'check-square',
      target: { kind: 'page', pageId: ids.pages.tasks },
      position: -27,
      pinned: true,
    }),
    defineNavItem({
      id: ids.nav.documents,
      label: 'Documents',
      icon: 'file-text',
      target: { kind: 'page', pageId: ids.pages.documents },
      position: -25,
      pinned: true,
    }),
    defineNavItem({
      id: ids.nav.workflows,
      label: 'Workflows',
      icon: 'workflow',
      target: { kind: 'page', pageId: ids.pages.workflows },
      position: -20,
      pinned: true,
    }),
    defineNavItem({
      id: ids.nav.agents,
      label: 'Agents',
      icon: 'bot',
      target: { kind: 'page', pageId: ids.pages.agents },
      position: -10,
      pinned: true,
    }),
    defineNavItem({
      id: ids.nav.skills,
      label: 'Skills',
      icon: 'book-open',
      target: { kind: 'page', pageId: ids.pages.skills },
      position: -8,
      pinned: true,
    }),
  ],
});
