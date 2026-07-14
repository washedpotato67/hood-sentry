import { absoluteDifferenceBps, clampBps } from './arithmetic.js';
import type { PriceObservation, PriceSourceConfig, SourceSelectionResult } from './types.js';

const unavailableObservation = (
  config: PriceSourceConfig,
  observedAt: string,
): PriceObservation => ({
  observationKey: `unavailable:${config.chainId}:${config.sourceAssetAddress}:${observedAt}`,
  chainId: config.chainId,
  tokenAddress: config.sourceAssetAddress,
  quoteAssetAddress: config.quoteAssetAddress,
  sourceKey: 'unavailable',
  sourceType: 'unavailable',
  sourceContractAddress: null,
  priceRaw: null,
  priceDecimals: 0,
  sourceBlockNumber: null,
  sourceBlockHash: null,
  sourceTimestamp: observedAt,
  observedAt,
  liquidityDepthRaw: null,
  liquidityDepthDecimals: null,
  priceImpactBps: null,
  singleTransactionVolumeBps: null,
  providerName: null,
  poolAddress: null,
  route: [],
  canonical: true,
  confidenceBps: 0n,
  stale: false,
  status: 'unavailable',
  authoritative: false,
  methodologyVersion: config.methodologyVersion,
  reasons: ['NO_VALID_PRICE_SOURCE'],
});

function sourcePriority(
  configs: readonly PriceSourceConfig[],
  observation: PriceObservation,
): number {
  return configs.find((config) => config.sourceKey === observation.sourceKey)?.priority ?? 9999;
}

function sortObservations(
  configs: readonly PriceSourceConfig[],
  observations: readonly PriceObservation[],
): PriceObservation[] {
  return observations
    .filter((observation) => observation.canonical && observation.status !== 'unavailable')
    .sort((left, right) => {
      const priorityDifference = sourcePriority(configs, left) - sourcePriority(configs, right);
      if (priorityDifference !== 0) return priorityDifference;
      return left.confidenceBps > right.confidenceBps
        ? -1
        : left.confidenceBps < right.confidenceBps
          ? 1
          : 0;
    });
}

function alignedPrice(candidate: PriceObservation, decimals: number): bigint | null {
  if (candidate.priceRaw === null) return null;
  if (candidate.priceDecimals === decimals) return candidate.priceRaw;
  if (candidate.priceDecimals < decimals) {
    return candidate.priceRaw * 10n ** BigInt(decimals - candidate.priceDecimals);
  }
  return candidate.priceRaw / 10n ** BigInt(candidate.priceDecimals - decimals);
}

function disagreementWarnings(
  primary: PriceObservation,
  candidates: readonly PriceObservation[],
  config: PriceSourceConfig,
): string[] {
  if (primary.priceRaw === null) return [];
  const warnings: string[] = [];
  for (const candidate of candidates) {
    const price = alignedPrice(candidate, primary.priceDecimals);
    if (price === null) continue;
    const disagreement = absoluteDifferenceBps(primary.priceRaw, price);
    if (disagreement !== null && disagreement > config.confidenceRules.disagreementThresholdBps) {
      warnings.push(`SOURCE_DISAGREEMENT:${candidate.sourceKey}:${disagreement.toString()}`);
    }
  }
  return warnings;
}

export function selectPriceSource(
  configs: readonly PriceSourceConfig[],
  observations: readonly PriceObservation[],
  observedAt: string,
): SourceSelectionResult {
  const sorted = sortObservations(configs, observations);
  const primary = sorted[0];
  const fallbackConfig = configs[0];
  if (fallbackConfig === undefined) {
    throw new Error('Source selection needs at least one source configuration');
  }
  if (primary === undefined) {
    const selected = unavailableObservation(fallbackConfig, observedAt);
    return { selected, evaluated: [], disagreementWarnings: [] };
  }
  const primaryConfig = configs.find((config) => config.sourceKey === primary.sourceKey);
  if (primaryConfig === undefined)
    throw new Error(`Observation source is absent from registry: ${primary.sourceKey}`);
  const warnings = disagreementWarnings(primary, sorted.slice(1), primaryConfig);
  const penalty = BigInt(warnings.length) * primaryConfig.confidenceRules.disagreementPenaltyBps;
  const confidenceBps = clampBps(primary.confidenceBps - penalty);
  const selected: PriceObservation = {
    ...primary,
    confidenceBps,
    status:
      confidenceBps < primaryConfig.confidenceRules.minimumAuthoritativeConfidenceBps
        ? 'lowConfidence'
        : primary.status,
    authoritative:
      primary.authoritative &&
      confidenceBps >= primaryConfig.confidenceRules.minimumAuthoritativeConfidenceBps,
    reasons: [...primary.reasons, ...warnings],
  };
  return {
    selected:
      selected.priceRaw === null ? unavailableObservation(fallbackConfig, observedAt) : selected,
    evaluated: sorted,
    disagreementWarnings: warnings,
  };
}
