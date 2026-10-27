import type { PlanChange, PlanResult } from '@devias/core';
import { summarizePlan } from '@devias/core';
import pc from 'picocolors';

const ACTION_STYLE: Record<PlanChange['action'], (s: string) => string> = {
  create: pc.green,
  update: pc.yellow,
  delete: pc.red,
  noop: pc.dim,
  conflict: pc.magenta,
};

const ACTION_SIGN: Record<PlanChange['action'], string> = {
  create: '+',
  update: '~',
  delete: '-',
  noop: '=',
  conflict: '!',
};

/** A role as lines: object access first, then permissions; what `added` holds is marked new. */
export const renderPlan = (plan: PlanResult, opts: { showNoop?: boolean } = {}): string => {
  const lines: string[] = [];
  const counts = summarizePlan(plan);
  lines.push(
    pc.bold(`${plan.moduleId}`) +
      pc.dim(` ${plan.fromVersion ?? '(not installed)'} → ${plan.toVersion}`) +
      pc.dim(`  manifest ${plan.manifestHash.slice(0, 10)}  plan ${plan.planHash.slice(0, 10)}`),
  );
  lines.push('');

  for (const change of plan.changes) {
    if (change.action === 'noop' && !opts.showNoop) {
      continue;
    }

    const style = ACTION_STYLE[change.action];
    const flag = change.destructive ? pc.red(' [destructive]') : '';
    lines.push(`  ${style(ACTION_SIGN[change.action])} ${style(change.kind.padEnd(11))} ${change.id}${flag}`);

    if (change.reason) {
      lines.push(pc.dim(`      ${change.reason}`));
    }

    if (change.diff) {
      for (const [attr, { from, to }] of Object.entries(change.diff)) {
        lines.push(pc.dim(`      ${attr}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`));
      }
    }
  }

  lines.push('');
  lines.push(
    `  ${pc.green(`${counts.create} to create`)}, ${pc.yellow(`${counts.update} to update`)}, ${pc.red(`${counts.delete} to delete`)}, ${pc.dim(`${counts.noop} unchanged`)}` +
      (counts.conflict ? `, ${pc.magenta(`${counts.conflict} conflicts`)}` : ''),
  );

  if (plan.hasDestructive) {
    lines.push(pc.red('  Plan contains destructive changes; apply requires --allow-destructive.'));
  }

  if (plan.hasConflicts) {
    lines.push(pc.magenta('  Plan has conflicts with entities owned elsewhere; apply will refuse.'));
  }

  return lines.join('\n');
};
