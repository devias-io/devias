import { createMockAuthAdapter } from '@devias/sdk/mock';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../src/providers/auth';
import { UserMenu } from '../src/shell/user-menu';
import { createFakeClient, recordsFixture, schemaFixture, TestProviders } from '../src/testing';

afterEach(cleanup);

describe('the user menu', () => {
  it('puts the initials in ink on the avatar amber when there is no picture, never a bare grey', () => {
    render(
      <AuthProvider value={createMockAuthAdapter()}>
        <TestProviders client={createFakeClient(schemaFixture(), recordsFixture())}>
          <UserMenu compact />
        </TestProviders>
      </AuthProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Account menu' });
    const fallback = trigger.querySelector('[data-slot="avatar-fallback"]');
    expect(fallback?.textContent).toBe('TU');
    // The same amber in both themes, with ink on it.
    expect(fallback?.className).toContain('bg-avatar');
    expect(fallback?.className).toContain('text-avatar-foreground');
    expect(fallback?.className).not.toContain('bg-muted');
    // The hover background follows the circle of the avatar.
    expect(trigger.className).toContain('rounded-full');
  });
});
