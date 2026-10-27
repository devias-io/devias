import { DeviasApiError, type Document, type TextAnchor } from '@devias/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  Page,
  Skeleton,
} from '@devias/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDeleteDialog } from '../../components/confirm-delete-dialog';
import { TitleField } from '../../components/title-field';
import { type CommentAnchor, RichTextEditor, type RichTextEditorHandle, scrollToComment } from '../../editor';
import { useAutosave } from '../../hooks/use-autosave';
import { useDeleteDocument, useDocument, useDocumentComments, useUpdateDocument } from '../../hooks/use-documents';
import { useSetBreadcrumbs } from '../../providers/breadcrumbs';
import { useWorkspace } from '../../providers/workspace';
import { MentionedInList } from '../../record/blocks/mentioned-in';
import { saveStatusText } from '../../record/shells/column-shell';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { UNTITLED_RECORD_LABEL } from '../../views/view-state';
import { DocumentComments, DRAFT_COMMENT_ID } from './document-comments';
import { DocumentTimeline } from './document-timeline';

/** How long after typing stops a document saves. */
const SAVE_DELAY_MS = 3000;

/** A change was refused because the document moved on: the error carries `CONFLICT`. */
const isConflict = (error: unknown): boolean => error instanceof DeviasApiError && error.code === 'CONFLICT';

/**
 * One document, written in place: a slim toolbar (the save status, the ⋯ menu), the title, the text and what mentions
 * it. Title and text save together, each save naming the version it was made from; when someone else saved first the
 * page says so and offers to load their version instead of overwriting it. Mounted per document and per reload.
 */
