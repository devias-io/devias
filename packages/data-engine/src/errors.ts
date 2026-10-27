import type { ApiErrorCode } from '@devias/core';
import type { ZodError } from 'zod';

/** The one error type the engine throws for expected failures; the server maps `code` to an HTTP status. */
export class EngineError extends Error {
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.details = details;
  }
}

export const isEngineError = (error: unknown): error is EngineError => error instanceof EngineError;

export const validationError = (message: string, details?: unknown): EngineError =>
  new EngineError('VALIDATION', message, details);

export const notFound = (what: string, id?: string): EngineError =>
  new EngineError('NOT_FOUND', id === undefined ? `${what} not found` : `${what} "${id}" not found`);

export const forbidden = (message = 'Forbidden'): EngineError => new EngineError('FORBIDDEN', message);

export const fromZodError = (error: ZodError, message = 'Validation failed'): EngineError =>
  new EngineError('VALIDATION', message, {
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
      message: issue.message,
    })),
  });

/** Postgres error codes we translate. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
/** A value the column cannot hold, e.g. a name where a uuid belongs. */
export const PG_INVALID_TEXT_REPRESENTATION = '22P02';

export const pgErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const direct = (error as { code?: unknown }).code;

  if (typeof direct === 'string') {
    return direct;
  }

  const cause = (error as { cause?: unknown }).cause;

  return cause ? pgErrorCode(cause) : undefined;
};

/** The message of the Postgres error inside a driver or Drizzle error (the one carrying the code), if any. */
export const pgErrorMessage = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const { code, message, cause } = error as { code?: unknown; message?: unknown; cause?: unknown };

  if (typeof code === 'string') {
    return typeof message === 'string' ? message : undefined;
  }

  return cause ? pgErrorMessage(cause) : undefined;
};
