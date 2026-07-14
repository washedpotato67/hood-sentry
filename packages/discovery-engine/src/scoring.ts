import {
  clampBps,
  logScaledBps,
  ratioBps,
  secondsBetween,
  signedGrowthScore,
} from './arithmetic.js';
import { analyzeManipulation } from './manipulation.js';
import {
  type DiscoveryCandidate,
  TRENDING_METHODOLOGY_VERSION,
  type TrendingComponent,
  type TrendingComponentKey,
  type TrendingScore,
} from './types.js';

const DAY_SECONDS = 86_400n;
const POSITIVE_WEIGHTS: Readonly<Record<TrendingComponentKey, bigint>> = {
  logScaledVolume: 1_400n,
  uniqueTraders: 900n,
  transactionAcceleration: 900n,
  holderGrowth: 700n,
  liquidity: 1_200n,
  liquidityGrowth: 700n,
  poolAge: 400n,
  tokenAge: 400n,
  watchlistGrowth: 500n,
  alertCreationGrowth: 300n,
  launchpadCurveProgress: 500n,
  graduationStatus: 400n,
  riskCompleteness: 700n,
  washTradingPenalty: 1_000n,
  holderConcentrationPenalty: 600n,
  lowLiquidityPenalty: 800n,
  suspiciousDeployerPenalty: 800n,
  duplicateSymbolPenalty: 400n,
  dataQualityPenalty: 800n,
};

function component(
  key: TrendingComponentKey,
  kind: 'positive' | 'penalty',
  rawValue: bigint | null,
  normalizedBps: bigint,
  available: boolean,
  reasons: readonly string[] = [],
): TrendingComponent {
  const weightBps = POSITIVE_WEIGHTS[key];
  return {
    key,
    kind,
    rawValue,
    normalizedBps: clampBps(normalizedBps),
    weightBps,
    contributionBps: (clampBps(normalizedBps) * weightBps) / 10_000n,
    available,
    reasons,
  };
}

function ageScore(createdAt: string | null, observedAt: string): bigint {
  const age = secondsBetween(createdAt, observedAt);
  if (age === null) return 0n;
  if (age <= DAY_SECONDS) return 10_000n;
  if (age >= 30n * DAY_SECONDS) return 1_000n;
  return 10_000n - ((age - DAY_SECONDS) * 9_000n) / (29n * DAY_SECONDS);
}

function lowLiquidityPenalty(candidate: DiscoveryCandidate): bigint {
  if (candidate.liquidityRaw === null) return 10_000n;
  const minimum = candidate.manipulationContext.minimumHealthyLiquidityRaw;
  if (candidate.liquidityRaw >= minimum) return 0n;
  return 10_000n - ratioBps(candidate.liquidityRaw, minimum);
}

function holderConcentrationPenalty(candidate: DiscoveryCandidate): bigint {
  if (candidate.holderConcentrationBps === null || candidate.holderConcentrationBps <= 5_000n) {
    return 0n;
  }
  return clampBps((candidate.holderConcentrationBps - 5_000n) * 2n);
}

function graduated(candidate: DiscoveryCandidate): boolean {
  return candidate.launchpadState === 'graduated' || candidate.launchpadState === 'migrated';
}

