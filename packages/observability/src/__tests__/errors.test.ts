import { describe, expect, it } from 'vitest';
import {
  isRetryableError,
  normalizeErrorCode,
  normalizeErrorStatus,
  serializeError,
} from '../errors.js';

describe('serializeError', () => {
  it('serializes a basic Error', () => {
    const error = new Error('Something went wrong');
    const result = serializeError(error);
    expect(result.name).toBe('Error');
    expect(result.message).toBe('Something went wrong');
    expect(result.stack).toBeUndefined();
  });

  it('serializes Error with stack when requested', () => {
    const error = new Error('Something went wrong');
    const result = serializeError(error, true);
    expect(result.stack).toBeDefined();
    expect(result.stack).toContain('Error: Something went wrong');
  });

  it('serializes Error with code property', () => {
    const error = Object.assign(new Error('Not found'), { code: 'NOT_FOUND' });
    const result = serializeError(error);
    expect(result.code).toBe('NOT_FOUND');
  });

  it('serializes Error with statusCode property', () => {
    const error = Object.assign(new Error('Forbidden'), { statusCode: 403 });
    const result = serializeError(error);
    expect(result.statusCode).toBe(403);
  });

  it('serializes nested cause', () => {
    const cause = new Error('Root cause');
    const error = Object.assign(new Error('Wrapper'), { cause });
    const result = serializeError(error);
    expect(result.cause).toBeDefined();
    expect(result.cause?.message).toBe('Root cause');
  });

  it('serializes string errors', () => {
    const result = serializeError('Something failed');
    expect(result.name).toBe('Error');
    expect(result.message).toBe('Something failed');
  });

  it('serializes unknown errors', () => {
    const result = serializeError(42);
    expect(result.name).toBe('UnknownError');
    expect(result.message).toBe('42');
  });

  it('serializes null', () => {
    const result = serializeError(null);
    expect(result.name).toBe('UnknownError');
    expect(result.message).toBe('null');
  });
});

describe('normalizeErrorCode', () => {
  it('returns code from Error with code property', () => {
    const error = Object.assign(new Error('test'), { code: 'VALIDATION_ERROR' });
    expect(normalizeErrorCode(error)).toBe('VALIDATION_ERROR');
  });

  it('returns error name when no code', () => {
    const error = new TypeError('type mismatch');
    expect(normalizeErrorCode(error)).toBe('TypeError');
  });

  it('returns UNKNOWN_ERROR for non-Error', () => {
    expect(normalizeErrorCode('string error')).toBe('UNKNOWN_ERROR');
    expect(normalizeErrorCode(42)).toBe('UNKNOWN_ERROR');
    expect(normalizeErrorCode(null)).toBe('UNKNOWN_ERROR');
  });
});

describe('normalizeErrorStatus', () => {
  it('returns statusCode from Error', () => {
    const error = Object.assign(new Error('Not found'), { statusCode: 404 });
    expect(normalizeErrorStatus(error)).toBe(404);
  });

  it('returns 500 for Error without statusCode', () => {
    expect(normalizeErrorStatus(new Error('test'))).toBe(500);
  });

  it('returns 500 for non-Error', () => {
    expect(normalizeErrorStatus('string')).toBe(500);
    expect(normalizeErrorStatus(null)).toBe(500);
  });
});

describe('isRetryableError', () => {
  it('returns true for timeout errors', () => {
    expect(isRetryableError(new Error('Request timeout'))).toBe(true);
  });

  it('returns true for connection reset errors', () => {
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
  });

  it('returns true for connection refused errors', () => {
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
  });

  it('returns true for network errors', () => {
    expect(isRetryableError(new Error('Network error occurred'))).toBe(true);
  });

  it('returns true for rate limit errors', () => {
    expect(isRetryableError(new Error('Rate limit exceeded'))).toBe(true);
  });

  it('returns true for 5xx status codes', () => {
    const error = Object.assign(new Error('Server error'), { statusCode: 503 });
    expect(isRetryableError(error)).toBe(true);
  });

  it('returns false for 4xx status codes', () => {
    const error = Object.assign(new Error('Bad request'), { statusCode: 400 });
    expect(isRetryableError(error)).toBe(false);
  });

  it('returns false for non-retryable errors', () => {
    expect(isRetryableError(new Error('Invalid input'))).toBe(false);
  });

  it('returns false for non-Error', () => {
    expect(isRetryableError('string')).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });
});
