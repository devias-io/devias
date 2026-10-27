import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ModuleContext } from '@devias/server';

/** Resend's request helpers: JSON calls with error mapping, HMAC comparison, address lists from workflow input. */

export const API = 'https://api.resend.com';
/** How errors name the provider: "Resend answered 422: …". */
export const NAME = 'Resend';

/** The workspace's (or the caller's) connection, as an authorization header. */
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

export interface JsonRequest {
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  /** Sent as JSON. */
  json?: unknown;
}

/**
 * Call Resend and return its JSON; a non-2xx answer becomes a `ProviderError` with the provider's message, and a 401
 * marks the connection as refused, so people are asked to replace the key.
 */
export const request = async <T = unknown>(
  ctx: Pick<ModuleContext, 'fetch'> & Partial<Pick<ModuleContext, 'reportAuthFailure'>>,
  name: string,
  url: string,
  init: JsonRequest = {},
): Promise<T> => {
  const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
  let body: string | undefined;

  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
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

export const hmacSha256 = (secret: string | Buffer, payload: string): Buffer =>
  createHmac('sha256', secret).update(payload, 'utf8').digest();

/** Constant-time comparison of a signature against the expected bytes; wrong lengths compare false. */
export const signatureMatches = (expected: Buffer, given: Buffer): boolean =>
  expected.length === given.length && timingSafeEqual(expected, given);

/** Is `timestamp` (seconds) within `toleranceSeconds` of now? Old deliveries are refused against replays. */
export const timestampFresh = (timestamp: number, toleranceSeconds: number, now: number = Date.now()): boolean =>
  Number.isFinite(timestamp) && Math.abs(now / 1000 - timestamp) <= toleranceSeconds;

/** Split `a@x.com, b@y.com` into a list; a list passes through. */
export const addressList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(String)
    : String(value ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
