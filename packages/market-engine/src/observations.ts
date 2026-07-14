import { getAddress } from 'viem';
import { absoluteDifferenceBps, clampBps, mulDivFloor, pow10 } from './arithmetic.js';
import type {
  BondingCurvePriceInput,
  ChainlinkPriceInput,
  ExternalPriceInput,
  PoolPriceInput,
  PriceEvidence,
  PriceObservation,
  PriceSourceConfig,
} from './types.js';

function timestampSeconds(value: string): bigint {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error('Invalid price timestamp');
  return BigInt(Math.floor(milliseconds / 1000));
}

function stale(config: PriceSourceConfig, evidence: PriceEvidence): boolean {
  return (
    timestampSeconds(evidence.observedAt) - timestampSeconds(evidence.sourceTimestamp) >
    BigInt(config.maximumStalenessSeconds)
  );
}

export function poolPriceRaw(input: PoolPriceInput, outputDecimals: number): bigint {
  if (input.reserveTokenRaw <= 0n || input.reserveQuoteRaw <= 0n) {
    throw new Error('Pool reserves must be positive');
  }
  const numerator = input.reserveQuoteRaw * pow10(input.tokenDecimals) * pow10(outputDecimals);
  const denominator = input.reserveTokenRaw * pow10(input.quoteDecimals);
  return numerator / denominator;
}

export function chainlinkEvidence(
  input: ChainlinkPriceInput,
  evidence: Omit<PriceEvidence, 'priceRaw' | 'priceDecimals' | 'reasons'>,
): PriceEvidence {
  const reasons: string[] = [];
  if (input.answer <= 0n) reasons.push(input.answer === 0n ? 'ZERO_PRICE' : 'NEGATIVE_PRICE');
  if (input.updatedAt === '1970-01-01T00:00:00.000Z') reasons.push('MISSING_SOURCE_TIMESTAMP');
  if (input.answeredInRound < input.roundId) reasons.push('INCOMPLETE_ORACLE_ROUND');
  if (!input.sequencerUp) reasons.push('SEQUENCER_DOWN');
  if (!input.sequencerGracePeriodElapsed) reasons.push('SEQUENCER_GRACE_PERIOD');
  if (input.oraclePaused) reasons.push('ORACLE_PAUSED');
  return {
    ...evidence,
    priceRaw: reasons.length === 0 ? input.answer : null,
    priceDecimals: input.decimals,
    sourceTimestamp: input.updatedAt,
    reasons,
  };
}

export function poolEvidence(
  input: PoolPriceInput,
  outputDecimals: number,
  evidence: Omit<PriceEvidence, 'priceRaw' | 'priceDecimals' | 'reasons'>,
): PriceEvidence {
  const reasons: string[] = [];
  if (!input.protocolVerified) reasons.push('UNVERIFIED_PROTOCOL');
  if (!input.tokenAddressesVerified) reasons.push('POOL_TOKEN_MISMATCH');
  if (!input.poolStateFresh) reasons.push('STALE_POOL_STATE');
  let priceRaw: bigint | null = null;
  try {
    priceRaw = poolPriceRaw(input, outputDecimals);
    if (priceRaw <= 0n) reasons.push('ZERO_PRICE');
  } catch {
    reasons.push('INVALID_POOL_RESERVES');
  }
  return {
    ...evidence,
    priceRaw: reasons.some(
      (reason) =>
        reason === 'UNVERIFIED_PROTOCOL' ||
        reason === 'POOL_TOKEN_MISMATCH' ||
        reason === 'INVALID_POOL_RESERVES',
    )
      ? null
      : priceRaw,
    priceDecimals: outputDecimals,
    priceImpactBps: input.priceImpactBps,
    singleTransactionVolumeBps: input.singleTransactionVolumeBps,
    reasons,
  };
}

export function bondingCurveEvidence(
  input: BondingCurvePriceInput,
  evidence: Omit<PriceEvidence, 'priceRaw' | 'priceDecimals' | 'reasons'>,
): PriceEvidence {
  const reasons: string[] = [];
  if (!input.contractVerified) reasons.push('UNVERIFIED_LAUNCHPAD');
  if (!input.supplyStateVerified) reasons.push('UNVERIFIED_SUPPLY_STATE');
  if (input.migrated) reasons.push('CURVE_DISABLED_AFTER_MIGRATION');
  else if (input.graduated) reasons.push('GRADUATED_AWAITING_MIGRATION');
  if (input.numeratorRaw <= 0n || input.denominatorRaw <= 0n) reasons.push('INVALID_CURVE_PRICE');
  const invalid = reasons.some((reason) =>
    [
      'UNVERIFIED_LAUNCHPAD',
      'UNVERIFIED_SUPPLY_STATE',
      'CURVE_DISABLED_AFTER_MIGRATION',
      'INVALID_CURVE_PRICE',
    ].includes(reason),
  );
  return {
    ...evidence,
    priceRaw: invalid
      ? null
      : mulDivFloor(input.numeratorRaw, pow10(input.priceDecimals), input.denominatorRaw),
    priceDecimals: input.priceDecimals,
    reasons: [
      ...reasons,
      `CURVE_FORMULA:${input.formulaKey}`,
      `CURVE_PARAMETERS:${input.formulaParametersHash}`,
    ],
  };
}

