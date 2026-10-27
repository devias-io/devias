import { defineActionHandler } from '@devias/server';
import { z } from 'zod';
import { ids } from '../../manifest/ids';
import { API, addressList, auth, NAME, ProviderError, request } from '../http';

const SendEmailInput = z.object({
  from: z.string().min(1),
  to: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  subject: z.string().min(1),
  html: z.string().optional(),
  text: z.string().optional(),
  reply_to: z.string().optional(),
  cc: z.union([z.string(), z.array(z.string())]).optional(),
  bcc: z.union([z.string(), z.array(z.string())]).optional(),
});

/** Sends a transactional email; an API key restricted to sending is enough. */
export const sendEmail = defineActionHandler({
  id: ids.actions.send_email,
  input: SendEmailInput,
  run: async (input, ctx) => {
    if (!input.html && !input.text) {
      throw new ProviderError('Give the email an HTML body or a text body');
    }

    const cc = addressList(input.cc);
    const bcc = addressList(input.bcc);
    const sent = await request<{ id: string }>(ctx, NAME, `${API}/emails`, {
      headers: await auth(ctx),
      json: {
        from: input.from,
        to: addressList(input.to),
        subject: input.subject,
        ...(input.html ? { html: input.html } : {}),
        ...(input.text ? { text: input.text } : {}),
        ...(input.reply_to ? { reply_to: input.reply_to } : {}),
        ...(cc.length > 0 ? { cc } : {}),
        ...(bcc.length > 0 ? { bcc } : {}),
      },
    });

    return { id: sent.id };
  },
});
