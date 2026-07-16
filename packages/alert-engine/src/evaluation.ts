import { z } from 'zod';

const unsignedIntegerSchema = z.string().regex(/^[0-9]+$/);
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const severitySchema = z.enum(['low', 'medium', 'high', 'critical']);

const conditionSchema = z
  .object({
    eventTypes: z.array(z.string().min(1).max(100)).max(50).optional(),
    minimumAmountRaw: unsignedIntegerSchema.optional(),
    fromAddresses: z.array(addressSchema).max(100).optional(),
    toAddresses: z.array(addressSchema).max(100).optional(),
    severity: severitySchema.optional(),
  })
  .passthrough();

export type ChainAlertRuleInput = {
  ruleType: string;
  targetAddress: string;
  condition: unknown;
};

export type ChainAlertEventInput = {
  eventType: string;
  targetAddresses: readonly string[];
  tokenAddress?: string;
  fromAddress?: string;
  toAddress?: string;
  valueRaw?: string;
};

export type AlertDecision = {
  matched: true;
  severity: z.infer<typeof severitySchema>;
  evidence: {
    eventType: string;
    thresholdRaw: string | null;
    observedRaw: string | null;
  };
};

const priceChangeConditionSchema = z.object({
  changeBps: unsignedIntegerSchema,
  windowSeconds: unsignedIntegerSchema,
  direction: z.enum(['up', 'down', 'either']).default('either'),
  severity: severitySchema.optional(),
});

const volumeSpikeConditionSchema = z.object({
  minimumVolumeRaw: unsignedIntegerSchema,
  multiplierBps: unsignedIntegerSchema,
  windowSeconds: unsignedIntegerSchema,
  severity: severitySchema.optional(),
});

const riskScoreChangeConditionSchema = z.object({
  minimumDeltaBps: unsignedIntegerSchema,
  direction: z.enum(['increase', 'decrease', 'either']).default('increase'),
  severity: severitySchema.optional(),
});

export type MarketAlertRuleInput = {
  ruleType: string;
  targetAddress: string;
  condition: unknown;
};

export type MarketAlertInput = {
  tokenAddress: string;
  windowSeconds: number;
  priceChangeBps: bigint | null;
  volumeRaw: bigint;
  previousVolumeRaw: bigint | null;
};

export type MarketAlertDecision = {
  matched: true;
  severity: z.infer<typeof severitySchema>;
  evidence: {
    metric: 'price_change_bps' | 'volume_multiplier_bps';
    windowSeconds: string;
    thresholdRaw: string;
    observedRaw: string;
    currentVolumeRaw: string | null;
    previousVolumeRaw: string | null;
  };
};

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function evaluateMarketAlertRule(
  rule: MarketAlertRuleInput,
  input: MarketAlertInput,
): MarketAlertDecision | null {
  if (rule.targetAddress.toLowerCase() !== input.tokenAddress.toLowerCase()) return null;
  if (rule.ruleType === 'price_change') {
    const condition = priceChangeConditionSchema.parse(rule.condition);
    if (BigInt(condition.windowSeconds) !== BigInt(input.windowSeconds)) return null;
    if (input.priceChangeBps === null) return null;
    const threshold = BigInt(condition.changeBps);
    const directionMatched =
      condition.direction === 'up'
        ? input.priceChangeBps >= threshold
        : condition.direction === 'down'
          ? input.priceChangeBps <= -threshold
          : absolute(input.priceChangeBps) >= threshold;
    if (!directionMatched) return null;
    return {
      matched: true,
      severity: condition.severity ?? 'medium',
      evidence: {
        metric: 'price_change_bps',
        windowSeconds: condition.windowSeconds,
        thresholdRaw: threshold.toString(),
        observedRaw: input.priceChangeBps.toString(),
        currentVolumeRaw: null,
        previousVolumeRaw: null,
      },
    };
  }
  if (rule.ruleType !== 'volume_spike') return null;
  const condition = volumeSpikeConditionSchema.parse(rule.condition);
  if (BigInt(condition.windowSeconds) !== BigInt(input.windowSeconds)) return null;
  if (input.previousVolumeRaw === null || input.previousVolumeRaw <= 0n) return null;
  const minimumVolume = BigInt(condition.minimumVolumeRaw);
  const multiplier = BigInt(condition.multiplierBps);
  if (input.volumeRaw < minimumVolume) return null;
  if (input.volumeRaw * 10_000n < input.previousVolumeRaw * multiplier) return null;
  const observedMultiplier = (input.volumeRaw * 10_000n) / input.previousVolumeRaw;
  return {
    matched: true,
    severity: condition.severity ?? 'high',
    evidence: {
      metric: 'volume_multiplier_bps',
      windowSeconds: condition.windowSeconds,
      thresholdRaw: multiplier.toString(),
      observedRaw: observedMultiplier.toString(),
      currentVolumeRaw: input.volumeRaw.toString(),
      previousVolumeRaw: input.previousVolumeRaw.toString(),
    },
  };
}

