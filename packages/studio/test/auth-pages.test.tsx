import { createMockAuthAdapter } from '@devias/sdk/mock';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignInPage } from '../src/auth/pages/sign-in';
import { SignUpPage } from '../src/auth/pages/sign-up';
import { AuthProvider } from '../src/providers/auth';
import { createFakeClient, recordsFixture, schemaFixture, TestProviders } from '../src/testing';

afterEach(cleanup);

const renderPage = (page: React.ReactNode, auth = createMockAuthAdapter({ signedIn: false })) =>
  render(
    <AuthProvider value={auth}>
      <TestProviders client={createFakeClient(schemaFixture(), recordsFixture())}>{page}</TestProviders>
    </AuthProvider>,
  );

describe('auth pages', () => {
  it('signs in on a split screen, with a password you can reveal', () => {
    renderPage(<SignInPage />);
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create one' })).toBeTruthy();
  });

  it('asks for a name, an email and a password to create an account', () => {
    renderPage(<SignUpPage />);
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
  });

  it('offers Google only when the adapter can sign in with it, and says so when the server has it off', async () => {
    renderPage(<SignInPage />);
    expect(screen.queryByRole('button', { name: /Continue with Google/ })).toBeNull();
    cleanup();

    const signInWithProvider = vi.fn(async () => ({
      ok: false,
      error: 'Google sign-in is not set up on this server yet.',
    }));
    renderPage(<SignInPage />, { ...createMockAuthAdapter({ signedIn: false }), signInWithProvider });
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not set up on this server yet'));
    expect(signInWithProvider).toHaveBeenCalledWith('google', { callbackURL: `${window.location.origin}/` });
  });
});
