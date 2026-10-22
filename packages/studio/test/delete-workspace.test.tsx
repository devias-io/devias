import { createMockAuthAdapter } from '@devias/sdk/mock';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generalSection } from '../src/pages/settings/sections';
import { AuthProvider } from '../src/providers/auth';
import { createFakeClient, recordsFixture, schemaFixture, TestProviders } from '../src/testing';

afterEach(cleanup);

const setup = () => {
  const mock = createMockAuthAdapter();
  const remove = vi.fn(async (_organizationId: string) => {});
  const auth = { ...mock, organizations: { ...mock.organizations, delete: remove } };
  const General = generalSection.component;
  render(
    <AuthProvider value={auth}>
      <TestProviders client={createFakeClient(schemaFixture(), recordsFixture())}>
        <General />
      </TestProviders>
    </AuthProvider>,
  );

  return { remove };
};

describe('delete workspace', () => {
  it('asks for the address before it deletes, then removes the workspace and leaves it', async () => {
    const { remove } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Delete this workspace/ }));
    const confirm = () => screen.getByRole('button', { name: 'Delete workspace' });
    expect(confirm().hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Workspace address'), { target: { value: 'not-it' } });
    expect(confirm().hasAttribute('disabled')).toBe(true);
    expect(remove).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Workspace address'), { target: { value: 'acme' } });
    expect(confirm().hasAttribute('disabled')).toBe(false);
    fireEvent.click(confirm());
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.pathname).toBe('/workspaces'));
  });
});