export type RiskScoreAlertDecision = {
  matched: true;
  severity: z.infer<typeof severitySchema>;
  evidence: {
    metric: 'risk_score_change_bps';
    thresholdRaw: string;
    observedRaw: string;
    previousScoreBps: string;
    currentScoreBps: string;
    methodologyVersion: string;
  };
};

export function evaluateRiskScoreAlertRule(
  rule: MarketAlertRuleInput,
  input: {
    targetAddress: string;
    previousScoreBps: bigint | null;
    currentScoreBps: bigint;
    methodologyVersion: string;
  },
): RiskScoreAlertDecision | null {
  if (rule.ruleType !== 'risk_score_change') return null;
  if (rule.targetAddress.toLowerCase() !== input.targetAddress.toLowerCase()) return null;
  if (input.previousScoreBps === null) return null;
  const condition = riskScoreChangeConditionSchema.parse(rule.condition);
  const delta = input.currentScoreBps - input.previousScoreBps;
  const threshold = BigInt(condition.minimumDeltaBps);
  const directionMatched =
    condition.direction === 'increase'
      ? delta >= threshold
      : condition.direction === 'decrease'
        ? delta <= -threshold
        : absolute(delta) >= threshold;
  if (!directionMatched) return null;
  return {
    matched: true,
    severity: condition.severity ?? 'high',
    evidence: {
      metric: 'risk_score_change_bps',
      thresholdRaw: threshold.toString(),
      observedRaw: delta.toString(),
      previousScoreBps: input.previousScoreBps.toString(),
      currentScoreBps: input.currentScoreBps.toString(),
      methodologyVersion: input.methodologyVersion,
    },
  };
}

function normalized(values: readonly string[] | undefined): readonly string[] {
  return (values ?? []).map((value) => value.toLowerCase());
}

function addressAllowed(address: string | undefined, allowlist: readonly string[] | undefined) {
  if (allowlist === undefined) return true;
  if (address === undefined) return false;
  return normalized(allowlist).includes(address.toLowerCase());
}

export function evaluateChainAlertRule(
  rule: ChainAlertRuleInput,
  event: ChainAlertEventInput,
): AlertDecision | null {
  if (
    !event.targetAddresses
      .map((value) => value.toLowerCase())
      .includes(rule.targetAddress.toLowerCase())
  ) {
    return null;
  }
  const condition = conditionSchema.parse(rule.condition);

  if (rule.ruleType === 'contract_event' || rule.ruleType === 'governance_proposal') {
    if (condition.eventTypes === undefined || !condition.eventTypes.includes(event.eventType)) {
      return null;
    }
    return {
      matched: true,
      severity: condition.severity ?? (rule.ruleType === 'governance_proposal' ? 'medium' : 'high'),
      evidence: { eventType: event.eventType, thresholdRaw: null, observedRaw: null },
    };
  }

  if (rule.ruleType !== 'large_transfer' || event.eventType !== 'tokenTransfer') return null;
  if (condition.minimumAmountRaw === undefined || event.valueRaw === undefined) return null;
  if (!addressAllowed(event.fromAddress, condition.fromAddresses)) return null;
  if (!addressAllowed(event.toAddress, condition.toAddresses)) return null;

  const threshold = BigInt(condition.minimumAmountRaw);
  const observed = BigInt(unsignedIntegerSchema.parse(event.valueRaw));
  if (observed < threshold) return null;
  return {
    matched: true,
    severity: condition.severity ?? 'high',
    evidence: {
      eventType: event.eventType,
      thresholdRaw: threshold.toString(),
      observedRaw: observed.toString(),
    },
  };
}
