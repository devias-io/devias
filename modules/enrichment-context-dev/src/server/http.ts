import { type ModuleContext, RetryableError } from '@devias/server';

/** Context.dev's request helpers: a JSON call with error mapping. */

export const API = 'https://api.context.dev';
/** How errors name the provider: "Context.dev answered 402: …". */
export const NAME = 'Context.dev';

/** The workspace's connection, as an authorization header. */
export const auth = async (ctx: Pick<ModuleContext, 'connection'>) => ({
  authorization: `Bearer ${(await ctx.connection()).values.api_key ?? ''}`,
});

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** A provider's error message from a failed response, or the status line. */
const describeFailure = async (response: Response): Promise<string> => {
  let detail = '';

  try {
    const body = (await response.json()) as { message?: unknown; error?: { message?: unknown } | string };
    const message =
      typeof body.error === 'object' && body.error && 'message' in body.error ? body.error.message : body.error;
    detail = String(message ?? body.message ?? '').trim();
  } catch {
    // no JSON body
  }

  return `${NAME} answered ${response.status}${detail ? `: ${detail}` : ''}`;
};

/** How long `Retry-After` (seconds) says to wait, in milliseconds. */
const retryAfterMs = (response: Response): number | undefined => {
  const seconds = Number(response.headers.get('retry-after'));

  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
};

/**
 * Call Context.dev and return its JSON. A non-2xx answer becomes a `ProviderError` with the provider's message. A 401
 * marks the connection as refused, so people are asked to replace the key. A rate limit, a timeout or a server error
 * becomes a `RetryableError`, so a workflow tries the step again later.
 */
export const request = async <T = unknown>(
  ctx: Pick<ModuleContext, 'fetch' | 'reportAuthFailure'>,
  path: string,
  json: unknown,
  headers: Record<string, string>,
): Promise<T> => {
  let response: Response;

  try {
    response = await ctx.fetch(`${API}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
      body: JSON.stringify(json),
    });
  } catch (error) {
    throw new RetryableError(`${NAME} could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (response.ok) {
    return (await response.json()) as T;
  }

  const message = await describeFailure(response);

  if (response.status === 401) {
    ctx.reportAuthFailure(message);
  }

  if (response.status === 429 || response.status === 408 || response.status >= 500) {
    throw new RetryableError(message, retryAfterMs(response));
  }

  throw new ProviderError(
    response.status === 402 ? `${message}. The account is out of credits` : message,
    response.status,
  );
};
