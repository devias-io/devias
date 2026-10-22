import { type DocumentComment, type DocumentThread, personOf, type TextAnchor } from '@devias/core';
import { Button, cn, Icon, Skeleton } from '@devias/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDeleteDialog } from '../../components/confirm-delete-dialog';
import { RichMarkdown } from '../../components/markdown';
import { CommentBox } from '../../components/timeline';
import { useCommentOnDocument, useDeleteDocumentComment, useUpdateDocumentComment } from '../../hooks/use-documents';
import { ago } from '../../lib/time';
import { useWorkspace } from '../../providers/workspace';
import { ActorName, fullDate, PersonAvatar, useActors } from '../../record/activity/shared';

/** The id the comment being written has in the editor, where its text is marked like any other. */
export const DRAFT_COMMENT_ID = 'draft';

type Status = 'open' | 'resolved';

/** The text a comment is on, as a quotation. A comment whose text was changed or removed says so. */
function Quote({ text, lost, onClick }: { text: string; lost: boolean; onClick?: () => void }) {
  const content = (
    <>
      <span className="line-clamp-2 break-words">{text}</span>
      {lost ? (
        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground not-italic">
          <Icon name="triangle-alert" className="size-3" /> Text changed
        </span>
      ) : null}
    </>
  );
  const className = cn(
    'flex w-full flex-col border-l-2 pl-2 text-left text-xs text-muted-foreground italic',
    lost ? 'border-border' : 'border-warning/70',
  );

  return onClick && !lost ? (
    <button type="button" className={cn(className, 'cursor-pointer hover:text-foreground')} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** One comment of a thread: who wrote it and when, its text, and a way to remove it for whoever may. */
function Message({
  comment,
  canChange,
  onDelete,
}: {
  comment: DocumentComment;
  canChange: boolean;
  onDelete: () => void;
}) {
  const actors = useActors();
  const person = actors(comment.actor);
  const at = new Date(comment.createdAt);

  return (
    <div data-slot="document-comment" className="group/message flex gap-2">
      <PersonAvatar person={person} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-xs">
          <ActorName person={person} className="truncate font-medium" />
          <time dateTime={comment.createdAt} title={fullDate(at)} className="shrink-0 text-muted-foreground">
            {ago(at)}
          </time>
          {comment.editedAt ? <span className="text-muted-foreground">· edited</span> : null}
          {canChange ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete comment"
              title="Delete"
              className="ml-auto size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
              onClick={onDelete}
            >
              <Icon name="trash-2" className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <RichMarkdown text={comment.body} />
      </div>
    </div>
  );
}

/** A comment thread: the text it is on, the comments, a box to answer, and resolving it (or taking it up again). */
function ThreadCard({
  thread,
  active,
  placed,
  documentId,
  canChange,
  onActivate,
  onRelease,
  onDelete,
}: {
  thread: DocumentThread;
  active: boolean;
  /** Whether the text the thread is on is still in the document. */
  placed: boolean;
  documentId: string;
  canChange: (comment: DocumentComment) => boolean;
  onActivate: () => void;
  /** The thread was resolved while picked. */
  onRelease: () => void;
  onDelete: (comment: DocumentComment) => void;
}) {
  const { comment, replies } = thread;
  const resolved = comment.resolvedAt !== null;
  const [replying, setReplying] = useState(false);
  const reply = useCommentOnDocument(documentId);
  const update = useUpdateDocumentComment(documentId);
  const card = useRef<HTMLDivElement>(null);

  // A thread picked by clicking its text comes into view in the rail.
  useEffect(() => {
    if (active) {
      card.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
  }, [active]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the quote and the buttons are the keyboard way
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
    <div
      ref={card}
      data-slot="document-thread"
      data-active={active || undefined}
      data-resolved={resolved || undefined}
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors',
        active ? 'border-warning/70 shadow-sm ring-1 ring-warning/30' : 'border-border/60 hover:border-border',
        resolved && !active && 'bg-muted/30',
      )}
      onClick={onActivate}
    >
      {comment.anchor ? <Quote text={comment.anchor.quote} lost={!placed && !resolved} onClick={onActivate} /> : null}
      <Message comment={comment} canChange={canChange(comment)} onDelete={() => onDelete(comment)} />
      {replies.map((one) => (
        <Message key={one.id} comment={one} canChange={canChange(one)} onDelete={() => onDelete(one)} />
      ))}
      {replying ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: stops a click in the box from picking the thread again
        // biome-ignore lint/a11y/useKeyWithClickEvents: see above
        <div onClick={(event) => event.stopPropagation()}>
          <CommentBox
            autoFocus
            submitLabel="Reply"
            pending={reply.isPending}
            onCancel={() => setReplying(false)}
            onSend={(markdown, sent) =>
              reply.mutate(
                { markdown, parent: comment.id },
                {
                  onSuccess: () => {
                    sent();
                    setReplying(false);
                  },
                },
              )
            }
          />
        </div>
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: stops a click on the buttons from picking the thread again
        // biome-ignore lint/a11y/useKeyWithClickEvents: see above
        <div className="flex items-center gap-1 text-xs" onClick={(event) => event.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground"
            onClick={() => setReplying(true)}
          >
            Reply
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1 px-2 text-muted-foreground"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { commentId: comment.id, patch: { resolved: !resolved } },
                {
                  onSuccess: () => {
                    if (active && !resolved) {
                      onRelease();
                    }
                  },
                },
              )
            }
          >
            <Icon name={resolved ? 'undo' : 'check'} className="size-3.5" /> {resolved ? 'Reopen' : 'Resolve'}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The comments of a document, in a rail beside its text: a box for the comment being written on the selected text,
 * then the open threads in the order of the text they are on (the others, which are on the whole document or on
 * text that was changed, after them), or the resolved ones.
 */
export function DocumentComments({
  documentId,
  threads,
  loading,
  placed,
  settled,
  activeId,
  onActivate,
  draft,
  onCloseDraft,
  beforeComment,
}: {
  documentId: string;
  threads: DocumentThread[];
  loading: boolean;
  /** The comments whose text is in the document, in the order of the text. */
  placed: readonly string[];
  /** Whether `placed` is the editor's answer for these threads; until it is, no thread is said to have lost its text. */
  settled: boolean;
  activeId: string | null;
  /** A thread was picked (its id), or let go of (null). */
  onActivate: (id: string | null) => void;
  /** The selection a comment is being written on, if one is. */
  draft: TextAnchor | null;
  onCloseDraft: () => void;
  /** Resolves when the text as the person sees it is saved, so a comment can be on it. */
  beforeComment: () => Promise<void>;
}) {
  const { user, isAdmin } = useWorkspace();
  const [status, setStatus] = useState<Status>('open');
  const [deleting, setDeleting] = useState<DocumentComment | null>(null);
  const comment = useCommentOnDocument(documentId);
  const remove = useDeleteDocumentComment(documentId);
  const order = useMemo(() => new Map(placed.map((id, index) => [id, index])), [placed]);
  const { open, resolved } = useMemo(() => {
    const byTime = (a: DocumentThread, b: DocumentThread) => a.comment.createdAt.localeCompare(b.comment.createdAt);
    const sorted = [...threads].sort(byTime);

    return {
      open: sorted
        .filter((thread) => thread.comment.resolvedAt === null)
        .sort(
          (a, b) =>
            (order.get(a.comment.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.comment.id) ?? Number.MAX_SAFE_INTEGER),
        ),
      resolved: sorted.filter((thread) => thread.comment.resolvedAt !== null).reverse(),
    };
  }, [threads, order]);
  const shown = status === 'open' ? open : resolved;

  // Picking a thread shows the list it is in; resolving the one picked does not move the list.
  const latest = useRef(threads);
  useEffect(() => {
    latest.current = threads;
  });
  useEffect(() => {
    const picked = latest.current.find((thread) => thread.comment.id === activeId);

    if (picked) {
      setStatus(picked.comment.resolvedAt === null ? 'open' : 'resolved');
    }
  }, [activeId]);

  return (
    <section data-slot="document-comments" aria-label="Comments" className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <h2 className="mr-auto font-heading text-sub">Comments</h2>
        {(['open', 'resolved'] as const).map((one) => (
          <Button
            key={one}
            variant="ghost"
            size="sm"
            aria-pressed={status === one}
            className={cn('h-7 px-2 text-xs text-muted-foreground', status === one && 'bg-accent text-foreground')}
            onClick={() => setStatus(one)}
          >
            {one === 'open' ? 'Open' : 'Resolved'} {(one === 'open' ? open : resolved).length}
          </Button>
        ))}
      </div>
      {draft ? (
        <div
          data-slot="document-comment-draft"
          className="flex flex-col gap-2 rounded-lg border border-warning/70 bg-card px-3 py-2.5"
        >
          <Quote text={draft.quote} lost={false} />
          <CommentBox
            autoFocus
            pending={comment.isPending}
            onCancel={onCloseDraft}
            onSend={(markdown, sent) => {
              void beforeComment().then(() =>
                comment.mutate(
                  { markdown, anchor: draft },
                  {
                    onSuccess: (made) => {
                      sent();
                      onCloseDraft();
                      onActivate(made.id);
                    },
                  },
                ),
              );
            }}
          />
        </div>
      ) : null}
      {loading ? <Skeleton className="h-20 w-full" /> : null}
      {!loading && shown.length === 0 && !draft ? (
        <p className="text-xs text-muted-foreground">
          {status === 'open'
            ? 'No open comments. Select some text and press Comment to start one.'
            : 'Nothing is resolved yet.'}
        </p>
      ) : null}
      {shown.map((thread) => (
        <ThreadCard
          key={thread.comment.id}
          thread={thread}
          documentId={documentId}
          active={thread.comment.id === activeId}
          placed={!settled || order.has(thread.comment.id)}
          canChange={(one) => isAdmin || personOf(one.actor) === user.id}
          onActivate={() => onActivate(thread.comment.id)}
          onRelease={() => onActivate(null)}
          onDelete={setDeleting}
        />
      ))}
      <ConfirmDeleteDialog
        noun="comment"
        description={deleting && deleting.parentId === null ? 'Its replies are deleted with it.' : undefined}
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
          }
        }}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);

          if (target) {
            remove.mutate(target.id, { onSuccess: () => onActivate(null) });
          }
        }}
      />
    </section>
  );
}
