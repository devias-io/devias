import {
  coreIds,
  defineBlockComponent,
  personOf,
  RECORD_COMMENT_BODY_MAX_LENGTH,
  RECORD_COMMENT_TITLE_MAX_LENGTH,
  type RecordComment,
} from '@devias/core';
import { Button, cn, Icon, Kbd, Skeleton, Textarea } from '@devias/ui';
import { startOfDay } from 'date-fns';
import { type FormEvent, type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { RichMarkdown } from '../../components/markdown';
import {
  useAddRecordComment,
  useDeleteRecordComment,
  useRecordComments,
  useUpdateRecordComment,
} from '../../hooks/use-record-comments';
import { ago } from '../../lib/time';
import { useWorkspace } from '../../providers/workspace';
import { ActorName, dayLabel, fullDate, useActors } from '../activity/shared';

/** Comments shown at first; "Show older comments" fetches the next ones. */
const PAGE = 5;

/** A body longer than this many lines (or characters) is folded behind "Show more". */
const FOLD_LINES = 6;
const FOLD_CHARS = 480;

/** What goes in a comment: its title, and a body that may be left empty. */
interface Draft {
  title: string;
  body: string;
}

const isLong = (body: string): boolean => body.split('\n').length > FOLD_LINES || body.length > FOLD_CHARS;

/**
 * The box comments are written and edited in. Closed it is one line, "Add a comment…"; opened (by focus, by text, or
 * because a comment is being edited) it has a Title, a body that takes Markdown, and Save (`⌘↵`).
 */
function RecordCommentBox({
  initial,
  autoFocus,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: Draft;
  autoFocus?: boolean;
  pending: boolean;
  onSubmit: (draft: Draft) => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [focused, setFocused] = useState(Boolean(autoFocus));
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const editing = onCancel !== undefined;
  const open = focused || editing || title.length > 0 || body.length > 0;
  const ready = title.trim().length > 0 && !pending;
  const submit = (event?: FormEvent) => {
    event?.preventDefault();

    if (!ready) {
      return;
    }

    onSubmit({ title: title.trim(), body: body.trim() });

    if (!editing) {
      setTitle('');
      setBody('');
    }
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      onCancel?.();
    }
  };

  return (
    <form
      onSubmit={submit}
      data-slot="comment-box"
      className={cn(
        'overflow-hidden rounded-lg bg-transparent ring-1 ring-input transition-shadow ring-inset focus-within:ring-ring dark:bg-input/30',
        !open && 'hover:ring-strong-border',
      )}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // Moving between the title and the body is not leaving.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
    >
      <input
        aria-label="Title"
        placeholder={open ? 'Title' : 'Add a comment…'}
        value={title}
        maxLength={RECORD_COMMENT_TITLE_MAX_LENGTH}
        // biome-ignore lint/a11y/noAutofocus: a comment opens for editing because the user asked to edit it
        autoFocus={autoFocus}
        className={cn(
          'block w-full bg-transparent px-3 outline-none placeholder:text-muted-foreground',
          open ? 'pt-2.5 pb-1 text-[14px] font-semibold' : 'h-9 text-xs',
        )}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          // Enter in the title moves on to the body, as it would to the next line.
          if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            bodyRef.current?.focus();
          }

          keys(event);
        }}
      />
      {open ? (
        <>
          <Textarea
            ref={bodyRef}
            aria-label="Comment"
            placeholder="Write something…"
            value={body}
            rows={3}
            maxLength={RECORD_COMMENT_BODY_MAX_LENGTH}
            className="min-h-24 resize-none rounded-none border-0 bg-transparent px-3 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={keys}
          />
          <div className="flex items-center justify-between gap-2 px-3 pt-1 pb-2">
            <span className="text-xs text-muted-foreground">
              Markdown works · <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd> to save
            </span>
            <span className="flex gap-1">
              {editing ? (
                <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                  Cancel
                </Button>
              ) : null}
              <Button
                type="submit"
                size="sm"
                disabled={!ready}
                // Keep focus (and the open box) while the button is pressed.
                onMouseDown={(event) => event.preventDefault()}
              >
                Save
              </Button>
            </span>
          </div>
        </>
      ) : null}
    </form>
  );
}

