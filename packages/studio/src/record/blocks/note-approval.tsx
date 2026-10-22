import { type ApprovalBlockProps, coreIds, defineBlockComponent, primaryFieldOf } from '@devias/core';
import { Button, buttonVariants, cn, Icon, Skeleton } from '@devias/ui';
import { useState } from 'react';
import { RichMarkdown } from '../../components/markdown';
import { useRecord } from '../../hooks/use-records';
import { recordLabel } from '../../providers/labels';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';

/** A body longer than this many lines (or characters) is folded behind "Show more". */
const FOLD_LINES = 8;
const FOLD_CHARS = 600;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * The card that asks the person to approve a note the agent wants to write: on which record, and the note as it will
 * read (its title, and its body drawn as Markdown), with the record one click away. The note is the whole question,
 * so it is shown in full, a long body folded behind "Show more".
 */
function ConfirmNote({ call, busy, approve, reject }: ApprovalBlockProps) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const { index } = useSchema();
  const input = typeof call.input === 'object' && call.input !== null ? (call.input as Record<string, unknown>) : {};
  const objectName = text(input.object);
  const recordId = text(input.id);
  const title = text(input.title);
  const body = text(input.body);
  const object = objectName ? index.objectsByName.get(objectName) : undefined;
  const record = useRecord(object?.nameSingular ?? '', object ? recordId : undefined);
  const name = record.data && object ? recordLabel(record.data, primaryFieldOf(index, object)) : undefined;
  const [open, setOpen] = useState(false);
  const long = body !== undefined && (body.split('\n').length > FOLD_LINES || body.length > FOLD_CHARS);
  const pill = 'rounded-full px-3.5';

  return (
    <div data-slot="note-approval" className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-4">
      <p className="text-sm leading-snug">
        Add a note to{' '}
        {record.isLoading && object ? (
          <Skeleton className="inline-block h-4 w-28 align-middle" />
        ) : (
          <span className="font-medium">{name ?? `a ${object?.labelSingular.toLowerCase() ?? 'record'}`}</span>
        )}
        {object && name ? <span className="text-muted-foreground"> · {object.labelSingular}</span> : null}.
      </p>
      <div
        className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-3.5 py-3"
        data-slot="note-preview"
      >
        <div className="flex items-center gap-2 font-medium">
          <Icon name="file-text" className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words">{title ?? 'Untitled note'}</span>
        </div>
        {body ? (
          <div className={cn('relative min-w-0', long && !open && 'max-h-40 overflow-hidden')}>
            <RichMarkdown text={body} />
            {long && !open ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />
            ) : null}
          </div>
        ) : null}
        {long ? (
          <button
            type="button"
            className="self-start text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline"
            onClick={() => setOpen(!open)}
          >
            {open ? 'Show less' : 'Show more'}
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className={pill} onClick={approve} disabled={busy || !title} data-action="approve">
          Approve
        </Button>
        {object && recordId ? (
          <navigation.Link
            href={links.record(slug, object.nameSingular, recordId)}
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), pill)}
          >
            Review
          </navigation.Link>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className={cn(pill, 'text-muted-foreground')}
          onClick={reject}
          disabled={busy}
          data-action="reject"
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

/** Approval widget for writing a note on a record. */
export const noteApprovalBlock = defineBlockComponent({
  id: coreIds.blocks.note_approval,
  label: 'Confirm a note',
  icon: 'file-text',
  surfaces: { approval: { tools: ['add_record_note'] } },
  component: ConfirmNote,
});
