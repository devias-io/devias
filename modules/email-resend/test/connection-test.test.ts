import { describe, expect, it } from 'vitest';
import { testConnection } from '../src/server/connection-test';
import { contextWith, fakeFetch } from './helpers';

describe('testResend', () => {
  it('tests the key against the domains endpoint, accepting sending-only keys', async () => {
    const ok = contextWith(
      { api_key: 're_key' },
      fakeFetch(() => ({
        body: {
          data: [
            { name: 'acme.test', status: 'verified' },
            { name: 'x', status: 'pending' },
          ],
        },
      })),
    );
    expect(await testConnection(ok)).toEqual({ ok: true, message: 'Connected; verified domains: acme.test' });
    expect(
      await testConnection(
        contextWith(
          { api_key: 'bad' },
          fakeFetch(() => ({ status: 401 })),
        ),
      ),
    ).toEqual({
      ok: false,
      message: 'Resend rejected the API key',
    });
    expect(
      (
        await testConnection(
          contextWith(
            { api_key: 're' },
            fakeFetch(() => ({ status: 403 })),
          ),
        )
      ).ok,
    ).toBe(true);
  });
});
