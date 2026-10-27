import { type NavTarget, type PageDefinition, pageOfId, type SchemaIndex } from '@devias/core';
import { links } from '../router/links';

/** Views are referenced by id in structure and metadata; URLs carry the row id. */
export const resolveViewParam = (index: SchemaIndex, view: string | undefined): string | undefined =>
  view ? (index.viewsById.get(view)?.id ?? view) : undefined;

export const navTargetHref = (
  target: NavTarget,
  slug: string,
  index: SchemaIndex,
  pages: ReadonlyMap<string, PageDefinition>,
): { href: string; external: boolean } => {
  switch (target.kind) {
    case 'object':
      return {
        href: links.object(
          slug,
          index.objectsById.get(target.objectId)?.nameSingular ?? target.objectId,
          resolveViewParam(index, target.viewId),
        ),
        external: false,
      };
    case 'page':
      return { href: links.page(slug, pageOfId(pages, target.pageId)?.path ?? target.pageId), external: false };
    case 'url':
      return { href: target.url, external: target.external ?? !target.url.startsWith('/') };
    case 'group':
      // A heading has no page of its own; callers that list nav items show it as a toggle, not a link.
      return { href: links.workspace(slug), external: false };
  }
};
