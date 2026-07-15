import type { Database } from '@hood-sentry/db';
import type { Logger } from '@hood-sentry/observability';
import type { DerivedJobPayload } from '@hood-sentry/queue';

export interface ProcessorContext {
  database: Database;
  logger: Logger;
}

/**
 * Handles one derived job type. Processors must be idempotent: delivery is
 * at-least-once, so the same job can arrive again after a retry or a restart.
 * Throwing hands the job back to BullMQ for retry and eventual dead-lettering.
 */
export type Processor = (payload: DerivedJobPayload, context: ProcessorContext) => Promise<void>;
