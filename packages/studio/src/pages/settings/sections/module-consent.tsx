import type { PolicyDecision, PolicyDefinition } from '@devias/core';
import { cn } from '@devias/ui';

const DECISION: Record<PolicyDecision, { label: string; className: string }> = {
  review: { label: 'Review', className: 'text-foreground' },
  auto: { label: 'Automatic', className: 'text-muted-foreground' },
  deny: { label: 'Refused', className: 'text-destructive' },
};

function _Row({ label, detail, added, flat }: { label: string; detail?: string; added?: boolean; flat?: boolean }) {
  return (
    <li
      className={cn(
        'flex min-h-9 items-center gap-3 border-b border-border py-2 text-xs last:border-b-0',
        flat ? 'px-0' : 'px-4',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail ? <span className="shrink-0 text-xs text-muted-foreground">{detail}</span> : null}
      {added ? <span className="shrink-0 text-xs text-warning">New</span> : null}
    </li>
  );
}

/** A module's defaults for what needs review, each with its decision. Shown, not yet applied. */
export function ModulePolicies({
  policies,
  flat,
}: {
  policies: Pick<PolicyDefinition, 'description' | 'decision'>[];
  /** Between hairlines, for a page; by default boxed, for a card. */
  flat?: boolean;
}) {
  return (
    <ul
      className={flat ? 'border-y border-border' : 'rounded-lg border border-border bg-card'}
      data-slot="module-policies"
    >
      {policies.map((policy) => (
        <li
          key={policy.description}
          className={cn(
            'flex min-h-9 items-center gap-3 border-b border-border py-2 text-xs last:border-b-0',
            flat ? 'px-0' : 'px-4',
          )}
        >
          <span className="min-w-0 flex-1">{policy.description}</span>
          <span className={cn('shrink-0 text-xs', DECISION[policy.decision].className)}>
            {DECISION[policy.decision].label}
          </span>
        </li>
      ))}
    </ul>
  );
}
