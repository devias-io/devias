import { describe, expect, it } from 'vitest';
import { sendEmail } from '../../src/server/actions/send-email';
import { contextWith, fakeFetch } from '../helpers';

describe('sendEmail', () => {
  it('sends an email with the API key and returns its id', async () => {
    const fetch = fakeFetch(() => ({ body: { id: 'em_123' } }));
    const ctx = contextWith({ api_key: 're_key' }, fetch);
    const result = await sendEmail.run(
      sendEmail.input.parse({
        from: 'Acme <hi@acme.test>',
        to: 'a@x.test, b@y.test',
        subject: 'Hi',
        html: '<p>Hi</p>',
      }),
      ctx,
    );
    expect(result).toEqual({ id: 'em_123' });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_key');
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'Acme <hi@acme.test>',
      to: ['a@x.test', 'b@y.test'],
      subject: 'Hi',
      html: '<p>Hi</p>',
    });
  });

  it('surfaces the provider error and refuses an email without a body', async () => {
    const fetch = fakeFetch(() => ({ status: 422, body: { message: 'The from address is not verified' } }));
    const ctx = contextWith({ api_key: 're_key' }, fetch);
    await expect(sendEmail.run({ from: 'x@y.test', to: 'a@x.test', subject: 'Hi', text: 'hi' }, ctx)).rejects.toThrow(
      'Resend answered 422: The from address is not verified',
    );
    await expect(sendEmail.run({ from: 'x@y.test', to: 'a@x.test', subject: 'Hi' }, ctx)).rejects.toThrow(
      'HTML body or a text body',
    );
  });
});
