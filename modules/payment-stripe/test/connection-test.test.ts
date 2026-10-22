import { describe, expect, it } from 'vitest';
import { testStripe } from '../src/server/connection-test';
import { contextWith, fakeFetch } from './helpers';

describe('testStripe', () => {
  it('reports the mode on test and maps a rejected key', async () => {
    expect(
      await testStripe(
        contextWith(
          { secret_key: 'sk' },
          fakeFetch(() => ({ body: { livemode: false } })),
        ),
      ),
    ).toEqual({
      ok: true,
      message: 'Connected in test mode',
    });
    expect(
      await testStripe(
        contextWith(
          { secret_key: 'sk' },
          fakeFetch(() => ({ status: 401 })),
        ),
      ),
    ).toEqual({
      ok: false,
      message: 'Stripe rejected the secret key',
    });
  });
});
