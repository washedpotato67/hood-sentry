import type { ProtocolReadClient } from '@hood-sentry/chain';
import type { Database } from '@hood-sentry/db';
import type { Logger } from '@hood-sentry/observability';
import type { DerivedJobPayload } from '@hood-sentry/queue';
import type { PoolRefreshJob } from '../jobs/pool-refresh.js';
import type { ProtocolEnrichmentJob } from '../jobs/protocol-enrichment.js';
import type { RiskAnalysisRunner } from '../jobs/risk-runtime.js';
import type { AlertDeliveryService } from '../notifications/alert-delivery.js';
import type { RiskAlertEvaluator } from '../notifications/risk-alerts.js';

export interface ProcessorContext {
  database: Database;
  logger: Logger;
  riskAnalysis: RiskAnalysisRunner;
  poolRefresh: Pick<PoolRefreshJob, 'run'>;
  chainReader: Pick<ProtocolReadClient, 'getBytecode' | 'readContract'>;
  protocolEnrichment: Pick<ProtocolEnrichmentJob, 'run'>;
  alertDelivery?: Pick<AlertDeliveryService, 'deliver'>;
  riskAlerts: RiskAlertEvaluator;
}

/**
 * Handles one derived job type. Processors must be idempotent: delivery is
 * at-least-once, so the same job can arrive again after a retry or a restart.
 * Throwing hands the job back to BullMQ for retry and eventual dead-lettering.
 */
export type Processor = (payload: DerivedJobPayload, context: ProcessorContext) => Promise<void>;