/** One comment: who wrote it and when under its title, then its text; the author (or an admin) can edit and remove it. */
function RecordCommentItem({
  comment,
  object,
  recordId,
  canChange,
}: {
  comment: RecordComment;
  object: string;
  recordId: string;
  canChange: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const update = useUpdateRecordComment(object, recordId);
  const remove = useDeleteRecordComment(object, recordId);
  const actors = useActors();
  const author = actors(comment.author);
  const created = new Date(comment.createdAt);
  const edited = new Date(comment.updatedAt).getTime() - created.getTime() > 1000;
  const long = isLong(comment.body);

  if (editing) {
    return (
      <li data-slot="comment">
        <div className="min-w-0 flex-1">
          <RecordCommentBox
            initial={{ title: comment.title, body: comment.body }}
            autoFocus
            pending={update.isPending}
            onCancel={() => setEditing(false)}
            onSubmit={(draft) =>
              update.mutate(
                { commentId: comment.id, patch: { title: draft.title, body: draft.body } },
                { onSuccess: () => setEditing(false) },
              )
            }
          />
        </div>
      </li>
    );
  }

  return (
    <li className="group/comment" data-slot="comment">
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 pt-0.5 text-[14px] font-semibold break-words">{comment.title}</span>
          {canChange ? (
            <span className="-mt-0.5 -mr-1 flex opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              <Button variant="ghost" size="icon-sm" aria-label="Edit comment" onClick={() => setEditing(true)}>
                <Icon name="pencil" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete comment"
                disabled={remove.isPending}
                onClick={() => remove.mutate(comment.id)}
              >
                <Icon name="trash-2" />
              </Button>
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <ActorName person={author} className="font-medium text-foreground" />
          <span className="text-[12px]">
            {' · '}
            <time dateTime={comment.createdAt} title={ago(created)} className="tabular-nums">
              {fullDate(created)}
            </time>
            {edited ? ' · edited' : ''}
          </span>
        </p>
        {comment.body ? (
          <div
            className={cn(
              'mt-2 max-w-3xl',
              long &&
                !expanded &&
                'max-h-36 overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]',
            )}
          >
            <RichMarkdown text={comment.body} />
          </div>
        ) : null}
        {long ? (
          <button
            type="button"
            aria-expanded={expanded}
            className="mt-1 text-xs font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function RecordComments({ object, label, recordId }: { object: string; label: string; recordId: string }) {
  const { user, isAdmin } = useWorkspace();
  const comments = useRecordComments(object, recordId, PAGE);
  const add = useAddRecordComment(object, recordId);
  const items = comments.data?.pages.flatMap((page) => page.items) ?? [];
  const days = useMemo(() => {
    const groups: { key: number; label: string; comments: RecordComment[] }[] = [];

    for (const comment of comments.data?.pages.flatMap((page) => page.items) ?? []) {
      const date = new Date(comment.createdAt);
      const key = startOfDay(date).getTime();
      const group = groups.at(-1);

      if (group?.key === key) {
        group.comments.push(comment);
      } else {
        groups.push({ key, label: dayLabel(date), comments: [comment] });
      }
    }

    return groups;
  }, [comments.data]);

  return (
    <div className="flex flex-col gap-6" data-slot="comments">
      <RecordCommentBox
        pending={add.isPending}
        onSubmit={(draft) => add.mutate({ title: draft.title, ...(draft.body ? { body: draft.body } : {}) })}
      />
      {comments.isPending ? (
        <div className="flex flex-col gap-3 pl-10">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No comments yet. Write down what you learn about this {label}: calls, decisions, context.
        </p>
      ) : (
        <div className="flex flex-col gap-7">
          {days.map((day) => (
            <section key={day.key} aria-label={day.label}>
              <h3 className="mb-4 flex items-center gap-3 text-[11px] font-medium tracking-wider text-muted-foreground uppercase after:h-px after:flex-1 after:bg-border">
                {day.label}
              </h3>
              <ul className="flex flex-col gap-5" aria-label={`Comments, ${day.label}`}>
                {day.comments.map((comment) => (
                  <RecordCommentItem
                    key={comment.id}
                    comment={comment}
                    object={object}
                    recordId={recordId}
                    canChange={isAdmin || personOf(comment.author) === user.id}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {comments.hasNextPage ? (
        <div className="pl-10">
          <Button
            variant="outline"
            size="sm"
            disabled={comments.isFetchingNextPage}
            onClick={() => void comments.fetchNextPage()}
          >
            Show older comments
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A record's comments, newest first, for the end of the left column of every record page: a box to jot one down (a title
 * and a Markdown body), then the comments under day headings as the activity is, each saying who wrote it and when, and
 * editable and removable by its author.
 */
export const commentsBlock = defineBlockComponent({
  id: coreIds.blocks.comments,
  label: 'Comments',
  icon: 'message-square',
  surfaces: { record: { placement: 'tab' } },
  component: ({ record, object }) =>
    record ? (
      <RecordComments object={object.nameSingular} label={object.labelSingular.toLowerCase()} recordId={record.id} />
    ) : null,
});
