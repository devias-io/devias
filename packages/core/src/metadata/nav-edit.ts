import type { NavItemInput } from './inputs';
import type { NavItem, NavOverrides } from './schema';

/** What an edit of a nav item by the workspace comes to: columns to change, and the overrides it ends with. */
export interface NavEdit {
  /** Values to write on the item itself: only for the workspace's own items. */
  columns: Partial<Pick<NavItem, 'label' | 'icon' | 'target' | 'position' | 'parentId'>>;
  /** The overrides the item holds afterwards; null when it holds none. */
  overrides: NavOverrides | null;
}

export class NavEditError extends Error {}

/**
 * The workspace's own items change in place; a module's keep the module's values and take label, icon, position and
 * parent as overrides beside them, so a module update does not undo them (an edit equal to the module's value drops
 * its override). `hidden` is an override for both. A module's `target` is not the workspace's to change.
 */
export const navEdit = (current: NavItem, patch: Partial<NavItemInput>): NavEdit => {
  const { hidden, ...rest } = patch;
  const next: NavOverrides = { ...(current.overrides ?? {}) };

  if (hidden !== undefined) {
    if (hidden) {
      next.hidden = true;
    } else {
      delete next.hidden;
    }
  }

  const done = (columns: NavEdit['columns']): NavEdit => ({
    columns,
    overrides: Object.keys(next).length > 0 ? next : null,
  });

  if (current.moduleId === null) {
    const columns: NavEdit['columns'] = {};

    if (rest.label !== undefined) {
      columns.label = rest.label;
    }

    if (rest.icon !== undefined) {
      columns.icon = rest.icon;
    }

    if (rest.target !== undefined) {
      columns.target = rest.target;
    }

    if (rest.position !== undefined) {
      columns.position = rest.position;
    }

    if (rest.parentId !== undefined) {
      columns.parentId = rest.parentId;
    }

    return done(columns);
  }

  if (rest.target !== undefined) {
    throw new NavEditError(
      `"${current.label}" belongs to module "${current.moduleId}": it can be renamed, moved and hidden, but where it leads comes from the module`,
    );
  }

  const set = <K extends keyof NavOverrides>(key: K, value: NavOverrides[K], base: unknown) => {
    if (value === base) {
      delete next[key];
    } else {
      next[key] = value;
    }
  };

  if (rest.label !== undefined) {
    set('label', rest.label, current.label);
  }

  if (rest.icon !== undefined) {
    set('icon', rest.icon, current.icon);
  }

  if (rest.position !== undefined) {
    set('position', rest.position, current.position);
  }

  if (rest.parentId !== undefined) {
    set('parentId', rest.parentId, current.parentId);
  }

  return done({});
};

/** The id an item sits under once its overrides apply. */
export const navParentOf = (item: NavItem): string | null =>
  item.overrides && item.overrides.parentId !== undefined ? item.overrides.parentId : item.parentId;
