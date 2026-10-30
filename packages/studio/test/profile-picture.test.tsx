import { type AuthAdapter, AVATAR_MAX_BYTES } from '@devias/core';
import { createMockClient } from '@devias/sdk/mock';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { profileSection } from '../src/pages/settings/sections/profile';
import { AuthProvider } from '../src/providers/auth';
import { createStaticNavigation } from '../src/router/navigation';
import { installLayoutStubs, TestProviders } from '../src/testing';

const invalidate = vi.fn(async () => {});
const toasts = { success: vi.fn(), error: vi.fn() };

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate }),
}));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => toasts.success(m), error: (m: string) => toasts.error(m) },
}));

beforeAll(installLayoutStubs);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const Profile = profileSection.component as ComponentType;

const show = (auth: Partial<AuthAdapter>) =>
  render(
    <AuthProvider value={{ updateUser: vi.fn(), changeEmail: vi.fn(), ...auth } as unknown as AuthAdapter}>
      <TestProviders
        client={createMockClient({ workspaceId: 'ws1', manifests: [] })}
        navigation={createStaticNavigation('/workspaces/acme/settings/profile')}
      >
        <Profile />
      </TestProviders>
    </AuthProvider>,
  );

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'me.png', { type: 'image/png' });
const chooser = () => screen.getByLabelText('Choose a picture') as HTMLInputElement;

describe('the picture on the profile page', () => {
  it('sets the picture from the file that is chosen, and reloads so it shows everywhere', async () => {
    const setAvatar = vi.fn(async () => {});
    show({ setAvatar, removeAvatar: vi.fn(async () => {}) });

    expect(
      screen.getByText(`A PNG, JPEG, WebP, GIF or AVIF of up to ${AVATAR_MAX_BYTES / 1024 / 1024} MB.`),
    ).toBeTruthy();
    expect(chooser().accept).toContain('image/png');
    const file = png();
    fireEvent.change(chooser(), { target: { files: [file] } });

    await waitFor(() => expect(setAvatar).toHaveBeenCalledWith(file));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Picture updated'));
    expect(invalidate).toHaveBeenCalled();
  });

  it('says why a picture was refused, and does not reload', async () => {
    show({ setAvatar: vi.fn(async () => Promise.reject(new Error('Use a PNG, JPEG, WebP, GIF or AVIF picture'))) });

    fireEvent.change(chooser(), { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Use a PNG, JPEG, WebP, GIF or AVIF picture'));
    expect(invalidate).not.toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('offers nothing where the adapter cannot store a picture', () => {
    show({});

    expect(screen.queryByLabelText('Choose a picture')).toBeNull();
    expect(screen.getByText('Personal details')).toBeTruthy();
  });
});
