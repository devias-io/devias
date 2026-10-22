import type { ConnectionTest } from '@devias/server';
import { API, auth } from './http';

/** Checks the secret key against the balance endpoint and reports live or test mode. */
export const testStripe: ConnectionTest = async (ctx) => {
  let response: Response;

  try {
    response = await ctx.fetch(`${API}/balance`, { headers: await auth(ctx) });
  } catch (error) {
    return {
      ok: false,
      message: `Stripe could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (response.status === 401) {
    return { ok: false, message: 'Stripe rejected the secret key' };
  }

  if (!response.ok) {
    return { ok: false, message: `Stripe answered ${response.status}` };
  }

  const body = (await response.json().catch(() => ({}))) as { livemode?: boolean };

  return { ok: true, message: body.livemode ? 'Connected in live mode' : 'Connected in test mode' };
};
