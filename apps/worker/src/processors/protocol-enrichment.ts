import type { DerivedJobPayload } from '@hood-sentry/queue';
import { z } from 'zod';
import type { ProcessorContext } from './types.js';

const protocolEnrichmentDataSchema = z.object({
  protocolKey: z.string().trim().min(1).max(100),
  protocolVersion: z.string().trim().min(1).max(100),
});

export async function processProtocolEnrichment(
  payload: DerivedJobPayload,
  context: Pick<ProcessorContext, 'protocolEnrichment'>,
): Promise<void> {
  const data = protocolEnrichmentDataSchema.parse(payload.data);
  await context.protocolEnrichment.run({
    chainId: z.coerce.number().int().positive().safe().parse(payload.chainId),
    protocolKey: data.protocolKey,
    protocolVersion: data.protocolVersion,
  });
}
