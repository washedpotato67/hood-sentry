import type { Database } from '@hood-sentry/db';
import type { Logger } from '@hood-sentry/observability';
import {
  type DerivedJobHandler,
  type DerivedJobPayload,
  type DerivedJobType,
  isDerivedJobType,
} from '@hood-sentry/queue';
import { processContractCreation } from './processors/contract-creation.js';
import { processTokenApproval } from './processors/token-approval.js';
import { processTokenTransfer } from './processors/token-transfer.js';
import type { Processor, ProcessorContext } from './processors/types.js';

/**
 * Job types that have a processor today. Adding a type to `DERIVED_JOB_TYPES`
 * without handling it here leaves it in `PENDING_JOB_TYPES` below.
 */
const PROCESSORS: Partial<Record<DerivedJobType, Processor>> = {
  'contract-creation': processContractCreation,
  'token-transfer': processTokenTransfer,
  'token-approval': processTokenApproval,
};

/**
 * Types the indexer publishes that are deliberately not processed yet. These are
 * acknowledged so the queue drains, and are listed explicitly so that "not built
 * yet" can never be confused with "silently dropped".
 */
const PENDING_JOB_TYPES: ReadonlySet<DerivedJobType> = new Set([
  'transaction',
  'log',
  'contract-replay',
  'pool-refresh',
  'token-metadata',
  'liquidity-analysis',
  'risk-analysis',
  'new-price-observation',
  'market-metric',
  'wallet-activity',
  'alert-evaluation',
  'source-reconciliation',
  'liquidity-metric',
  'protocol-enrichment',
  'bonding-curve-migration-transition',
]);

/**
 * Routes a derived job to its processor.
 *
 * An unrecognised type is thrown rather than acknowledged: it means a producer is
 * emitting something this worker cannot handle, and dead-lettering keeps the job for
 * inspection instead of discarding chain-derived work. Throwing also covers a
 * processor's own failure, which BullMQ retries before dead-lettering.
 */
export function createDerivedJobRouter(logger: Logger, database: Database): DerivedJobHandler {
  const context: ProcessorContext = { database, logger };

  return async (payload: DerivedJobPayload): Promise<void> => {
    if (!isDerivedJobType(payload.type)) {
      throw new Error(`Unrecognised derived job type: ${payload.type}`);
    }

    const processor = PROCESSORS[payload.type];
    if (processor === undefined) {
      if (!PENDING_JOB_TYPES.has(payload.type)) {
        throw new Error(`Derived job type has no processor and is not pending: ${payload.type}`);
      }
      logger.debug('Acknowledging derived job with no processor yet', {
        type: payload.type,
        blockNumber: payload.blockNumber,
      });
      return;
    }

    await processor(payload, context);
    logger.debug('Processed derived job', {
      type: payload.type,
      chainId: payload.chainId,
      blockNumber: payload.blockNumber,
    });
  };
}
