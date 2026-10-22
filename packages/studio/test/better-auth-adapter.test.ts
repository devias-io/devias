import { describe, expect, it, vi } from 'vitest';
import { type BetterAuthClientLike, betterAuthAdapter } from '../src/auth/better-auth-adapter';

const clientWith = (signIn: Partial<BetterAuthClientLike['signIn']>) =>
  ({ signIn: { email: vi.fn(), ...signIn } }) as unknown as BetterAuthClientLike;

describe('betterAuthAdapter sign-in with a provider', () => {
  it('is absent when the client has no social sign-in', () => {
    expect(betterAuthAdapter(clientWith({})).signInWithProvider).toBeUndefined();
  });

  it('hands the provider and the way back to the client, and reports nothing for a success', async () => {
    const social = vi.fn(async () => ({ data: {}, error: null }));
    const adapter = betterAuthAdapter(clientWith({ social }));
    expect(await adapter.signInWithProvider?.('google', { callbackURL: 'https://app.example.com/' })).toEqual({
      ok: true,
    });
    expect(social).toHaveBeenCalledWith({ provider: 'google', callbackURL: 'https://app.example.com/' });
  });

  it('says Google is not set up when the server does not know the provider', async () => {
    const social = vi.fn(async () => ({
      data: null,
      error: { status: 404, code: 'PROVIDER_NOT_FOUND', message: 'Provider not found' },
    }));
    const result = await betterAuthAdapter(clientWith({ social })).signInWithProvider?.('google');
    expect(result).toEqual({ ok: false, error: 'Google sign-in is not set up on this server yet.' });
  });

  it('passes any other failure on as it is', async () => {
    const social = vi.fn(async () => ({ data: null, error: { status: 500, message: 'Something broke' } }));
    const result = await betterAuthAdapter(clientWith({ social })).signInWithProvider?.('google');
    expect(result).toEqual({ ok: false, error: 'Something broke' });
  });
});
