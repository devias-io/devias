import { coreIds, defineBlockComponent, startOfWeek } from '@devias/core';
import { Highlight, Icon, InsightCard, InsightText, Skeleton } from '@devias/ui';
import { useQuery } from '@tanstack/react-query';
import { ago } from '../../../lib/time';
import { useClient } from '../../../providers/client';
import { useWorkspace } from '../../../providers/workspace';
import { keys } from '../../../query/keys';
import { links } from '../../../router/links';
import { useNavigation } from '../../../router/navigation';
import { UNTITLED_RECORD_LABEL } from '../../../views/view-state';

/** Documents edited this week, and the three most recent ones to jump back into. */
function RecentDocumentsCard() {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const client = useClient();
  const since = startOfWeek(new Date()).toISOString();
  const recent = useQuery({
    queryKey: keys.documentList(client.workspaceId, { recent: 3 }),
    queryFn: () => client.documents.list({ limit: 3 }),
    staleTime: 30_000,
  });
  const week = useQuery({
    queryKey: keys.documentList(client.workspaceId, { since }),
    queryFn: () => client.documents.list({ updatedAfter: since, limit: 1 }),
    staleTime: 30_000,
  });
  const edited = week.data?.total;
  const documents = recent.data?.items ?? [];

  return (
    <InsightCard
      icon="file-text"
      title="Documents"
      meta="This week"
      footer={
        <navigation.Link href={links.documents(slug)} className="transition-colors hover:text-foreground">
          See all documents
        </navigation.Link>
      }
    >
      {edited === undefined ? (
        <Skeleton className="h-6 w-3/4" />
      ) : edited === 0 ? (
        <InsightText>No documents were edited this week.</InsightText>
      ) : (
        <InsightText>
          <Highlight>
            {edited} {edited === 1 ? 'document was' : 'documents were'}
          </Highlight>{' '}
          edited this week.
        </InsightText>
      )}
      {documents.length > 0 ? (
        <ul className="-mx-2 mt-auto flex flex-col pt-5">
          {documents.map((document) => (
            <li key={document.id}>
              <navigation.Link
                href={links.document(slug, document.id)}
                className="flex items-center gap-2 px-2 py-1.5 text-xs transition-colors hover:bg-muted"
              >
                <Icon name="file-text" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{document.title || UNTITLED_RECORD_LABEL}</span>
                <span className="ms-auto shrink-0 text-xs text-muted-foreground">{ago(document.updatedAt)}</span>
              </navigation.Link>
            </li>
          ))}
        </ul>
      ) : null}
    </InsightCard>
  );
}

export const recentDocumentsBlock = defineBlockComponent({
  id: coreIds.blocks.recent_documents,
  label: 'Documents',
  icon: 'file-text',
  surfaces: { home: { order: 30 } },
  component: RecentDocumentsCard,
});
