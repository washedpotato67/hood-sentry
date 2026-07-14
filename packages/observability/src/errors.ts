import type { SerializedError } from './types.js';

export function serializeError(error: unknown, includeStack = false): SerializedError {
  if (error instanceof Error) {
    const serialized: SerializedError = {
      name: error.name,
      message: error.message,
    };

    const appError = error as Error & {
      code?: string;
      statusCode?: number;
      cause?: unknown;
    };

    if (appError.code) {
      serialized.code = appError.code;
    }
    if (appError.statusCode) {
      serialized.statusCode = appError.statusCode;
    }
    if (includeStack && error.stack) {
      serialized.stack = error.stack;
    }
    if (appError.cause) {
      serialized.cause = serializeError(appError.cause, includeStack);
    }

    return serialized;
  }

  if (typeof error === 'string') {
    return { name: 'Error', message: error };
  }

  return { name: 'UnknownError', message: String(error) };
}

export function normalizeErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const appError = error as Error & { code?: string };
    if (appError.code) return appError.code;
    return error.name || 'UNKNOWN_ERROR';
  }
  return 'UNKNOWN_ERROR';
}

export function normalizeErrorStatus(error: unknown): number {
  if (error instanceof Error) {
    const appError = error as Error & { statusCode?: number };
    if (appError.statusCode) return appError.statusCode;
  }
  return 500;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('network') ||
      message.includes('rate limit')
    ) {
      return true;
    }

    const appError = error as Error & { statusCode?: number };
    if (appError.statusCode && appError.statusCode >= 500 && appError.statusCode < 600) {
      return true;
    }
  }
  return false;
}
