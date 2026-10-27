import { type Actor, EMPTY_DOC, richTextToMarkdown } from '@devias/core';
import { Button, Icon, type IconName, Skeleton } from '@devias/ui';
import { type ReactNode, useMemo, useState } from 'react';
import { RichTextEditor } from '../editor';
import { ago } from '../lib/time';
import { ActorName, fullDate, Marker, PersonAvatar, useActors } from '../record/activity/shared';
import { RichMarkdown } from './markdown';

/** What a timeline needs of an entry, whichever entity it belongs to. */
export interface TimelineEntry {
  id: string;
  kind: string;
  actor: Actor;
  body: string | null;
  createdAt: string;
}

/** How a timeline says what happened in an entry that is not a comment: a mark and the rest of the sentence. */
export type DescribeEntry<T extends TimelineEntry> = (entry: T) => { icon: IconName; words: ReactNode };

function Entry<T extends TimelineEntry>({ entry, describe }: { entry: T; describe: DescribeEntry<T> }) {
  const actors = useActors();
  const person = actors(entry.actor);
  const at = new Date(entry.createdAt);
  const when = (
    <time dateTime={entry.createdAt} title={fullDate(at)} className="text-muted-foreground">
      {ago(at)}
    </time>
  );

  if (entry.kind === 'comment') {
    return (
      <li data-slot="timeline-comment" className="flex gap-3">
        <PersonAvatar person={person} />
        <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border border-border/60 bg-card px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            <ActorName person={person} className="font-medium" /> {when}
          </div>
          <RichMarkdown text={entry.body ?? ''} />
        </div>
      </li>
    );
  }

  const { icon, words } = describe(entry);

  return (
    <li data-slot="timeline-change" className="flex items-start gap-3 text-xs text-muted-foreground">
      <Marker>
        <Icon name={icon} className="size-3.5" />
      </Marker>
      <p className="min-w-0 flex-1 pt-1.5 leading-snug">
        <ActorName person={person} className="font-medium text-foreground" /> {words} {when}
      </p>
    </li>
  );
}

/**
 * A box to write a comment in: Ctrl or ⌘ + Enter sends it, and the box is cleared by remounting it. Given `onCancel` it
 * also has a way to close, for a box that opens on demand (a reply, a comment on a selection).
 */
export function CommentBox({
  disabled = false,
  pending,
  onSend,
  submitLabel = 'Comment',
  autoFocus = false,
  onCancel,
}: {
  disabled?: boolean;
  pending: boolean;
  onSend: (markdown: string, sent: () => void) => void;
  submitLabel?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
}) {
  const [doc, setDoc] = useState<unknown>(EMPTY_DOC);
  const [epoch, setEpoch] = useState(0);
  const markdown = useMemo(() => richTextToMarkdown(doc as Parameters<typeof richTextToMarkdown>[0]).trim(), [doc]);
  const send = () => {
    if (!markdown) {
      return;
    }

    onSend(markdown, () => {
      setDoc(EMPTY_DOC);
      setEpoch((n) => n + 1);
    });
  };

  return (
    <div data-slot="timeline-comment-box" className="flex flex-col gap-2">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a keyboard shortcut for the editor inside */}
      <div
        className="rounded-lg border border-border bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-ring/40"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          } else if (event.key === 'Escape' && onCancel && !event.defaultPrevented) {
            onCancel();
          }
        }}
      >
        <RichTextEditor key={epoch} value={doc} editable={!disabled} autoFocus={autoFocus} onChange={setDoc} />
      </div>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button size="sm" disabled={disabled || !markdown || pending} onClick={send}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * What happened to something and what was said about it, oldest first, with a box to say something. Newest-first pages
 * are given and shown the other way round; "Show earlier activity" loads the next page.
 */
export function Timeline<T extends TimelineEntry>({
  title = 'Activity',
  newestFirst,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  describe,
  onComment,
  commenting = false,
  readOnly = false,
  showComments = true,
  slot,
}: {
  title?: string;
  newestFirst: T[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  describe: DescribeEntry<T>;
  /** Writes a comment; without it there is no box. */
  onComment?: (markdown: string, sent: () => void) => void;
  commenting?: boolean;
  readOnly?: boolean;
  /** False for a timeline of what happened only: comments are shown elsewhere. */
  showComments?: boolean;
  slot: string;
}) {
  const entries = useMemo(
    () => [...newestFirst].reverse().filter((entry) => showComments || entry.kind !== 'comment'),
    [newestFirst, showComments],
  );

  return (
    <section data-slot={slot} className="flex flex-col gap-4">
      <h2 className="font-heading text-sub">{title}</h2>
      {loading ? <Skeleton className="h-16 w-full" /> : null}
      {hasMore ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          Show earlier activity
        </Button>
      ) : null}
      <ol className="flex flex-col gap-3">
        {entries.map((entry) => (
          <Entry key={entry.id} entry={entry} describe={describe} />
        ))}
      </ol>
      {showComments && onComment ? <CommentBox disabled={readOnly} pending={commenting} onSend={onComment} /> : null}
    </section>
  );
}
