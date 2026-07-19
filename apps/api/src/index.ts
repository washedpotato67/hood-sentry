import { getEnv } from '@hood-sentry/config';
import { createLogger } from '@hood-sentry/observability';
import { buildApp } from './app.js';

// Written before any wiring runs so deploy logs prove the container entrypoint
// executed, even if boot later hangs or dies without reaching the logger.
// biome-ignore lint/suspicious/noConsole: boot marker, logger does not exist yet
console.log('[boot] api entrypoint reached');

async function main() {
  const env = getEnv();
  const logger = createLogger({ level: env.LOG_LEVEL as 'info', service: 'api' });
  const app = await buildApp();

  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Shutdown signal received', { signal });

    try {
      await app.close();
      logger.info('API server closed gracefully');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { err });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await app.listen({ port: env.API_PORT, host: env.API_HOST });
    logger.info('API server started', {
      port: env.API_PORT,
      host: env.API_HOST,
    });
  } catch (err) {
    logger.error('Failed to start API', { err });
    process.exit(1);
  }
}

main().catch((error) => {
  // Surface boot failures (e.g. bad config, failed dependency wiring) instead of
  // exiting silently — a silent crash-loop is invisible in deploy logs.
  // biome-ignore lint/suspicious/noConsole: logger may not be constructed yet at boot failure
  console.error(
    'API failed to start:',
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exit(1);
});
