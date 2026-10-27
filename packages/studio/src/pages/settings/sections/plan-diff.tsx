import { type PlanAction, type PlanChange, type PlanResult, summarizePlan } from '@devias/core';
import { Button, cn, Icon } from '@devias/ui';
import { useState } from 'react';

/** How each change reads in a review; only removals and conflicts stand out. */
const ACTION: Record<PlanAction, { label: string; className: string }> = {
  create: { label: 'New', className: 'text-foreground' },
  update: { label: 'Changed', className: 'text-foreground' },
  delete: { label: 'Removed', className: 'text-destructive' },
  conflict: { label: 'Conflict', className: 'text-warning' },
  noop: { label: 'Unchanged', className: 'text-muted-foreground' },
};

const KIND_LABEL: Record<string, string> = {
  object: 'Objects',
  field: 'Fields',
  view: 'Views',
  layout: 'Layouts',
  nav_item: 'Navigation',
  command_item: 'Commands',
  workflow: 'Workflows',
};

/** What applying a plan does, in a sentence, for the question before it is applied. */
export const planSentence = (plan: PlanResult, pending?: 'install' | 'update'): string => {
  const counts = summarizePlan(plan);
  const changed = plan.changes.length - counts.noop;

  if (changed === 0) {
    return pending === 'install'
      ? 'Installing adds the module, with its connections, actions and events. Nothing in the data model changes.'
      : 'Applying records the new version. Nothing in the data model changes.';
  }

  const parts = [
    counts.create ? plural(counts.create, 'new item') : null,
    counts.update ? plural(counts.update, 'change') : null,
    counts.delete ? plural(counts.delete, 'removal') : null,
  ].filter(Boolean);

  return `This makes ${parts.join(', ')} in the data model.${plan.hasDestructive ? ' It removes data or changes field types.' : ''}`;
};

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const pretty = (value: unknown): string =>
  value === undefined ? '-' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);

function ChangeRow({ change }: { change: PlanChange }) {
  const [open, setOpen] = useState(false);
  const diff = change.diff ? Object.entries(change.diff) : [];
  const expandable = diff.length > 0 || Boolean(change.reason);
  const action = ACTION[change.action];

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        className="flex min-h-10 w-full items-center gap-3 px-1 py-2 text-left text-xs transition-colors enabled:hover:bg-background-hover/50"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cn('w-20 shrink-0 text-xs', action.className)}>{action.label}</span>
        <span className="min-w-0 flex-1 truncate">{change.label}</span>
        {change.destructive ? <Icon name="triangle-alert" className="size-3.5 shrink-0 text-destructive" /> : null}
        {expandable ? (
          <Icon
            name="chevron-down"
            className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          />
        ) : null}
      </button>
      {open ? (
        <div className="flex flex-col gap-3 px-1 pb-4 pl-[6.25rem]">
          {change.reason ? <p className="text-xs text-muted-foreground">{change.reason}</p> : null}
          <p className="font-mono text-xs text-muted-foreground">{change.id}</p>
          {diff.map(([attr, { from, to }]) => (
            <div key={attr} className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{attr}</span>
              <div className="grid gap-1.5 md:grid-cols-2">
                {(
                  [
                    ['Before', from],
                    ['After', to],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <div className="mb-1 text-xs text-muted-foreground">{label}</div>
                    <pre
                      className={cn(
                        'max-h-56 overflow-auto bg-muted p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all',
                        label === 'Before' ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      {pretty(value)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * A plan as a review: one sentence, then the changes grouped by kind; each opens to
 * show before and after. `pending` says the module itself is not installed or not at this version, which applying
 * fixes even when no object, field or view changes (a module that only declares settings, actions and events, for
 * instance).
 */
export function PlanDiffViewer({ plan, pending }: { plan: PlanResult; pending?: 'install' | 'update' }) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const counts = summarizePlan(plan);
  const changed = plan.changes.length - counts.noop;
  const groups = new Map<string, PlanChange[]>();

  for (const change of plan.changes) {
    if (change.action === 'noop' && !showUnchanged) {
      continue;
    }

    const list = groups.get(change.kind) ?? [];
    list.push(change);
    groups.set(change.kind, list);
  }

  const parts = [
    counts.create ? plural(counts.create, 'new item') : null,
    counts.update ? plural(counts.update, 'change') : null,
    counts.delete ? plural(counts.delete, 'removal') : null,
    counts.conflict ? plural(counts.conflict, 'conflict') : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4" data-slot="plan-diff">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-xs text-muted-foreground">
          {changed === 0 ? (
            pending === 'install' ? (
              'Nothing in the data model changes: installing adds the module, with its connections, actions and events.'
            ) : pending === 'update' ? (
              'Nothing in the data model changes: applying records the new version, with its connections, actions and events.'
            ) : (
              'Everything is up to date: applying would change nothing.'
            )
          ) : (
            <>
              Applying this makes <span className="text-foreground">{parts.join(', ')}</span>
              {counts.noop ? `; ${plural(counts.noop, 'item')} already match.` : '.'}
            </>
          )}
        </p>
        <span className="ms-auto font-mono text-xs text-muted-foreground">
          {plan.fromVersion ?? 'none'} → {plan.toVersion}
        </span>
      </div>
      {groups.size > 0 ? (
        <div className="flex flex-col gap-4">
          {[...groups.entries()].map(([kind, changes]) => (
            <section key={kind} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-semibold">{KIND_LABEL[kind] ?? kind}</h3>
              <ul className="border-y border-border">
                {changes.map((change) => (
                  <ChangeRow key={change.id} change={change} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {counts.noop > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          onClick={() => setShowUnchanged((v) => !v)}
        >
          {showUnchanged ? 'Hide unchanged' : `Show ${counts.noop} unchanged`}
        </Button>
      ) : null}
    </div>
  );
}
