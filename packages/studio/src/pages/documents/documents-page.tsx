import { Button, EmptyState, Icon, Page, PageHeader, Skeleton } from '@devias/ui';
import { useEffect, useRef, useState } from 'react';
import { SearchInput } from '../../components/search-input';
import { useDocuments, useNewDocument } from '../../hooks/use-documents';
import { useWorkspace } from '../../providers/workspace';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { DocumentCard } from './document-card';

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 px-6 pt-1 pb-8';

/** Every document as a gallery of previews, newest edit first, with a search and endless scrolling. */
export function DocumentsPage() {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const newDocument = useNewDocument();
  const [search, setSearch] = useState('');
  const query = useDocuments(search ? { search } : {});
  const documents = query.data?.pages.flatMap((page) => page.items) ?? [];
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const target = sentinel.current;

    if (!target || !hasNextPage || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(target);

    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <Page fullBleed>
      <div className="px-4 pt-4">
        <PageHeader
          title="Documents"
          description="Pages of rich text. Type @ to mention a record or another document."
          actions={
            <>
              <SearchInput label="Search documents" value={search} onChange={setSearch} />
              <Button onClick={() => void newDocument()}>
                <Icon name="plus" /> New document
              </Button>
            </>
          }
        />
      </div>
      {query.isPending ? (
        <div className={GRID}>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-52 rounded-lg" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <EmptyState
          icon="file-text"
          title={search ? 'No documents match' : 'No documents yet'}
          description={search ? 'Try another word, or clear the search.' : 'Write the first one.'}
          action={
            search ? undefined : (
              <Button size="lg" onClick={() => void newDocument()}>
                <Icon name="plus" /> New document
              </Button>
            )
          }
        />
      ) : (
        <div className="h-full overflow-y-auto" data-slot="documents">
          <div className={GRID}>
            {documents.map((document) => (
              <DocumentCard
                key={document.id}
                document={document}
                onOpen={() => navigation.navigate(links.document(slug, document.id))}
              />
            ))}
          </div>
          {hasNextPage ? <div ref={sentinel} className="h-8" /> : null}
        </div>
      )}
    </Page>
  );
}
