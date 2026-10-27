import type { ConnectionTest } from '@devias/server';
import { API, auth, NAME } from './http';

/**
 * Checks the API key without spending credits: an enrichment request with nothing to go on is answered 400 (too few
 * clues) when the key is good and 401 when it is not, and nothing is matched, so nothing is charged.
 */
export const testConnection: ConnectionTest = async (ctx) => {
  let response: Response;

  try {
    response = await ctx.fetch(`${API}/v1/people/enrich`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(await auth(ctx)) },
      body: '{}',
    });
  } catch (error) {
    return {
      ok: false,
      message: `${NAME} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (response.status === 401) {
    return { ok: false, message: `${NAME} rejected the API key` };
  }

  if (response.status === 402) {
    return { ok: true, message: 'Connected, but the account is out of credits' };
  }

  if (response.status === 403) {
    return { ok: false, message: `${NAME} says this key is not allowed to look people up` };
  }

  // Too few clues is the answer a good key gets.
  if (response.status === 400 || response.status === 422) {
    return { ok: true, message: 'Connected' };
  }

  return { ok: false, message: `${NAME} answered ${response.status}` };
};
