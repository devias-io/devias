import type { ApiErrorCode } from '@devias/core';
import { isEngineError } from '@devias/data-engine';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

export const STATUS_BY_CODE: Record<ApiErrorCode, ContentfulStatusCode> = {
  VALIDATION: 400,
  INVALID_CURSOR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNIQUE_VIOLATION: 409,
  PLAN_MISMATCH: 409,
  DESTRUCTIVE_CHANGE: 409,
  MISSING_DEPENDENCY: 422,
  RATE_LIMITED: 429,
  NETWORK: 502,
  INTERNAL: 500,
};

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

export class HttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const errorBody = (code: ApiErrorCode, message: string, details?: unknown): ApiErrorBody => ({
  error: details === undefined ? { code, message } : { code, message, details },
});

const isAuthApiError = (
  error: unknown,
): error is { statusCode?: number; status?: string; message: string; body?: { code?: string } } =>
  typeof error === 'object' && error !== null && 'statusCode' in error && 'status' in error;

const codeForStatus = (status: number): ApiErrorCode => {
  switch (status) {
    case 400:
      return 'VALIDATION';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL';
  }
};

/** Map anything thrown from a handler to `{ error: { code, message, details? } }` with the right status. */
export const toErrorResponse = (
  error: unknown,
  log: (message: string, meta?: unknown) => void,
): { status: ContentfulStatusCode; body: ApiErrorBody } => {
  if (isEngineError(error) || error instanceof HttpError) {
    return { status: STATUS_BY_CODE[error.code], body: errorBody(error.code, error.message, error.details) };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      body: errorBody('VALIDATION', 'Validation failed', {
        issues: error.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.code, message: i.message })),
      }),
    };
  }

  if (isAuthApiError(error)) {
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    const code = codeForStatus(status);

    return {
      status: status as ContentfulStatusCode,
      body: errorBody(
        code,
        error.message || 'Authentication error',
        error.body?.code ? { authCode: error.body.code } : undefined,
      ),
    };
  }

  log('unhandled error', error);

  return { status: 500, body: errorBody('INTERNAL', 'Internal server error') };
};

export const sendError = (c: Context, code: ApiErrorCode, message: string, details?: unknown) =>
  c.json(errorBody(code, message, details), STATUS_BY_CODE[code]);
