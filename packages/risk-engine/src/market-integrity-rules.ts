import {
  MARKET_INTEGRITY_SIGNAL_CODES,
  MARKET_PRICE_RELIABILITY_SOURCE,
  MARKET_TRADE_MANIPULATION_SOURCE,
  type MarketIntegrityResult,
  type MarketIntegritySignalCode,
  deserializeMarketIntegrityResult,
} from './market-integrity-types.js';
import type {
  RiskFindingStatus,
  RiskRule,
  RiskRuleEvaluation,
  RiskScanContext,
  RiskSeverity,
} from './types.js';

interface Spec {
  readonly ruleId: string;
  readonly title: string;
  readonly description: string;
  readonly severity: RiskSeverity;
  readonly firedStatus: Extract<RiskFindingStatus, 'fail' | 'warning'>;
  readonly whenPresent: string;
  readonly whenAbsent: string;
  readonly remediation: string;
  readonly source: typeof MARKET_PRICE_RELIABILITY_SOURCE | typeof MARKET_TRADE_MANIPULATION_SOURCE;
  readonly evaluate: (r: MarketIntegrityResult) => RiskFindingStatus;
}

function priceStatus(
  r: MarketIntegrityResult,
  fired: boolean,
  requiresTwoSources: boolean,
  firedStatus: 'fail' | 'warning',
): RiskFindingStatus {
  if (!r.priceReliability.available) return 'unknown';
  if (requiresTwoSources && r.priceReliability.activeSourceCount < 2) return 'not_applicable';
  return fired ? firedStatus : 'pass';
}

function tradeStatus(
  r: MarketIntegrityResult,
  code: MarketIntegritySignalCode,
  firedStatus: 'fail' | 'warning',
): RiskFindingStatus {
  if (!r.tradeManipulation.available) return 'unknown';
  if (r.tradeManipulation.tradeCount < r.tradeManipulation.minTradesForAssessment) {
    return 'not_applicable';
  }
  // The analyzer ran, but this specific signal lacked the inputs to reach a
  // verdict (e.g. thin-pool with no liquidity reading). Reporting `unknown`
  // keeps a never-run check from reading as a confident `pass`.
  if (r.tradeManipulation.insufficientSignalCodes.includes(code)) return 'unknown';
  return r.tradeManipulation.observedSignalCodes.includes(code) ? firedStatus : 'pass';
}

const SIGNAL_SEVERITY: Record<MarketIntegritySignalCode, RiskSeverity> = {
  SELF_TRADING: 'high',
  REPEATED_WALLET_PAIR: 'medium',
  ONE_WALLET_VOLUME_CONCENTRATION: 'medium',
  CIRCULAR_WALLET_VOLUME: 'medium',
  RAPID_BUY_SELL_LOOP: 'medium',
  TINY_TRADE_COUNT_INFLATION: 'medium',
  THIN_POOL_PRICE_MANIPULATION: 'medium',
};

const PRICE_SPECS: readonly Spec[] = [
  {
    ruleId: 'market.source_price_disagreement',
    title: 'Price sources disagree',
    description: 'Independent price sources disagree beyond the configured threshold.',
    severity: 'medium',
    firedStatus: 'warning',
    whenPresent:
      'Independent price sources disagree beyond the configured threshold at this block.',
    whenAbsent: 'Independent price sources agree within the configured threshold.',
    remediation: 'Treat the price as uncertain until the sources reconcile.',
    source: MARKET_PRICE_RELIABILITY_SOURCE,
    evaluate: (r) =>
      priceStatus(r, r.priceReliability.disagreementSourceKeys.length > 0, true, 'warning'),
  },
  {
    ruleId: 'market.price_outlier',
    title: 'Price is an outlier',
    description: 'The observation was flagged as an outlier.',
    severity: 'medium',
    firedStatus: 'warning',
    whenPresent: 'The price observation at this block was flagged as an outlier.',
    whenAbsent: 'The price observation at this block was not an outlier.',
    remediation: 'Confirm the price against another source before relying on it.',
    source: MARKET_PRICE_RELIABILITY_SOURCE,
    evaluate: (r) => priceStatus(r, r.priceReliability.outlierReasons.length > 0, false, 'warning'),
  },
  {
    ruleId: 'market.single_transaction_price_manipulation',
    title: 'Single-transaction price manipulation',
    description: 'The price appears set by a single transaction.',
    severity: 'high',
    firedStatus: 'fail',
    whenPresent:
      'The price appears to have been set by a single transaction rather than a real market.',
    whenAbsent: 'The price was not attributable to a single manipulating transaction.',
    remediation: 'Do not trust this price; it is consistent with a one-transaction move.',
    source: MARKET_PRICE_RELIABILITY_SOURCE,
    evaluate: (r) => priceStatus(r, r.priceReliability.oneTransactionManipulation, false, 'fail'),
  },
];

const SIGNAL_COPY: Record<
  MarketIntegritySignalCode,
  { title: string; present: string; absent: string; remediation: string }
