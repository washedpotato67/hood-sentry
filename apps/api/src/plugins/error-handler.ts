import type { Logger } from '@hood-sentry/observability';
import { AppError } from '@hood-sentry/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

function isZodError(error: Error): boolean {
  return Array.isArray(Reflect.get(error, 'issues'));
}

function httpStatus(error: Error): number | null {
  const value = Reflect.get(error, 'statusCode');
  return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599
    ? value
    : null;
}

function httpCode(error: Error, statusCode: number): string {
  const value = Reflect.get(error, 'code');
  return typeof value === 'string' && value.length > 0 ? value : `HTTP_${statusCode}`;
}

export function errorHandler(logger: Logger) {
  return async (error: Error, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    if (isZodError(error)) {
      logger.warn('Request validation failed', { requestId });
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request did not match the required schema.',
          requestId,
        },
      });
    }

    if (error instanceof AppError) {
      logger.warn('Application error', {
        requestId,
        code: error.code,
        statusCode: error.statusCode,
      });
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId,
          details: error.details,
        },
      });
    }

    const statusCode = httpStatus(error);
    if (statusCode !== null) {
      logger.warn('HTTP request rejected', {
        requestId,
        code: httpCode(error, statusCode),
        statusCode,
      });
      return reply.status(statusCode).send({
        error: {
          code: httpCode(error, statusCode),
          message:
            statusCode === 429
              ? 'Request rate limit exceeded.'
              : 'The request could not be processed.',
          requestId,
        },
      });
    }

    logger.error('Unhandled error', {
      requestId,
      err: error,
    });

    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId,
      },
    });
  };
}
