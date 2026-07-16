import type { DerivedJobPayload } from '@hood-sentry/queue';
import { processMarketMetric } from './market-metric.js';
import type { ProcessorContext } from './types.js';

export async function processLiquidityMetric(
  payload: DerivedJobPayload,
  context: ProcessorContext,
): Promise<void> {
  await processMarketMetric(payload, context);
}
