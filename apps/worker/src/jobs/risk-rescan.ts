import type { RiskRepository } from '@hood-sentry/db';
import {
  type RiskRescanRequest,
  normalizeRescanRequest,
  riskRescanRequestSchema,
} from '@hood-sentry/risk-engine';
import { z } from 'zod';

const riskReorgInputSchema = z.object({
  chainId: z.number().int().positive(),
  fromBlock: z.bigint().nonnegative(),
});

type RiskRescanRepository = Pick<RiskRepository, 'insertRescanRequest'>;
type RiskReorgRepository = Pick<RiskRepository, 'invalidateScansFromBlock'>;

export class RiskRescanTriggerJob {
  constructor(private readonly repository: RiskRescanRepository) {}

  async run(rawRequest: RiskRescanRequest) {
    const request = normalizeRescanRequest(riskRescanRequestSchema.parse(rawRequest));
    const stored = await this.repository.insertRescanRequest({
      chainId: request.target.chainId,
      targetType: request.target.type,
      targetAddress: request.target.address.toLowerCase(),
      triggerType: request.trigger,
      sourceBlock: request.sourceBlock,
      sourceBlockHash: request.sourceBlockHash,
      rulesetVersion: request.rulesetVersion,
      methodologyVersion: request.methodologyVersion,
      eventId: request.eventId,
      requestedBy: request.requestedBy,
      idempotencyKey: request.idempotencyKey,
      status: 'queued',
      scanRunId: null,
      canonical: true,
    });
    return { requestId: stored.id, idempotencyKey: request.idempotencyKey };
  }
}

export class RiskReorgJob {
  constructor(private readonly repository: RiskReorgRepository) {}

  async run(input: { chainId: number; fromBlock: bigint }) {
    const parsed = riskReorgInputSchema.parse(input);
    const invalidatedScans = await this.repository.invalidateScansFromBlock(
      parsed.chainId,
      parsed.fromBlock,
    );
    return {
      invalidatedScans,
      idempotencyKey: `risk-reorg:${parsed.chainId}:${parsed.fromBlock.toString()}`,
    };
  }
}