export function calculateTrendingScore(candidate: DiscoveryCandidate): TrendingScore {
  const manipulation = analyzeManipulation(candidate.recentTrades, candidate.manipulationContext);
  const liquidityPenalty = lowLiquidityPenalty(candidate);
  const holderPenalty = holderConcentrationPenalty(candidate);
  const duplicatePenalty = clampBps(BigInt(candidate.duplicateSymbolAddresses.length) * 2_500n);
  const dataPenalty = clampBps(BigInt(candidate.dataQualityWarnings.length) * 2_000n);
  const components: TrendingComponent[] = [
    component(
      'logScaledVolume',
      'positive',
      candidate.volumeRaw,
      logScaledBps(candidate.volumeRaw, candidate.volumeDecimals),
      candidate.volumeRaw !== null,
    ),
    component(
      'uniqueTraders',
      'positive',
      candidate.uniqueTraders,
      ratioBps(candidate.uniqueTraders ?? 0n, 500n),
      candidate.uniqueTraders !== null,
    ),
    component(
      'transactionAcceleration',
      'positive',
      candidate.transactionGrowthBps,
      signedGrowthScore(candidate.transactionGrowthBps, 20_000n),
      candidate.transactionGrowthBps !== null,
    ),
    component(
      'holderGrowth',
      'positive',
      candidate.holderGrowth,
      ratioBps(candidate.holderGrowth ?? 0n, 1_000n),
      candidate.holderGrowth !== null,
    ),
    component(
      'liquidity',
      'positive',
      candidate.liquidityRaw,
      logScaledBps(candidate.liquidityRaw, candidate.liquidityDecimals),
      candidate.liquidityRaw !== null,
    ),
    component(
      'liquidityGrowth',
      'positive',
      candidate.liquidityChangeBps,
      signedGrowthScore(candidate.liquidityChangeBps, 10_000n),
      candidate.liquidityChangeBps !== null,
    ),
    component(
      'poolAge',
      'positive',
      secondsBetween(candidate.poolCreatedAt, candidate.observedAt),
      ageScore(candidate.poolCreatedAt, candidate.observedAt),
      candidate.poolCreatedAt !== null,
    ),
    component(
      'tokenAge',
      'positive',
      secondsBetween(candidate.firstSeenAt, candidate.observedAt),
      ageScore(candidate.firstSeenAt, candidate.observedAt),
      candidate.firstSeenAt !== null,
    ),
    component(
      'watchlistGrowth',
      'positive',
      candidate.watchlistGrowth,
      ratioBps(candidate.watchlistGrowth ?? 0n, 100n),
      candidate.watchlistGrowth !== null,
    ),
    component(
      'alertCreationGrowth',
      'positive',
      candidate.alertCreationGrowth,
      ratioBps(candidate.alertCreationGrowth ?? 0n, 50n),
      candidate.alertCreationGrowth !== null,
    ),
    component(
      'launchpadCurveProgress',
      'positive',
      candidate.launchpadCurveProgressBps,
      candidate.launchpadCurveProgressBps ?? 0n,
      candidate.launchpadCurveProgressBps !== null,
    ),
    component(
      'graduationStatus',
      'positive',
      graduated(candidate) ? 1n : 0n,
      graduated(candidate) ? 10_000n : 0n,
      candidate.launchpadState !== 'none',
    ),
    component(
      'riskCompleteness',
      'positive',
      candidate.riskCompletenessBps,
      candidate.riskCompletenessBps ?? 0n,
      candidate.riskCompletenessBps !== null,
    ),
    component(
      'washTradingPenalty',
      'penalty',
      manipulation.totalPenaltyBps,
      manipulation.totalPenaltyBps,
      true,
      manipulation.signals.filter((item) => item.status === 'observed').map((item) => item.code),
    ),
    component(
      'holderConcentrationPenalty',
      'penalty',
      candidate.holderConcentrationBps,
      holderPenalty,
      candidate.holderConcentrationBps !== null,
    ),
    component(
      'lowLiquidityPenalty',
      'penalty',
      candidate.liquidityRaw,
      liquidityPenalty,
      candidate.liquidityRaw !== null,
      candidate.liquidityRaw === null ? ['LIQUIDITY_UNAVAILABLE'] : [],
    ),
    component(
      'suspiciousDeployerPenalty',
      'penalty',
      BigInt(candidate.suspiciousDeployerEvidence.length),
      candidate.suspiciousDeployerEvidence.length > 0 ? 10_000n : 0n,
      true,
      candidate.suspiciousDeployerEvidence,
    ),
    component(
      'duplicateSymbolPenalty',
      'penalty',
      BigInt(candidate.duplicateSymbolAddresses.length),
      duplicatePenalty,
      true,
    ),
    component(
      'dataQualityPenalty',
      'penalty',
      BigInt(candidate.dataQualityWarnings.length),
      dataPenalty,
      true,
      candidate.dataQualityWarnings,
    ),
  ];
  const positive = components
    .filter((item) => item.kind === 'positive')
    .reduce((sum, item) => sum + item.contributionBps, 0n);
  const penalties = components
    .filter((item) => item.kind === 'penalty')
    .reduce((sum, item) => sum + item.contributionBps, 0n);
  const availableWeight = components
    .filter((item) => item.kind === 'positive' && item.available)
    .reduce((sum, item) => sum + item.weightBps, 0n);
  const totalPositiveWeight = components
    .filter((item) => item.kind === 'positive')
    .reduce((sum, item) => sum + item.weightBps, 0n);
  return {
    methodologyVersion: TRENDING_METHODOLOGY_VERSION,
    scoreBps: clampBps(positive - penalties),
    confidenceBps:
      totalPositiveWeight === 0n
        ? 0n
        : (availableWeight * manipulation.confidenceBps) / totalPositiveWeight,
    components,
    manipulation,
  };
}

export function materializeDiscoveryItem(candidate: DiscoveryCandidate) {
  const sourceMs = Date.parse(candidate.sourceTimestamp);
  const observedMs = Date.parse(candidate.observedAt);
  if (!Number.isFinite(sourceMs) || !Number.isFinite(observedMs))
    throw new Error('Discovery timestamps are invalid');
  const dataFreshnessSeconds = BigInt(Math.max(0, Math.floor((observedMs - sourceMs) / 1_000)));
  const warnings = [
    ...candidate.dataQualityWarnings,
    ...(candidate.duplicateSymbolAddresses.length > 0 ? ['DUPLICATE_SYMBOL'] : []),
    ...(candidate.priceStatus === 'unavailable' ? ['PRICE_UNAVAILABLE'] : []),
    ...(candidate.holderCount === null ? ['HOLDER_DATA_UNAVAILABLE'] : []),
  ];
  const {
    recentTrades: _recentTrades,
    manipulationContext: _manipulationContext,
    ...publicCandidate
  } = candidate;
  const relatedWalletAddresses = [
    ...new Map(
      candidate.recentTrades.map((trade) => [
        trade.traderAddress.toLowerCase(),
        trade.traderAddress,
      ]),
    ).values(),
  ].sort((left, right) => left.localeCompare(right));
  return {
    ...publicCandidate,
    relatedWalletAddresses,
    trending: calculateTrendingScore(candidate),
    dataFreshnessSeconds,
    warnings,
  };
}