> = {
  SELF_TRADING: {
    title: 'Wash trading (self-trading)',
    present:
      'Trades where the buyer and seller are the same party were observed, consistent with wash trading.',
    absent: 'No self-trading was observed in the pinned window.',
    remediation: 'Discount reported volume; it includes self-trading.',
  },
  REPEATED_WALLET_PAIR: {
    title: 'Repeated wallet-pair trading',
    present: 'A small set of wallet pairs accounts for a disproportionate share of trades.',
    absent: 'No dominant repeated wallet pairs were observed.',
    remediation: 'Treat volume from repeated pairs as potentially inorganic.',
  },
  ONE_WALLET_VOLUME_CONCENTRATION: {
    title: 'Single-wallet volume concentration',
    present: 'One wallet accounts for a dominant share of trading volume.',
    absent: 'Trading volume is not dominated by a single wallet.',
    remediation: 'Expect volume to collapse if the dominant wallet stops trading.',
  },
  CIRCULAR_WALLET_VOLUME: {
    title: 'Circular wallet volume',
    present:
      'Volume circulates among a closed group of wallets, consistent with fabricated activity.',
    absent: 'No circular wallet volume was observed.',
    remediation: 'Discount circular volume when judging real demand.',
  },
  RAPID_BUY_SELL_LOOP: {
    title: 'Rapid buy/sell loops',
    present: 'Wallets rapidly buy and sell in loops, consistent with volume inflation.',
    absent: 'No rapid buy/sell loops were observed.',
    remediation: 'Discount looped volume when judging real demand.',
  },
  TINY_TRADE_COUNT_INFLATION: {
    title: 'Tiny-trade count inflation',
    present: 'Many tiny trades inflate the trade count without meaningful volume.',
    absent: 'The trade count is not inflated by tiny trades.',
    remediation: 'Judge activity by volume, not trade count, for this token.',
  },
  THIN_POOL_PRICE_MANIPULATION: {
    title: 'Thin-pool price manipulation',
    present: 'The pool is thin enough that small trades move the price materially.',
    absent: 'The pool is deep enough to resist single-trade price moves.',
    remediation: 'Expect high slippage and price manipulation risk in this pool.',
  },
};

function tradeSpec(code: MarketIntegritySignalCode): Spec {
  const copy = SIGNAL_COPY[code];
  const severity = SIGNAL_SEVERITY[code];
  const firedStatus: 'fail' | 'warning' = severity === 'high' ? 'fail' : 'warning';
  return {
    ruleId: `market.${code.toLowerCase()}`,
    title: copy.title,
    description: copy.present,
    severity,
    firedStatus,
    whenPresent: copy.present,
    whenAbsent: copy.absent,
    remediation: copy.remediation,
    source: MARKET_TRADE_MANIPULATION_SOURCE,
    evaluate: (r) => tradeStatus(r, code, firedStatus),
  };
}

const SPECS: readonly Spec[] = [...PRICE_SPECS, ...MARKET_INTEGRITY_SIGNAL_CODES.map(tradeSpec)];

function evaluationFor(spec: Spec, context: Readonly<RiskScanContext>): RiskRuleEvaluation {
  const result = deserializeMarketIntegrityResult(context.data[spec.source]);
  const status = spec.evaluate(result);
  const fired = status === 'fail' || status === 'warning';
  return {
    status,
    severity: fired ? spec.severity : 'info',
    confidence: {
      level: status === 'unknown' ? 'unknown' : 'high',
      basisPoints: status === 'unknown' ? 0 : 9000,
      rationale:
        status === 'unknown'
          ? 'The required market data was not readable at the pinned block.'
          : 'Derived from pinned price selection and manipulation analysis.',
    },
    title: fired ? spec.title : `${spec.title} not found`,
    explanation:
      status === 'not_applicable'
        ? 'This market-integrity check does not apply at the pinned block (insufficient sources or activity).'
        : status === 'unknown'
          ? 'The required market data was not readable at the pinned block.'
          : fired
            ? spec.whenPresent
            : spec.whenAbsent,
    evidence: [
      {
        evidenceType:
          spec.source === MARKET_PRICE_RELIABILITY_SOURCE
            ? 'price_reliability'
            : 'trade_manipulation',
        summary: fired ? spec.whenPresent : spec.whenAbsent,
        data: {
          activeSourceCount: result.priceReliability.activeSourceCount,
          disagreementSourceKeys: [...result.priceReliability.disagreementSourceKeys],
          outlierReasons: [...result.priceReliability.outlierReasons],
          tradeCount: result.tradeManipulation.tradeCount,
          observedSignalCodes: [...result.tradeManipulation.observedSignalCodes],
          methodologyVersion: result.tradeManipulation.methodologyVersion,
        },
        provenanceKeys: [spec.source],
      },
    ],
    remediation: fired ? spec.remediation : null,
    fingerprintSeed: spec.ruleId,
  };
}

export function createMarketIntegrityRiskRules(): readonly RiskRule[] {
  return SPECS.map((spec) => ({
    ruleId: spec.ruleId,
    version: '1.0.0',
    category: 'Market integrity' as const,
    title: spec.title,
    description: spec.description,
    requiredDataSources: [spec.source],
    maxPenaltyBps: spec.severity === 'high' ? 2500 : 800,
    evaluate: async (context: Readonly<RiskScanContext>) => evaluationFor(spec, context),
  }));
}
