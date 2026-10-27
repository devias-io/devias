import type { DocumentActivityEntry } from '@devias/core';
import { useMemo } from 'react';
import { type DescribeEntry, Timeline } from '../../components/timeline';
import { useDocumentActivity } from '../../hooks/use-documents';

/** What a document's entries say, as the rest of a sentence about who made them. */
const describeEntry: DescribeEntry<DocumentActivityEntry> = (entry) => {
  if (entry.kind === 'created') {
    return { icon: 'plus', words: <>created this document</> };
  }

  const changes = (entry.data?.changes as string[] | undefined) ?? [];
  const what =
    changes.includes('title') && changes.includes('text')
      ? 'the title and the text'
      : changes.includes('title')
        ? 'the title'
        : 'the text';

  return { icon: 'pencil', words: <>edited {what}</> };
};

/** When a document was made and who edited it, oldest first. Its comments are in the rail beside the text. */
export function DocumentTimeline({ documentId }: { documentId: string }) {
  const query = useDocumentActivity(documentId);
  const entries = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  return (
    <Timeline
      slot="document-timeline"
      title="Activity"
      showComments={false}
      newestFirst={entries}
      loading={query.isPending}
      hasMore={Boolean(query.hasNextPage)}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
      describe={describeEntry}
    />
  );
}
