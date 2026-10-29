import type { LinkTarget } from '@devias/core';
import { useMemo } from 'react';
import { useWorkspace } from '../providers/workspace';
import { links } from '../router/links';
import { useNavigation } from '../router/navigation';

/** Where a record, a workflow, a document, a task, an asset, a member or an agent lives in the studio. */
const hrefOfLink = (slug: string, target: LinkTarget): string =>
  target.kind === 'record'
    ? links.record(slug, target.object, target.id)
    : target.kind === 'workflow'
      ? links.workflowEditor(slug, target.id)
      : target.kind === 'document'
        ? links.document(slug, target.id)
        : target.kind === 'task'
          ? links.task(slug, target.id)
          : target.kind === 'agent'
            ? links.agent(slug, target.id)
            : target.kind === 'asset'
              ? links.asset(slug, target.id)
              : links.settings(slug, 'members');

/** Workspace-aware navigation helpers built on the href builders in `router/links.ts`. */
export const useNavigateTo = () => {
  const { slug } = useWorkspace();
  const navigation = useNavigation();

  return useMemo(
    () => ({
      navigate: navigation.navigate,
      toObject: (object: string, view?: string) => navigation.navigate(links.object(slug, object, view)),
      toRecord: (object: string, id: string, tab?: string) => navigation.navigate(links.record(slug, object, id, tab)),
      toPage: (path: string) => navigation.navigate(links.page(slug, path)),
      toSettings: (section?: string) => navigation.navigate(links.settings(slug, section)),
      toWorkflow: (id: string) => navigation.navigate(links.workflowEditor(slug, id)),
      toDocument: (id: string) => navigation.navigate(links.document(slug, id)),
      toTask: (id: string) => navigation.navigate(links.task(slug, id)),
      /** Open whatever a link or a mention points at. */
      toLink: (target: LinkTarget) => navigation.navigate(hrefOfLink(slug, target)),
      href: {
        link: (target: LinkTarget) => hrefOfLink(slug, target),
        document: (id: string) => links.document(slug, id),
        workspace: () => links.workspace(slug),
        objects: () => links.objects(slug),
        object: (object: string, view?: string) => links.object(slug, object, view),
        record: (object: string, id: string, tab?: string) => links.record(slug, object, id, tab),
        page: (path: string) => links.page(slug, path),
        settings: (section?: string) => links.settings(slug, section),
        workflow: (id: string) => links.workflowEditor(slug, id),
      },
    }),
    [slug, navigation],
  );
};
