import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '../errors.js';

describe('AppError', () => {
  it('creates error with code and message', () => {
    const error = new AppError('TEST_ERROR', 'Test message', 400);
    expect(error.code).toBe('TEST_ERROR');
    expect(error.message).toBe('Test message');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('AppError');
  });

  it('includes details when provided', () => {
    const error = new AppError('TEST_ERROR', 'Test', 400, { field: 'email' });
    expect(error.details).toEqual({ field: 'email' });
  });

  it('defaults to 500 status code', () => {
    const error = new AppError('INTERNAL', 'Internal error');
    expect(error.statusCode).toBe(500);
  });
});

describe('NotFoundError', () => {
  it('creates 404 error with resource name', () => {
    const error = new NotFoundError('Token');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Token not found');
    expect(error.statusCode).toBe(404);
  });

  it('includes resource ID in message', () => {
    const error = new NotFoundError('Token', '0x1234');
    expect(error.message).toBe('Token 0x1234 not found');
  });
});

describe('UnauthorizedError', () => {
  it('creates 401 error', () => {
    const error = new UnauthorizedError();
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.statusCode).toBe(401);
  });

  it('accepts custom message', () => {
    const error = new UnauthorizedError('Invalid session');
    expect(error.message).toBe('Invalid session');
  });
});

describe('ForbiddenError', () => {
  it('creates 403 error', () => {
    const error = new ForbiddenError();
    expect(error.code).toBe('FORBIDDEN');
    expect(error.statusCode).toBe(403);
  });
});

describe('ValidationError', () => {
  it('creates 400 error', () => {
    const error = new ValidationError('Invalid input');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.statusCode).toBe(400);
  });

  it('includes validation details', () => {
    const error = new ValidationError('Invalid input', {
      fields: ['email', 'name'],
    });
    expect(error.details).toEqual({ fields: ['email', 'name'] });
  });
});

describe('ConflictError', () => {
  it('creates 409 error', () => {
    const error = new ConflictError('Resource already exists');
    expect(error.code).toBe('CONFLICT');
    expect(error.statusCode).toBe(409);
  });
});

describe('RateLimitError', () => {
  it('creates 429 error', () => {
    const error = new RateLimitError(60);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.statusCode).toBe(429);
    expect(error.details).toEqual({ retryAfterSeconds: 60 });
  });
});
