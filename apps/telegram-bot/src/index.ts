import { getEnv } from '@hood-sentry/config';
import { createLogger } from '@hood-sentry/observability';
import { TelegramPollingBot } from './bot.js';

async function main() {
  const env = getEnv();
  const logger = createLogger({ level: env.LOG_LEVEL as 'info', service: 'telegram-bot' });
  if (env.TELEGRAM_BOT_TOKEN === undefined) {
    logger.warn('Telegram bot is disabled because TELEGRAM_BOT_TOKEN is unset');
    return;
  }
  const controller = new AbortController();
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info('Shutdown signal received', { signal });
    controller.abort();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  logger.info('Telegram bot polling started');
  await new TelegramPollingBot(
    env.TELEGRAM_BOT_TOKEN,
    env.SENTRY_API_INTERNAL_URL,
    fetch,
    (error) => logger.warn('Telegram polling request failed', { code: error.message }),
  ).run(controller.signal);
  logger.info('Telegram bot stopped');
}

main().catch((error) => {
  // biome-ignore lint/suspicious/noConsole: fatal startup error
  console.error('Telegram bot failed to start:', error instanceof Error ? error.message : 'error');
  process.exit(1);
});