export function externalEvidence(
  input: ExternalPriceInput,
  evidence: Omit<
    PriceEvidence,
    'priceRaw' | 'priceDecimals' | 'sourceTimestamp' | 'providerName' | 'reasons'
  >,
): PriceEvidence {
  const reasons: string[] = [];
  if (input.priceRaw <= 0n) reasons.push(input.priceRaw === 0n ? 'ZERO_PRICE' : 'NEGATIVE_PRICE');
  if (input.priceDecimals < 0 || input.priceDecimals > 255) reasons.push('IMPLAUSIBLE_DECIMALS');
  return {
    ...evidence,
    priceRaw: reasons.length === 0 ? input.priceRaw : null,
    priceDecimals: input.priceDecimals,
    sourceTimestamp: input.providerTimestamp,
    providerName: input.providerName,
    reasons,
  };
}

function observationReasons(
  config: PriceSourceConfig,
  evidence: PriceEvidence,
  previousPriceRaw: bigint | null,
  isStale: boolean,
): string[] {
  const reasons = [...evidence.reasons];
  if (!config.enabled) reasons.push('SOURCE_DISABLED');
  if (isStale) reasons.push('STALE_OBSERVATION');
  if (
    evidence.liquidityDepthRaw !== null &&
    evidence.liquidityDepthRaw < config.minimumLiquidityRaw
  ) {
    reasons.push('THIN_LIQUIDITY');
  }
  if (
    evidence.priceImpactBps !== null &&
    evidence.priceImpactBps > config.confidenceRules.maximumPriceImpactBps
  ) {
    reasons.push('EXTREME_PRICE_IMPACT');
  }
  if (
    evidence.singleTransactionVolumeBps !== null &&
    evidence.singleTransactionVolumeBps > config.confidenceRules.maximumSingleTransactionVolumeBps
  ) {
    reasons.push('ONE_TRANSACTION_MANIPULATION');
  }
  addPriceJumpReason(config, evidence.priceRaw, previousPriceRaw, reasons);
  addStablecoinReason(config, evidence, reasons);
  return reasons;
}

function addPriceJumpReason(
  config: PriceSourceConfig,
  priceRaw: bigint | null,
  previousPriceRaw: bigint | null,
  reasons: string[],
): void {
  if (previousPriceRaw === null || priceRaw === null) return;
  const jump = absoluteDifferenceBps(previousPriceRaw, priceRaw);
  if (jump !== null && jump > config.confidenceRules.maximumPriceJumpBps) {
    reasons.push('ABNORMAL_PRICE_JUMP');
  }
}

function addStablecoinReason(
  config: PriceSourceConfig,
  evidence: PriceEvidence,
  reasons: string[],
): void {
  if (config.assetClass !== 'stablecoin' || evidence.priceRaw === null) return;
  const depeg = absoluteDifferenceBps(pow10(evidence.priceDecimals), evidence.priceRaw);
  if (depeg !== null && depeg > config.confidenceRules.stablecoinDepegThresholdBps) {
    reasons.push('STABLECOIN_DEPEG');
  }
}

const fatalReasons = new Set([
  'UNVERIFIED_PROTOCOL',
  'POOL_TOKEN_MISMATCH',
  'UNVERIFIED_LAUNCHPAD',
  'CURVE_DISABLED_AFTER_MIGRATION',
  'NEGATIVE_PRICE',
  'ZERO_PRICE',
]);

function isFatalObservation(
  config: PriceSourceConfig,
  evidence: PriceEvidence,
  reasons: readonly string[],
): boolean {
  return (
    !config.enabled ||
    evidence.priceRaw === null ||
    reasons.some((reason) => fatalReasons.has(reason))
  );
}

function observationConfidence(
  config: PriceSourceConfig,
  reasons: readonly string[],
  isStale: boolean,
  fatal: boolean,
): bigint {
  if (fatal) return 0n;
  let confidence = config.confidenceRules.baseConfidenceBps;
  if (isStale) confidence -= config.confidenceRules.stalePenaltyBps;
  if (reasons.includes('THIN_LIQUIDITY')) {
    confidence -= config.confidenceRules.thinLiquidityPenaltyBps;
  }
  return clampBps(confidence);
}

export function evaluateObservation(
  config: PriceSourceConfig,
  evidence: PriceEvidence,
  previousPriceRaw: bigint | null = null,
): PriceObservation {
  const isStale = stale(config, evidence);
  const reasons = observationReasons(config, evidence, previousPriceRaw, isStale);
  const fatal = isFatalObservation(config, evidence, reasons);
  const confidence = observationConfidence(config, reasons, isStale, fatal);
  const lowConfidence =
    reasons.length > 0 || confidence < config.confidenceRules.minimumAuthoritativeConfidenceBps;
  const status = fatal ? 'unavailable' : lowConfidence ? 'lowConfidence' : 'available';
  return {
    ...evidence,
    observationKey: `${config.sourceKey}:${evidence.sourceBlockHash ?? evidence.sourceTimestamp}`,
    chainId: config.chainId,
    tokenAddress: getAddress(config.sourceAssetAddress),
    quoteAssetAddress: getAddress(config.quoteAssetAddress),
    sourceKey: config.sourceKey,
    sourceType: config.sourceType,
    sourceContractAddress: config.sourceContractAddress,
    confidenceBps: confidence,
    stale: isStale,
    status,
    authoritative:
      status === 'available' &&
      confidence >= config.confidenceRules.minimumAuthoritativeConfidenceBps,
    methodologyVersion: config.methodologyVersion,
    reasons,
  };
}
