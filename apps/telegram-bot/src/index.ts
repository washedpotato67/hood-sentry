import { getEnv } from '@hood-sentry/config';
import { createLogger } from '@hood-sentry/observability';

async function main() {
  const env = getEnv();
  const logger = createLogger({ level: env.LOG_LEVEL as 'info', service: 'telegram-bot' });

  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Shutdown signal received', { signal });
    logger.info('Telegram bot stopped gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  if (!env.TELEGRAM_BOT_TOKEN) {
    logger.warn('TELEGRAM_BOT_TOKEN not configured — bot will not start');
    return;
  }

  logger.info('Telegram bot starting — skeleton process running');
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: fatal startup error
  console.error('Telegram bot failed to start:', err);
  process.exit(1);
});
