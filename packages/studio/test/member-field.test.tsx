import type { FieldMetadata } from '@devias/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memberFieldType } from '../src/fields/member';
import { createFakeClient, recordsFixture, schemaFixture, TestProviders } from '../src/testing';

afterEach(cleanup);

const field = {
  id: 'f1',
  name: 'assignee',
  label: 'Assignee',
  type: 'member',
  settings: {},
  isRequired: false,
} as unknown as FieldMetadata & { settings: Record<string, never> };

const show = (ui: React.ReactNode) => {
  const schema = schemaFixture();

  return render(
    <TestProviders client={createFakeClient(schema, recordsFixture())} schema={schema}>
      {ui}
    </TestProviders>,
  );
};

describe('member field type', () => {
  it('shows a team member by name, and says so when they have left', () => {
    const Cell = memberFieldType.cell;
    show(<Cell field={field} value="u2" record={{ id: 'r1' } as never} object={{} as never} />);
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
    cleanup();
    show(<Cell field={field} value="u_gone" record={{ id: 'r1' } as never} object={{} as never} />);
    expect(screen.getByText('Former member')).toBeTruthy();
  });

  it('stores the user id, filters like a relation and is not sortable', () => {
    expect(memberFieldType.filter?.operators).toEqual(['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty']);
    expect(memberFieldType.sortable).toBe(false);
    expect(memberFieldType.toText('u2', field)).toBe('u2');
    expect(vi.isMockFunction(memberFieldType.cell)).toBe(false);
  });
});
