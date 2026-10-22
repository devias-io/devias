import type { PlanResult } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { renderPlan } from '../src/render';

const plan: PlanResult = {
  moduleId: 'demo',
  fromVersion: null,
  toVersion: '1.0.0',
  manifestHash: 'abcdef0123456789',
  planHash: '0123456789abcdef',
  hasDestructive: true,
  hasConflicts: false,
  changes: [
    { kind: 'object', id: 'demo.thing', label: 'Thing', action: 'create', destructive: false },
    {
      kind: 'field',
      id: 'demo.thing.name',
      label: 'Name',
      action: 'update',
      destructive: false,
      diff: { label: { from: 'Name', to: 'Title' } },
    },
    {
      kind: 'view',
      id: 'demo.thing.old',
      label: 'Old',
      action: 'delete',
      destructive: true,
      reason: 'owned view removed',
    },
    { kind: 'nav_item', id: 'demo.sidebar', label: 'Thing', action: 'noop', destructive: false },
  ],
};

describe('renderPlan', () => {
  it('lists actionable changes with counts and hides noops by default', () => {
    const out = renderPlan(plan);
    expect(out).toContain('demo');
    expect(out).toContain('demo.thing');
    expect(out).toContain('label: "Name" → "Title"');
    expect(out).toContain('[destructive]');
    expect(out).toContain('1 to create');
    expect(out).toContain('1 unchanged');
    expect(out).not.toContain('demo.sidebar');
    expect(out).toContain('--allow-destructive');
  });

  it('shows noops when asked', () => {
    expect(renderPlan(plan, { showNoop: true })).toContain('demo.sidebar');
  });
});
