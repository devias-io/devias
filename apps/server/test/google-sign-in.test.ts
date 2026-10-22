import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('Google sign-in', () => {
  it('is off until both the client id and the secret are set', () => {
    expect(loadConfig({}).google).toBeUndefined();
    expect(loadConfig({ GOOGLE_CLIENT_ID: 'id' }).google).toBeUndefined();
    expect(loadConfig({ GOOGLE_CLIENT_SECRET: 'secret' }).google).toBeUndefined();
  });

  it('turns on with both', () => {
    expect(loadConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }).google).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
    });
  });
});