function DocumentEditor({ document, onReload }: { document: Document; onReload: () => void }) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const update = useUpdateDocument(document.id);
  const remove = useDeleteDocument();
  const [confirm, setConfirm] = useState(false);
  const [conflict, setConflict] = useState(false);
  const editor = useRef<RichTextEditorHandle | null>(null);
  // The version the page last saw or saved. A newer copy that arrives while the person is typing is not adopted, so
  // their next save is refused rather than overwriting it.
  const version = useRef(document.version);
  const typing = useRef(false);
  const lost = useRef(false);

  if (!typing.current && document.version > version.current) {
    version.current = document.version;
  }

  const autosave = useAutosave(
    async (patch) => {
      if (lost.current) {
        throw new Error('This document changed elsewhere');
      }

      try {
        const saved = await update.mutateAsync({ ...patch, expectedVersion: version.current });
        version.current = saved.version;
      } catch (error) {
        if (isConflict(error)) {
          lost.current = true;
          setConflict(true);
        }

        throw error;
      }
    },
    { delayMs: SAVE_DELAY_MS },
  );
  useSetBreadcrumbs([
    { label: 'Documents', href: links.documents(slug) },
    { label: document.title || UNTITLED_RECORD_LABEL },
  ]);
  const fresh = document.title === UNTITLED_RECORD_LABEL && document.version === 1;

  // Comments on the text: the threads beside it, which one is looked at, the selection a comment is being written on,
  // and which comments still have their text in the document.
  const threads = useDocumentComments(document.id);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TextAnchor | null>(null);
  const [placed, setPlaced] = useState<{ ids: string[]; anchors: readonly CommentAnchor[] } | null>(null);
  const anchors = useMemo<CommentAnchor[]>(
    () => [
      // The text of open threads is underlined; a resolved one only while it is looked at.
      ...(threads.data?.items ?? []).flatMap(({ comment }) =>
        comment.anchor && (comment.resolvedAt === null || comment.id === activeId)
          ? [{ id: comment.id, anchor: comment.anchor }]
          : [],
      ),
      ...(draft ? [{ id: DRAFT_COMMENT_ID, anchor: draft, draft: true }] : []),
    ],
    [threads.data, activeId, draft],
  );
  // Read when the editor reports where the text of the comments is: it has drawn the anchors it was last given.
  const latestAnchors = useRef(anchors);
  useLayoutEffect(() => {
    latestAnchors.current = anchors;
  });
  const comments = useMemo(
    () => ({
      anchors,
      activeId,
      onActivate: setActiveId,
      onPlaced: (ids: string[]) => setPlaced({ ids, anchors: latestAnchors.current }),
      onComment: (anchor: TextAnchor) => {
        setActiveId(null);
        setDraft(anchor);
      },
    }),
    [anchors, activeId],
  );

  // A thread picked in the rail brings its text into view.
  useEffect(() => {
    if (activeId && editor.current) {
      scrollToComment(editor.current, activeId);
    }
  }, [activeId]);

  return (
    <Page fullBleed>
      <div
        data-slot="document-page"
        className="mx-auto flex min-h-full w-full max-w-[80rem] flex-col px-6 pt-3 pb-16 sm:px-12"
        onFocusCapture={() => {
          typing.current = true;
        }}
        onBlurCapture={() => {
          typing.current = false;
        }}
      >
        <div className="mb-14 flex min-h-7 items-center justify-end gap-2 text-xs text-muted-foreground">
          <span aria-live="polite">{saveStatusText(autosave.status, document.updatedAt)}</span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Document actions"
                  title="Actions"
                  className="text-muted-foreground"
                />
              }
            >
              <Icon name="more-horizontal" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(window.location.href)
                    .then(() => toast.success('Link copied'))
                    .catch(() => toast.error('Could not copy'));
                }}
              >
                <Icon name="link" /> Copy link
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(document.markdown)
                    .then(() => toast.success('Copied as Markdown'))
                    .catch(() => toast.error('Could not copy'));
                }}
              >
                <Icon name="file-text" /> Copy as Markdown
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
                <Icon name="trash-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {conflict ? (
          <div
            role="alert"
            data-slot="document-conflict"
            className="mb-6 flex items-center gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs"
          >
            <Icon name="triangle-alert" className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">This document changed elsewhere. Your latest edits were not saved.</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                autosave.discard();
                onReload();
              }}
            >
              Load the latest
            </Button>
          </div>
        ) : null}
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-4 lg:col-start-1">
            <TitleField
              value={document.title}
              readOnly={false}
              className="text-2xl"
              selectOnMount={fresh}
              onChange={(title) => autosave.queue({ title }, SAVE_DELAY_MS)}
              onBlur={autosave.flush}
              onEnter={() => {
                editor.current?.view.focus();
                editor.current?.commands.focus('start');
              }}
            />
            <div>
              <RichTextEditor
                variant="page"
                value={document.body}
                editorRef={editor}
                comments={comments}
                onChange={(body) => autosave.queue({ body }, SAVE_DELAY_MS)}
                onBlur={autosave.flush}
              />
              {/* Clicking below the text continues writing at the end. */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the editor itself is keyboard-reachable */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above */}
              <div className="min-h-24 cursor-text" onClick={() => editor.current?.commands.focus('end')} />
            </div>
          </div>
          {/* Beside the text from 1024px up, under it before that. */}
          <aside className="min-w-0 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
            <DocumentComments
              documentId={document.id}
              threads={threads.data?.items ?? []}
              loading={threads.isPending}
              placed={placed?.ids ?? []}
              settled={placed?.anchors === anchors}
              activeId={activeId}
              onActivate={setActiveId}
              draft={draft}
              onCloseDraft={() => setDraft(null)}
              beforeComment={autosave.flush}
            />
          </aside>
          <div className="flex min-w-0 flex-col gap-4 lg:col-start-1">
            <MentionedInList target={{ kind: 'document', id: document.id }} />
            <DocumentTimeline documentId={document.id} />
          </div>
        </div>
      </div>
      <ConfirmDeleteDialog
        noun="document"
        open={confirm}
        onOpenChange={setConfirm}
        onConfirm={async () => {
          setConfirm(false);
          autosave.discard();
          lost.current = true;
          await remove.mutateAsync(document.id);
          navigation.navigate(links.documents(slug));
        }}
      />
    </Page>
  );
}

/** `/documents/:documentId`. */
export function DocumentPage() {
  const { params, navigate } = useNavigation();
  const { slug } = useWorkspace();
  const id = params.documentId ?? '';
  const query = useDocument(id);
  // Loading the latest remounts the editor, so it starts from what the server has.
  const [epoch, setEpoch] = useState(0);

  if (query.isPending) {
    return (
      <Page className="mx-auto w-full max-w-5xl px-6 pt-8 sm:px-12">
        <Skeleton className="mb-8 h-12 w-80" />
        <Skeleton className="h-64 w-full" />
      </Page>
    );
  }

  if (query.isError || !query.data) {
    return (
      <EmptyState
        icon="circle-help"
        title="Document not found"
        description="It may have been deleted."
        action={
          <Button size="lg" variant="outline" onClick={() => navigate(links.documents(slug))}>
            Back to documents
          </Button>
        }
      />
    );
  }

  return (
    <DocumentEditor
      key={`${query.data.id}:${epoch}`}
      document={query.data}
      onReload={() => void query.refetch().then(() => setEpoch((n) => n + 1))}
    />
  );
}
