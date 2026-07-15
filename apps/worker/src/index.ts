import { getEnv } from '@hood-sentry/config';
import { createDatabase } from '@hood-sentry/db';
import { createLogger } from '@hood-sentry/observability';
import { createDerivedJobWorker, createQueueConnection } from '@hood-sentry/queue';
import { createDerivedJobRouter } from './derived-job-router.js';

async function main() {
  const env = getEnv();
  const logger = createLogger({ level: env.LOG_LEVEL as 'info', service: 'worker' });

  let isShuttingDown = false;

  const database = createDatabase(env.DATABASE_URL);
  const workerConnection = createQueueConnection(env.REDIS_URL);
  const deadLetterConnection = createQueueConnection(env.REDIS_URL);

  const runner = createDerivedJobWorker({
    connection: workerConnection,
    deadLetterConnection,
    handler: createDerivedJobRouter(logger, database),
    onDeadLetter: (record) => {
      logger.error('Derived job dead-lettered after exhausting retries', {
        type: record.payload.type,
        originalJobId: record.originalJobId,
        attemptsMade: record.attemptsMade,
        failedReason: record.failedReason,
      });
    },
    onError: (error) => {
      logger.error('Derived job worker error', { error: error.message });
    },
  });

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Shutdown signal received', { signal });
    await runner.close();
    await workerConnection.quit();
    await deadLetterConnection.quit();
    await database.close();
    logger.info('Worker stopped gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('Worker ready, consuming derived jobs');
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: fatal startup error
  console.error('Worker failed to start:', err);
  process.exit(1);
});
