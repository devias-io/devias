import { DeviasApiError } from '@devias/core';

/**
 * Minimal fetch wrapper shared by the HTTP client, the workspace API and the SSE subscriber: base URL
 * joining, auth headers, JSON encoding, error mapping and the two retries the API contract asks for
 * (idempotent GETs once on a network error; any request once on 429 after `Retry-After`).
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type QueryParams = Record<string, string | number | boolean | null | undefined>;
/** The subset of `fetch` the SDK needs; `globalThis.fetch` satisfies it, as does a test stub. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  /** e.g. `http://localhost:3000`; paths are joined under it. */
  baseUrl: string;
  /** Sent as `x-api-key`. Without it the browser session cookie authenticates (`credentials: 'include'`). */
  apiKey?: string;
  fetch?: FetchLike;
  credentials?: RequestCredentials;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
  /** Longest wait honoured from a `Retry-After` header, in ms (default 5000). */
  maxRetryAfterMs?: number;
}

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: QueryParams;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Retry once when the network fails before any response arrives. Defaults to `true` for GET only. */
  retryOnNetworkError?: boolean;
}

export interface HttpClient {
  readonly baseUrl: string;
  readonly fetch: FetchLike;
  readonly credentials: RequestCredentials;
  /** Auth and custom headers applied to every request (also used by the SSE subscriber). */
  headers(): Record<string, string>;
  url(path: string, query?: QueryParams): string;
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  get<T = unknown>(
    path: string,
    query?: QueryParams,
    options?: Omit<RequestOptions, 'method' | 'body' | 'query'>,
  ): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  delete<T = unknown>(path: string, options?: Omit<RequestOptions, 'method'>): Promise<T>;
}

export const DEFAULT_MAX_RETRY_AFTER_MS = 5_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;

export const normalizeBaseUrl = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, '');

export const joinUrl = (baseUrl: string, path: string, query?: QueryParams): string => {
  const base = normalizeBaseUrl(baseUrl);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) {
      continue;
    }

    params.set(key, String(value));
  }

  const qs = params.toString();

  if (!qs) {
    return `${base}${suffix}`;
  }

  return `${base}${suffix}${suffix.includes('?') ? '&' : '?'}${qs}`;
};

/** Parse a `Retry-After` header (seconds or an HTTP date) into a wait in ms, clamped to `[0, maxMs]`. */
export const parseRetryAfter = (
  header: string | null,
  maxMs = DEFAULT_MAX_RETRY_AFTER_MS,
  now: number = Date.now(),
): number => {
  const trimmed = header?.trim() ?? '';

  if (trimmed === '') {
    return Math.min(DEFAULT_RETRY_AFTER_MS, maxMs);
  }

  let ms: number;

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else {
    const date = Date.parse(trimmed);
    ms = Number.isNaN(date) ? DEFAULT_RETRY_AFTER_MS : date - now;
  }

  return Math.max(0, Math.min(ms, maxMs));
};

const isAbortError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const isErrorBody = (value: unknown): value is ErrorBody => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const error = (value as { error?: unknown }).error;

  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
};

/** Map a failed response to the `DeviasApiError` every client implementation throws. */
export const errorFromResponse = async (response: Response): Promise<DeviasApiError> => {
  let text = '';

  try {
    text = await response.text();
  } catch {
    // unreadable body: fall through to the generic error
  }

  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);

      if (isErrorBody(parsed)) {
        return new DeviasApiError(response.status, parsed.error.code, parsed.error.message, parsed.error.details);
      }
    } catch {
      // not JSON
    }
  }

  const message = response.statusText ? `${response.status} ${response.statusText}` : `HTTP ${response.status}`;

  return new DeviasApiError(response.status, 'INTERNAL', message, text ? text.slice(0, 500) : undefined);
};

const parseBody = async <T>(response: Response): Promise<T> => {
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const text = await response.text();

  if (text === '') {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DeviasApiError(
      response.status,
      'INTERNAL',
      'The server returned a non-JSON response',
      text.slice(0, 500),
    );
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const createHttpClient = (options: HttpClientOptions): HttpClient => {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const credentials = options.credentials ?? 'include';
  const maxRetryAfterMs = options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;

  const headers = (): Record<string, string> => ({
    ...(options.apiKey ? { 'x-api-key': options.apiKey } : {}),
    ...options.headers,
  });

  const request = async <T>(path: string, requestOptions: RequestOptions = {}): Promise<T> => {
    const method = requestOptions.method ?? 'GET';
    const url = joinUrl(baseUrl, path, requestOptions.query);
    const hasBody = requestOptions.body !== undefined;
    const init: RequestInit = {
      method,
      credentials,
      headers: {
        accept: 'application/json',
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        ...headers(),
        ...requestOptions.headers,
      },
      ...(hasBody ? { body: JSON.stringify(requestOptions.body) } : {}),
      ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
    };
    const retryOnNetworkError = requestOptions.retryOnNetworkError ?? method === 'GET';
    let networkRetried = false;
    let rateLimitRetried = false;

    for (;;) {
      let response: Response;

      try {
        response = await fetchImpl(url, init);
      } catch (error) {
        if (isAbortError(error) || requestOptions.signal?.aborted) {
          throw error;
        }

        if (retryOnNetworkError && !networkRetried) {
          networkRetried = true;
          continue;
        }

        throw new DeviasApiError(0, 'NETWORK', `Network error calling ${method} ${url}: ${errorMessage(error)}`, error);
      }

      if (response.status === 429 && !rateLimitRetried) {
        rateLimitRetried = true;
        await sleep(parseRetryAfter(response.headers.get('retry-after'), maxRetryAfterMs));
        continue;
      }

      if (!response.ok) {
        throw await errorFromResponse(response);
      }

      return parseBody<T>(response);
    }
  };

  return {
    baseUrl,
    fetch: fetchImpl,
    credentials,
    headers,
    url: (path, query) => joinUrl(baseUrl, path, query),
    request,
    get: (path, query, requestOptions) => request(path, { ...requestOptions, method: 'GET', query }),
    post: (path, body, requestOptions) => request(path, { ...requestOptions, method: 'POST', body }),
    patch: (path, body, requestOptions) => request(path, { ...requestOptions, method: 'PATCH', body }),
    delete: (path, requestOptions) => request(path, { ...requestOptions, method: 'DELETE' }),
  };
};
