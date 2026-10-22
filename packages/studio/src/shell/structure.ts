import {
  type EffectiveNavItem,
  effectiveNavItem,
  objectByKey,
  objectIdOf,
  type PageDefinition,
  pageOfId,
  pageTitle,
  type SchemaIndex,
  type StructureNode,
} from '@devias/core';
import type { SidebarNavGroup, SidebarNavItem } from '@devias/ui';
import { isActiveHref, links, splitHref } from '../router/links';
import { navTargetHref, resolveViewParam } from './nav-targets';

export interface StructureResolveContext {
  index: SchemaIndex;
  pages: Map<string, PageDefinition>;
  slug: string;
  pathname: string;
  search: Record<string, unknown>;
}

const item = (
  ctx: StructureResolveContext,
  base: Omit<SidebarNavItem, 'active'> & { href?: string },
): SidebarNavItem => ({
  ...base,
  active: base.href ? isActiveHref(base.href, ctx.pathname, ctx.search) : undefined,
});

const navItemsToItems = (
  ctx: StructureResolveContext,
  navItems: EffectiveNavItem[],
  parentId: string | null,
  /** At the top level: the pinned rows (true) or the rest (false); sections only ever hold the rest. */
  pinned = false,
): SidebarNavItem[] =>
  navItems
    .filter((n) => (n.parentId ?? null) === parentId)
    .filter((n) => parentId !== null || Boolean(n.pinned) === pinned)
    // The workspace left it out of the sidebar (hiding a section hides what is under it).
    .filter((n) => !n.hidden)
    // A row for a deleted object would lead nowhere: skip it until it is removed.
    .filter((n) => {
      const object = objectIdOf(n.target);

      return object === undefined || objectByKey(ctx.index, object) !== undefined;
    })
    // Likewise a page this workspace does not have (its module is not installed).
    .filter((n) => n.target.kind !== 'page' || pageOfId(ctx.pages, n.target.pageId) !== undefined)
    .sort((a, b) => a.position - b.position)
    .flatMap((n) => {
      const children = navItemsToItems(ctx, navItems, n.id, false);

      // A group is only a heading for its children: with none left there is nothing to show.
      if (n.target.kind === 'group' && children.length === 0) {
        return [];
      }

      const target = navTargetHref(n.target, ctx.slug, ctx.index, ctx.pages);

      return item(ctx, {
        id: `nav-${n.id}`,
        label: n.label,
        icon: n.icon,
        ...(n.target.kind === 'group' ? {} : { href: target.href }),
        ...(children.length > 0 ? { children } : {}),
        ...(target.external && typeof window !== 'undefined'
          ? { onClick: () => window.open(target.href, '_blank', 'noopener') }
          : {}),
      });
    });

/** The pinned nav items, as rows to show above the sections, in position order. */
export const resolvePinned = (ctx: StructureResolveContext): SidebarNavItem[] =>
  navItemsToItems(ctx, ctx.index.schema.navItems.map(effectiveNavItem), null, true);

