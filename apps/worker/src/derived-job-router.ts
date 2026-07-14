import type { Logger } from '@hood-sentry/observability';
import type { DerivedJobHandler, DerivedJobPayload } from '@hood-sentry/queue';

/**
 * Routes a derived job to its processor by type. Unknown types are acknowledged
 * with a warning rather than thrown, so a new indexer job type never wedges the
 * queue; known types with no processor yet are acknowledged as a no-op.
 *
 * Processors are added here as each derived pipeline is implemented. Throwing
 * from a processor triggers BullMQ retry and, once exhausted, dead-lettering.
 */
export function createDerivedJobRouter(logger: Logger): DerivedJobHandler {
  const known = new Set([
    'transaction',
    'log',
    'contract',
    'token',
    'pool',
    'swap',
    'liquidity',
    'launchpad',
  ]);

  return async (payload: DerivedJobPayload): Promise<void> => {
    if (!known.has(payload.type)) {
      logger.warn('Acknowledging unknown derived job type', {
        type: payload.type,
        chainId: payload.chainId,
        blockNumber: payload.blockNumber,
      });
      return;
    }
    logger.debug('Processing derived job', {
      type: payload.type,
      chainId: payload.chainId,
      blockNumber: payload.blockNumber,
    });
    // Concrete per-type processing is wired in as each pipeline lands.
  };
}
