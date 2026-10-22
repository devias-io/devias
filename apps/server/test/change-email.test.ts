import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { createTestServer, type Session, signIn, signUp } from './helpers';

describe('changing the email you sign in with', () => {
  let server: Server;
  let alice: Session;

  const post = (cookie: string, path: string, body: unknown) =>
    server.app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    server = await createTestServer();
    alice = await signUp(server, 'alice@example.com', 'Alice');
    await signUp(server, 'bob@example.com', 'Bob');
  });
  afterAll(() => server.close());

  it('applies at once, and the new address is the one to sign in with', async () => {
    const response = await post(alice.cookie, '/api/auth/change-email', { newEmail: 'Alice.New@Example.com' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });

    const me = await server.app.request('/api/me', { headers: { cookie: alice.cookie } });
    expect(((await me.json()) as { user?: { email: string }; email?: string }).user?.email ?? '').toBe(
      'alice.new@example.com',
    );
    const cookie = await signIn(server, 'alice.new@example.com');
    expect(cookie).toContain('session');
    const old = await server.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'password123' }),
    });
    expect(old.status).toBeGreaterThanOrEqual(400);
  });

  it('answers a taken address like a success, and changes nothing', async () => {
    const response = await post(alice.cookie, '/api/auth/change-email', { newEmail: 'bob@example.com' });
    expect(response.status).toBe(200);
    // Indistinguishable from a change that worked: that is the point, so clients read the session afterwards.
    expect(await response.json()).toEqual({ status: true });
    // Still signs in with the address before.
    expect(await signIn(server, 'alice.new@example.com')).toContain('session');
  });
});
