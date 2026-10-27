import type { PlanResult } from '@devias/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanDiffViewer } from '../src/pages/settings/sections/modules';

afterEach(cleanup);

const plan: PlanResult = {
  moduleId: '01a1751f-5f09-7114-9d75-ce42abd8a6ef',
  fromVersion: '0.1.0',
  toVersion: '0.2.0',
  manifestHash: 'manifest-hash',
  planHash: 'plan-hash',
  hasConflicts: false,
  hasDestructive: true,
  changes: [
    {
      kind: 'view',
      id: '01a17522-1eb6-7569-a9cf-6317c155bf19',
      label: 'View "All companies" on company',
      action: 'update',
      destructive: false,
      diff: { config: { from: { sorts: [] }, to: { sorts: [{ field: 'name', direction: 'asc' }] } } },
    },
    {
      kind: 'field',
      id: '01a17522-1eb6-7569-a9cf-65da89813311',
      label: 'Field "Tier" on company',
      action: 'create',
      destructive: false,
    },
    {
      kind: 'field',
      id: '01a17522-1eb6-7569-a9cf-6a7e5b51357e',
      label: 'Field "Fax" on company',
      action: 'delete',
      destructive: true,
      reason: 'Deletes field "company.fax" and its values',
    },
    {
      kind: 'object',
      id: '01a1751f-5f09-7114-9d75-c6298b7cb4b3',
      label: 'Object "Company"',
      action: 'noop',
      destructive: false,
    },
    {
      kind: 'object',
      id: '01a1751f-5f09-7114-9d75-bebf2c7785e8',
      label: 'Object "Person"',
      action: 'noop',
      destructive: false,
    },
  ],
};

describe('PlanDiffViewer', () => {
  it('summarizes the plan in a sentence and groups the changes, hiding unchanged ones', () => {
    render(<PlanDiffViewer plan={plan} />);
    const summary = screen.getByText(/Applying this makes/).textContent;
    expect(summary).toBe('Applying this makes 1 new item, 1 change, 1 removal; 2 items already match.');
    expect(screen.getByText('Views')).toBeTruthy();
    expect(screen.getByText('Fields')).toBeTruthy();
    expect(screen.queryByText('Objects')).toBeNull();
    expect(screen.getByText('Removed')).toBeTruthy();
    expect(screen.queryByText('Access it asks for')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 unchanged' }));
    expect(screen.getByText('Objects')).toBeTruthy();
    expect(screen.getAllByText('Unchanged')).toHaveLength(2);
  });

  it('opens a change to show its reason and a readable before / after', () => {
    render(<PlanDiffViewer plan={plan} />);
    const view = screen.getByRole('button', { name: /All companies/ });
    expect(view.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(view);
    expect(view.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Before')).toBeTruthy();
    const after = screen.getByText('After').nextElementSibling;
    expect(after?.textContent).toBe(JSON.stringify({ sorts: [{ field: 'name', direction: 'asc' }] }, null, 2));
    fireEvent.click(screen.getByRole('button', { name: /Fax/ }));
    expect(screen.getByText('Deletes field "company.fax" and its values')).toBeTruthy();
    // A change with nothing more to show is not expandable.
    expect((screen.getByRole('button', { name: /Tier/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
