import type { Database } from '@hood-sentry/db';
import type { Logger } from '@hood-sentry/observability';
import {
  type DerivedJobHandler,
  type DerivedJobPayload,
  type DerivedJobType,
  isDerivedJobType,
} from '@hood-sentry/queue';
import { processAlertEvaluation } from './processors/alert-evaluation.js';
import { processBondingCurveMigrationTransition } from './processors/bonding-curve-migration-transition.js';
import { processContractCreation } from './processors/contract-creation.js';
import { processLiquidityMetric } from './processors/liquidity-metric.js';
import { processMarketMetric } from './processors/market-metric.js';
import { processPoolRefresh } from './processors/pool-refresh.js';
import { processPriceObservation } from './processors/price-observation.js';
import { processProtocolEnrichment } from './processors/protocol-enrichment.js';
import { processRiskAnalysis } from './processors/risk-analysis.js';
import { processSourceReconciliation } from './processors/source-reconciliation.js';
import { processTokenApproval } from './processors/token-approval.js';
import { processTokenMetadata } from './processors/token-metadata.js';
import { processTokenTransfer } from './processors/token-transfer.js';
import type { Processor, ProcessorContext } from './processors/types.js';
import { processWalletActivity } from './processors/wallet-activity.js';

const PROCESSORS: Record<DerivedJobType, Processor> = {
  'contract-creation': processContractCreation,
  'token-transfer': processTokenTransfer,
  'token-approval': processTokenApproval,
  'risk-analysis': processRiskAnalysis,
  'pool-refresh': processPoolRefresh,
  'new-price-observation': processPriceObservation,
  'market-metric': processMarketMetric,
  'alert-evaluation': processAlertEvaluation,
  'token-metadata': processTokenMetadata,
  'source-reconciliation': processSourceReconciliation,
  'liquidity-metric': processLiquidityMetric,
  'protocol-enrichment': processProtocolEnrichment,
  'bonding-curve-migration-transition': processBondingCurveMigrationTransition,
  'wallet-activity': processWalletActivity,
};

/**
 * Routes a derived job to its processor.
 *
 * An unrecognised type is thrown rather than acknowledged: it means a producer is
 * emitting something this worker cannot handle, and dead-lettering keeps the job for
 * inspection instead of discarding chain-derived work. Throwing also covers a
 * processor's own failure, which BullMQ retries before dead-lettering.
 */
export function createDerivedJobRouter(
  logger: Logger,
  database: Database,
  services: Pick<
    ProcessorContext,
    | 'poolRefresh'
    | 'riskAnalysis'
    | 'alertDelivery'
    | 'riskAlerts'
    | 'chainReader'
    | 'protocolEnrichment'
    | 'oracleClient'
  >,
): DerivedJobHandler {
  const context: ProcessorContext = {
    database,
    logger,
    poolRefresh: services.poolRefresh,
    riskAnalysis: services.riskAnalysis,
    alertDelivery: services.alertDelivery,
    riskAlerts: services.riskAlerts,
    chainReader: services.chainReader,
    protocolEnrichment: services.protocolEnrichment,
    oracleClient: services.oracleClient,
  };

  return async (payload: DerivedJobPayload): Promise<void> => {
    if (!isDerivedJobType(payload.type)) {
      throw new Error(`Unrecognised derived job type: ${payload.type}`);
    }

    await PROCESSORS[payload.type](payload, context);
    logger.debug('Processed derived job', {
      type: payload.type,
      chainId: payload.chainId,
      blockNumber: payload.blockNumber,
    });
  };
}
