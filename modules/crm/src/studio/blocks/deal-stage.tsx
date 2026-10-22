import { daysBetween, defineBlockComponent, localDate, num, str } from '@devias/core';
import {
  EditableValue,
  getFieldType,
  links,
  useFields,
  useFieldTypes,
  useNavigation,
  useRecord,
  useRecordPage,
  useUpdateRecord,
  useWorkspace,
} from '@devias/studio';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Icon,
  NativeSelect,
  NativeSelectOption,
} from '@devias/ui';
import { useState } from 'react';
import { DEAL_STAGES, ids, LOST_REASONS } from '../../manifest';
import { closeWords, dayOf, OPEN_STAGES, useMoney } from '../shared';

const TRACK = DEAL_STAGES.filter((stage) => stage.value !== 'lost');
const OPEN = OPEN_STAGES.map((stage) => stage.value) as string[];

/** Where the deal is on its way to won: a segment per stage, filled up to the current one; click one to move the deal. */
function Stepper({
  stage,
  disabled,
  onMove,
}: {
  stage: string;
  disabled: boolean;
  onMove: (stage: (typeof TRACK)[number]['value']) => void;
}) {
  const current = TRACK.findIndex((option) => option.value === stage);

  return (
    <ol
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${TRACK.length}, minmax(0, 1fr))` }}
      data-slot="stage-stepper"
    >
      {TRACK.map((option, index) => (
        <li key={option.value}>
          <button
            type="button"
            disabled={disabled}
            aria-current={index === current ? 'step' : undefined}
            aria-label={`Move to ${option.label}`}
            onClick={() => onMove(option.value)}
            className="group/step block w-full text-left outline-none enabled:cursor-pointer"
          >
            <div
              className={cn(
                'h-1.5 rounded-full transition-colors group-focus-visible/step:ring-3 group-focus-visible/step:ring-ring/30',
                index <= current ? 'bg-brand' : 'bg-muted group-enabled/step:group-hover/step:bg-brand/40',
              )}
            />
            <span
              className={cn(
                'mt-2 block truncate text-xs',
                index === current
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground group-enabled/step:group-hover/step:text-foreground',
              )}
            >
              {option.label}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The next step, a line of text edited in place. */
function NextStep() {
  const { object, record, readOnly } = useRecordPage();
  const update = useUpdateRecord(object.nameSingular);
  const fields = useFields(object.id);
  const fieldTypes = useFieldTypes();
  const field = fields.find((candidate) => candidate.name === 'next_step');

  if (!field) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 text-xs" data-slot="next-step">
      <span className="w-16 shrink-0 text-muted-foreground">Next step</span>
      <div className="min-w-0 flex-1">
        <EditableValue
          field={field}
          fieldType={getFieldType(fieldTypes, field.type)}
          record={record}
          object={object}
          editable={!readOnly}
          onCommit={(value) => update.mutate({ id: record.id, patch: { next_step: value } })}
        />
      </div>
    </div>
  );
}

/** Why the deal was lost: asked when it is marked lost, so the pipeline can say. */
function LostDialog({
  busy,
  onSubmit,
  onClose,
}: {
  busy: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark this deal lost</DialogTitle>
          <DialogDescription>Say why, so the pipeline can tell what is slipping away.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();

            if (reason && !busy) {
              onSubmit(reason);
            }
          }}
        >
          <Field>
            <FieldLabel htmlFor="lost-reason">Reason</FieldLabel>
            <NativeSelect id="lost-reason" value={reason} onChange={(event) => setReason(event.target.value)}>
              <NativeSelectOption value="">Choose a reason…</NativeSelectOption>
              {LOST_REASONS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !reason} data-action="confirm-lost">
              Mark lost
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Where a deal stands, at the top of its page: the stage as a stepper you click, a line of what it is worth, its next
 * step, and the buttons that close it: won, or lost with the reason.
 */
export const dealStageBlock = defineBlockComponent({
  id: ids.blocks.deal_stage,
  label: 'Deal stage',
  icon: 'target',
  surfaces: { record: { objectIds: [ids.objects.deal], frame: false } },
  component: function DealStage() {
    const { object, record, readOnly } = useRecordPage();
    const { slug } = useWorkspace();
    const { Link } = useNavigation();
    const update = useUpdateRecord(object.nameSingular);
    const money = useMoney();
    const company = useRecord('company', str(record.company) || undefined);
    const [losing, setLosing] = useState(false);
    const stage = str(record.stage);
    const open = OPEN.includes(stage);
    const move = (patch: Record<string, unknown>) => update.mutate({ id: record.id, patch });
    const today = localDate(new Date());
    const close = str(record.close_date);
    const overdue = open && Boolean(close) && daysBetween(today, close) < 0;
    const probability = typeof record.probability === 'number' ? record.probability : null;
    const lostReason = LOST_REASONS.find((option) => option.value === record.lost_reason)?.label;

    return (
      <div className="flex flex-col gap-5" data-slot="deal-stage" data-stage={stage}>
        {stage === 'lost' ? (
          <div className="flex items-center gap-2 text-xs" data-slot="stage-lost">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-destructive/10 px-3 font-medium text-destructive">
              <Icon name="circle-x" weight="fill" className="size-3.5" /> Lost
            </span>
            {lostReason ? <span className="text-muted-foreground">{lostReason}</span> : null}
          </div>
        ) : (
          <Stepper stage={stage} disabled={readOnly || update.isPending} onMove={(next) => move({ stage: next })} />
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p
            className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
            data-slot="deal-facts"
          >
            <span
              className="text-base font-medium tracking-[-0.02em] text-foreground tabular-nums"
              data-slot="deal-amount"
            >
              {record.amount === null || record.amount === undefined ? '—' : money(num(record.amount))}
            </span>
            {probability !== null && open ? (
              <>
                <span aria-hidden>·</span>
                <span>{probability}% likely</span>
              </>
            ) : null}
            {close ? (
              <>
                <span aria-hidden>·</span>
                <span className={cn(overdue && 'text-destructive')}>
                  {open ? closeWords(close, today) : `Closed ${dayOf(close)}`}
                </span>
              </>
            ) : null}
            {company.data ? (
              <>
                <span aria-hidden>·</span>
                <Link
                  href={links.record(slug, 'company', company.data.id)}
                  className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  {str(company.data.name) || 'Company'}
                </Link>
              </>
            ) : null}
          </p>
          {readOnly ? null : (
            <div className="flex items-center gap-2">
              {open ? (
                <>
                  <Button variant="outline" size="sm" data-action="mark-lost" onClick={() => setLosing(true)}>
                    <Icon name="x" />
                    Mark lost
                  </Button>
                  <Button size="sm" data-action="mark-won" onClick={() => move({ stage: 'customer' })}>
                    <Icon name="check" />
                    Mark won
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  data-action="reopen"
                  onClick={() => move({ stage: 'new', ...(stage === 'lost' ? { lost_reason: null } : {}) })}
                >
                  <Icon name="rotate-ccw" />
                  Reopen
                </Button>
              )}
            </div>
          )}
        </div>
        <NextStep />
        {losing ? (
          <LostDialog
            busy={update.isPending}
            onClose={() => setLosing(false)}
            onSubmit={(reason) => {
              move({ stage: 'lost', lost_reason: reason });
              setLosing(false);
            }}
          />
        ) : null}
      </div>
    );
  },
});
