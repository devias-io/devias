import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ModuleContext } from '@devias/server';

/** Stripe's request helpers: form-encoded calls with error mapping, and HMAC comparison for webhooks. */

export const API = 'https://api.stripe.com/v1';
/** How errors name the provider: "Stripe answered 402: …". */
export const NAME = 'Stripe';

/** The workspace's (or the caller's) connection, as an authorization header. */
export const auth = async (ctx: Pick<ModuleContext, 'connection'>) => ({
  authorization: `Bearer ${(await ctx.connection()).values.secret_key ?? ''}`,
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
const describeFailure = async (name: string, response: Response): Promise<string> => {
  let detail = '';

  try {
    const body = (await response.json()) as { message?: unknown; error?: { message?: unknown } | string };
    const message =
      typeof body.error === 'object' && body.error && 'message' in body.error ? body.error.message : body.error;
    detail = String(message ?? body.message ?? '').trim();
  } catch {
    // no JSON body
  }

  return `${name} answered ${response.status}${detail ? `: ${detail}` : ''}`;
};

export interface FormRequest {
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  /** Sent as `application/x-www-form-urlencoded`. */
  form?: Record<string, string>;
}

/**
 * Call Stripe and return its JSON; a non-2xx answer becomes a `ProviderError` with the provider's message, and a 401
 * marks the connection as refused, so people are asked to replace the key.
 */
export const request = async <T = unknown>(
  ctx: Pick<ModuleContext, 'fetch'> & Partial<Pick<ModuleContext, 'reportAuthFailure'>>,
  name: string,
  url: string,
  init: FormRequest = {},
): Promise<T> => {
  const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
  let body: string | undefined;

  if (init.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(init.form).toString();
  }

  let response: Response;

  try {
    response = await ctx.fetch(url, { method: init.method ?? (body === undefined ? 'GET' : 'POST'), headers, body });
  } catch (error) {
    throw new ProviderError(`${name} could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    const message = await describeFailure(name, response);

    if (response.status === 401) {
      ctx.reportAuthFailure?.(message);
    }

    throw new ProviderError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

/** Flatten `{ a: { b: 1 }, c: [x] }` into Stripe's `a[b]=1&c[0]=x` form keys. */
export const formEncode = (value: unknown, prefix = '', into: Record<string, string> = {}): Record<string, string> => {
  if (value === null || value === undefined) {
    return into;
  }

  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      formEncode(item, `${prefix}[${i}]`, into);
    }
  } else if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      formEncode(item, prefix ? `${prefix}[${key}]` : key, into);
    }
  } else {
    into[prefix] = String(value);
  }

  return into;
};

export const hmacSha256 = (secret: string | Buffer, payload: string): Buffer =>
  createHmac('sha256', secret).update(payload, 'utf8').digest();

/** Constant-time comparison of a signature against the expected bytes; wrong lengths compare false. */
export const signatureMatches = (expected: Buffer, given: Buffer): boolean =>
  expected.length === given.length && timingSafeEqual(expected, given);

/** Is `timestamp` (seconds) within `toleranceSeconds` of now? Old deliveries are refused against replays. */
export const timestampFresh = (timestamp: number, toleranceSeconds: number, now: number = Date.now()): boolean =>
  Number.isFinite(timestamp) && Math.abs(now / 1000 - timestamp) <= toleranceSeconds;
