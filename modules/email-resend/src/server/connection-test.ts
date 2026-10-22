import type { ConnectionTest } from '@devias/server';
import { API, auth } from './http';

/** Checks the API key by listing domains, telling full-access keys from sending-only ones. */
export const testResend: ConnectionTest = async (ctx) => {
  let response: Response;

  try {
    response = await ctx.fetch(`${API}/domains`, { headers: await auth(ctx) });
  } catch (error) {
    return {
      ok: false,
      message: `Resend could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (response.status === 401) {
    return { ok: false, message: 'Resend rejected the API key' };
  }

  // Sending-only keys cannot list domains but do send email, which is all the action needs.
  if (response.status === 403) {
    return { ok: true, message: 'Connected with a sending-only key' };
  }

  if (!response.ok) {
    return { ok: false, message: `Resend answered ${response.status}` };
  }

  const body = (await response.json().catch(() => ({}))) as { data?: { name?: string; status?: string }[] };
  const verified = (body.data ?? []).filter((domain) => domain.status === 'verified').map((domain) => domain.name);

  return {
    ok: true,
    message:
      verified.length > 0 ? `Connected; verified domains: ${verified.join(', ')}` : 'Connected; no verified domain yet',
  };
};
