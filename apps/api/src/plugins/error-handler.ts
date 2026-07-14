import type { Logger } from '@hood-sentry/observability';
import { AppError } from '@hood-sentry/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

export function errorHandler(logger: Logger) {
  return async (error: Error, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

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
