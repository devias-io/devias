import type { ResolvedStudioConfig } from '../config/types';

export type StructureNode =
  | { kind: 'list'; id: string; label?: string; items: StructureNode[] }
  | { kind: 'listItem'; id: string; label: string; icon?: string; child?: StructureNode; href?: string }
  | { kind: 'objectList'; id: string; object: string; view?: string; label?: string; icon?: string }
  | { kind: 'view'; id: string; view: string; label?: string; icon?: string }
  | { kind: 'page'; id: string; pagePath: string; label?: string; icon?: string }
  | { kind: 'divider'; id: string; label?: string }
  | { kind: 'dynamic'; id: string; source: 'navItems' | 'objects' | 'favorites' };

export interface StructureContext {
  config: Pick<ResolvedStudioConfig, 'registries' | 'name'>;
}

export interface ListBuilder {
  label: (label: string) => ListBuilder;
  id: (id: string) => ListBuilder;
  items: (items: (StructureNode | ListBuilder | ListItemBuilder)[]) => ListBuilder;
  build: () => StructureNode;
}

export interface ListItemBuilder {
  id: (id: string) => ListItemBuilder;
  label: (label: string) => ListItemBuilder;
  icon: (icon: string) => ListItemBuilder;
  href: (href: string) => ListItemBuilder;
  child: (child: StructureNode | ListBuilder) => ListItemBuilder;
  build: () => StructureNode;
}

export interface StructureBuilder {
  list: () => ListBuilder;
  listItem: () => ListItemBuilder;
  divider: (label?: string) => StructureNode;
  objectList: (object: string, opts?: { view?: string; label?: string; icon?: string; id?: string }) => StructureNode;
  view: (view: string, opts?: { label?: string; icon?: string; id?: string }) => StructureNode;
  /**
   * A row for a page, by path. Given a component instead of a path it registers a hidden page for the component and
   * returns a row pointing at it.
   */
  page: (
    target: string | { id: string; label: string; icon?: string; component: import('react').ComponentType },
    opts?: { label?: string; icon?: string; id?: string },
  ) => StructureNode;
  /** The nav items stored with the workspace: the sections and rows modules install, and its own. */
  navItems: () => StructureNode;
  /** @deprecated Use `navItems`. */
  workspaceNav: () => StructureNode;
  objects: () => StructureNode;
  favorites: () => StructureNode;
}

export type StructureResolver = (S: StructureBuilder, ctx: StructureContext) => StructureNode | ListBuilder;
