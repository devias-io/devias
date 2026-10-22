import { describe, expect, it } from 'vitest';
import { resendWebhook } from '../../src/server/webhook/parse';
import { contextWith, fakeFetch, svixHeaders } from '../helpers';

const secret = `whsec_${Buffer.from('resend-signing-secret').toString('base64')}`;

describe('resendWebhook', () => {
  it('verifies Svix signatures on webhooks and rejects bad or stale ones', async () => {
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_123' } });
    const ctx = contextWith(
      { api_key: 're', webhook_secret: secret },
      fakeFetch(() => ({})),
    );
    const parse = async (headers: Record<string, string>, context = ctx) =>
      resendWebhook.parse({ headers: new Headers(headers), body }, context);
    expect(await parse(svixHeaders(secret, body))).toEqual([
      {
        type: 'email.delivered',
        externalId: 'msg_1',
        payload: { type: 'email.delivered', data: { email_id: 'em_123' } },
      },
    ]);
    await expect(parse(svixHeaders(`whsec_${Buffer.from('other').toString('base64')}`, body))).rejects.toThrow(
      'signature does not match',
    );
    await expect(parse(svixHeaders(secret, body, 'msg_2', 1_000_000))).rejects.toThrow('too old');
    await expect(parse({})).rejects.toThrow('Missing Svix');
    const without = contextWith(
      { api_key: 're' },
      fakeFetch(() => ({})),
    );
    await expect(parse(svixHeaders(secret, body), without)).rejects.toThrow('signing secret');
  });
});
