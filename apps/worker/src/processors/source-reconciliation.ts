import type { DerivedJobPayload } from '@hood-sentry/queue';
import { processPriceObservation } from './price-observation.js';
import type { ProcessorContext } from './types.js';

export async function processSourceReconciliation(
  payload: DerivedJobPayload,
  context: ProcessorContext,
): Promise<void> {
  await processPriceObservation(payload, context);
}
