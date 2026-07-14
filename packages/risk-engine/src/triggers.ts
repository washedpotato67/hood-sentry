import { createRescanRequestIdempotencyKey, createRiskJobIdempotencyKey } from './fingerprint.js';
import {
  type RiskRescanRequest,
  type RiskRuleset,
  type RiskScanContext,
  riskRescanRequestSchema,
} from './types.js';

export function normalizeRescanRequest(input: RiskRescanRequest): RiskRescanRequest & {
  idempotencyKey: string;
} {
  const request = riskRescanRequestSchema.parse(input);
  return {
    ...request,
    idempotencyKey: createRescanRequestIdempotencyKey({
      target: request.target,
      trigger: request.trigger,
      sourceBlock: request.sourceBlock,
      sourceBlockHash: request.sourceBlockHash,
      eventId: request.eventId,
      rulesetVersion: request.rulesetVersion,
    }),
  };
}

export function riskScanIdempotencyKey(
  context: RiskScanContext,
  ruleset: RiskRuleset,
  engineVersion: string,
): string {
  return createRiskJobIdempotencyKey({
    target: context.target,
    engineVersion,
    sourceBlock: context.sourceBlock,
    sourceBlockHash: context.sourceBlockHash,
    rulesetVersion: ruleset.version,
    methodologyVersion: ruleset.methodologyVersion,
  });
}
