import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { getEnv } from '@hood-sentry/config';
import { DrizzleProtocolRepositoryImpl, createDatabase } from '@hood-sentry/db';
import { createLogger } from '@hood-sentry/observability';
import { generateRequestId } from '@hood-sentry/shared';
import Fastify from 'fastify';
import { errorHandler } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { protocolRoutes } from './routes/protocols.js';

export async function buildApp() {
  const env = getEnv();
  const logger = createLogger({ level: env.LOG_LEVEL as 'info', service: 'api' });
  const database = createDatabase(env.DATABASE_URL);
  const protocolRepository = new DrizzleProtocolRepositoryImpl(database.db);

  const app = Fastify({
    logger: false,
    genReqId: () => generateRequestId(),
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
  });

  await app.register(cors, {
    origin: env.PUBLIC_APP_URL,
    credentials: true,
  });

  app.setErrorHandler(errorHandler(logger));

  app.decorateRequest('appLogger', null);

  app.addHook('onRequest', async (request) => {
    const requestId = request.id;
    (request as unknown as { appLogger: ReturnType<typeof createLogger> }).appLogger = logger.child(
      {
        requestId,
        bindings: {
          method: request.method,
          url: request.url,
        },
      },
    );
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(protocolRoutes, {
    prefix: '/v1',
    repository: protocolRepository,
  });

  app.addHook('onClose', async () => {
    await database.close();
  });

  return app;
}
