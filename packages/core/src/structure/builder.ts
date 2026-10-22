import type { PageDefinition } from '../config/types';
import type { ListBuilder, ListItemBuilder, StructureBuilder, StructureNode } from './nodes';

const isBuilder = (value: unknown): value is { build: () => StructureNode } =>
  typeof value === 'object' &&
  value !== null &&
  'build' in value &&
  typeof (value as { build: unknown }).build === 'function';

const toNode = (value: StructureNode | { build: () => StructureNode }): StructureNode =>
  isBuilder(value) ? value.build() : value;

let anonymousCounter = 0;
const anonymousId = (prefix: string) => `${prefix}-${++anonymousCounter}`;

const createListBuilder = (): ListBuilder => {
  const node: Extract<StructureNode, { kind: 'list' }> = { kind: 'list', id: anonymousId('list'), items: [] };
  const builder: ListBuilder = {
    label: (label) => {
      node.label = label;

      if (node.id.startsWith('list-')) {
        node.id = slug(label);
      }

      return builder;
    },
    id: (id) => {
      node.id = id;

      return builder;
    },
    items: (items) => {
      node.items = items.map((item) => toNode(item));

      return builder;
    },
    build: () => ({ ...node, items: [...node.items] }),
  };

  return builder;
};

const createListItemBuilder = (): ListItemBuilder => {
  const node: Extract<StructureNode, { kind: 'listItem' }> = { kind: 'listItem', id: anonymousId('item'), label: '' };
  const builder: ListItemBuilder = {
    id: (id) => {
      node.id = id;

      return builder;
    },
    label: (label) => {
      node.label = label;

      if (node.id.startsWith('item-')) {
        node.id = slug(label);
      }

      return builder;
    },
    icon: (icon) => {
      node.icon = icon;

      return builder;
    },
    href: (href) => {
      node.href = href;

      return builder;
    },
    child: (child) => {
      node.child = toNode(child);

      return builder;
    },
    build: () => ({ ...node }),
  };

  return builder;
};

export const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || anonymousId('node');

/**
 * Creates the `S` object handed to the studio's structure resolver. A page given as a component is registered as a
 * hidden page through `registerPage`, so everything routable is a page.
 */
export const createStructureBuilder = (registerPage: (page: PageDefinition) => void): StructureBuilder => ({
  list: createListBuilder,
  listItem: createListItemBuilder,
  divider: (label) => ({ kind: 'divider', id: anonymousId('divider'), ...(label ? { label } : {}) }),
  objectList: (object, opts) => ({
    kind: 'objectList',
    id: opts?.id ?? `object-${object}`,
    object,
    ...(opts?.view ? { view: opts.view } : {}),
    ...(opts?.label ? { label: opts.label } : {}),
    ...(opts?.icon ? { icon: opts.icon } : {}),
  }),
  view: (view, opts) => ({
    kind: 'view',
    id: opts?.id ?? `view-${slug(view)}`,
    view,
    ...(opts?.label ? { label: opts.label } : {}),
    ...(opts?.icon ? { icon: opts.icon } : {}),
  }),
  page: (target, opts) => {
    if (typeof target === 'string') {
      return {
        kind: 'page',
        id: opts?.id ?? `page-${slug(target)}`,
        pagePath: target,
        ...(opts?.label ? { label: opts.label } : {}),
        ...(opts?.icon ? { icon: opts.icon } : {}),
      };
    }

    const { id, label, icon, component } = target;
    const path = `component-${slug(id)}`;
    registerPage({ path, label, ...(icon ? { icon } : {}), component });

    return { kind: 'page', id, pagePath: path, label, ...(icon ? { icon } : {}) };
  },
  navItems: () => ({ kind: 'dynamic', id: 'nav-items', source: 'navItems' }),
  workspaceNav: () => ({ kind: 'dynamic', id: 'nav-items', source: 'navItems' }),
  objects: () => ({ kind: 'dynamic', id: 'all-objects', source: 'objects' }),
  favorites: () => ({ kind: 'dynamic', id: 'favorites', source: 'favorites' }),
});

/** Default sidebar when the studio does not provide a structure resolver. */
export const defaultStructure = (S: StructureBuilder): StructureNode =>
  S.list().id('root').items([S.navItems(), S.objects()]).build();

export const resolveStructureNode = (value: StructureNode | ListBuilder): StructureNode => toNode(value);

/** Depth-first walk, useful for validation and for finding a node by id. */
export const walkStructure = (
  node: StructureNode,
  visit: (node: StructureNode, depth: number) => void,
  depth = 0,
): void => {
  visit(node, depth);

  if (node.kind === 'list') {
    for (const item of node.items) {
      walkStructure(item, visit, depth + 1);
    }
  }

  if (node.kind === 'listItem' && node.child) {
    walkStructure(node.child, visit, depth + 1);
  }
};