/** Maps one structure node to zero or more sidebar rows. Unknown objects/views/pages are skipped. */
export const nodeToItems = (node: StructureNode, ctx: StructureResolveContext): SidebarNavItem[] => {
  switch (node.kind) {
    case 'list':
      return node.items.flatMap((child) => nodeToItems(child, ctx));
    case 'listItem': {
      const children = node.child ? nodeToItems(node.child, ctx) : [];

      return [
        item(ctx, {
          id: node.id,
          label: node.label,
          icon: node.icon,
          href: node.href,
          ...(children.length > 0 ? { children } : {}),
        }),
      ];
    }
    case 'objectList': {
      const object = ctx.index.objectsByName.get(node.object) ?? ctx.index.objectsById.get(node.object);

      if (!object) {
        return [];
      }

      return [
        item(ctx, {
          id: node.id,
          label: node.label ?? object.labelPlural,
          icon: node.icon ?? object.icon,
          href: links.object(ctx.slug, object.nameSingular, resolveViewParam(ctx.index, node.view)),
        }),
      ];
    }
    case 'view': {
      const view = ctx.index.viewsById.get(node.view);
      const object = view ? ctx.index.objectsById.get(view.objectId) : undefined;

      if (!view || !object) {
        return [];
      }

      return [
        item(ctx, {
          id: node.id,
          label: node.label ?? view.label,
          icon: node.icon ?? view.icon ?? object.icon,
          href: links.object(ctx.slug, object.nameSingular, view.id),
        }),
      ];
    }
    case 'page': {
      const page = ctx.pages.get(node.pagePath);

      if (!page) {
        return [];
      }

      return [
        item(ctx, {
          id: node.id,
          label: node.label ?? pageTitle(ctx.pages, page.path) ?? page.path,
          icon: node.icon ?? page.icon ?? 'box',
          href: links.page(ctx.slug, page.path),
        }),
      ];
    }
    case 'divider':
      return [];
    case 'dynamic':
      if (node.source === 'navItems') {
        return navItemsToItems(ctx, ctx.index.schema.navItems.map(effectiveNavItem), null);
      }

      if (node.source === 'objects') {
        return ctx.index.schema.objects.map((object) =>
          item(ctx, {
            id: `object-${object.id}`,
            label: object.labelPlural,
            icon: object.icon ?? 'box',
            href: links.object(ctx.slug, object.nameSingular),
          }),
        );
      }

      return [];
  }
};

/**
 * Structure tree → sidebar groups. Top-level dividers start a new (optionally titled) group; a titled nested
 * list becomes its own group; everything else appends rows to the current group.
 */
const flatten = (items: SidebarNavItem[]): SidebarNavItem[] =>
  items.flatMap((item) => [item, ...flatten(item.children ?? [])]);

const withActive = (items: SidebarNavItem[], id: string): SidebarNavItem[] =>
  items.map((item) => ({
    ...item,
    ...(item.id === id ? { active: true } : {}),
    ...(item.children ? { children: withActive(item.children, id) } : {}),
  }));

/**
 * Rows link to a specific view (e.g. Deals → Pipeline), but views are tabs on the object's page: when no
 * row matches the current view exactly, the row whose path covers the current page (another view of the object,
 * or one of its records) is active, the longest match winning.
 */
const markClosestActive = (groups: SidebarNavGroup[], pathname: string): SidebarNavGroup[] => {
  const rows = groups.flatMap((group) => flatten(group.items));

  if (rows.some((row) => row.active)) {
    return groups;
  }

  const covering = rows
    .map((row) => ({ row, path: row.href ? splitHref(row.href).pathname : '' }))
    .filter(({ path }) => path && (pathname === path || pathname.startsWith(`${path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0];

  if (!covering) {
    return groups;
  }

  return groups.map((group) => ({ ...group, items: withActive(group.items, covering.row.id) }));
};

export const resolveStructure = (root: StructureNode, ctx: StructureResolveContext): SidebarNavGroup[] => {
  const groups: SidebarNavGroup[] = [];
  let current: SidebarNavGroup = { id: 'main', items: [] };
  const flush = () => {
    if (current.items.length > 0) {
      groups.push(current);
    }
  };
  const topLevel = root.kind === 'list' ? root.items : [root];

  for (const node of topLevel) {
    if (node.kind === 'divider') {
      flush();
      current = { id: node.id, ...(node.label ? { title: node.label } : {}), items: [] };
      continue;
    }

    if (node.kind === 'list' && node.label) {
      flush();
      groups.push({ id: node.id, title: node.label, items: node.items.flatMap((n) => nodeToItems(n, ctx)) });
      current = { id: `${node.id}-after`, items: [] };
      continue;
    }

    current.items.push(...nodeToItems(node, ctx));
  }

  flush();

  return markClosestActive(
    groups.filter((g) => g.items.length > 0),
    ctx.pathname,
  );
};
