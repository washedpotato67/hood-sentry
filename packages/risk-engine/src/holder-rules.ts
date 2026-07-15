import type { HolderSnapshot } from './holder-types.js';
import type {
  RiskConfidence,
  RiskRule,
  RiskRuleEvaluation,
  RiskScanContext,
  RiskSeverity,
} from './types.js';

/** Provenance key for the pinned holder balances the analyzer consumes. */
export const HOLDER_BALANCES_SOURCE = 'chain_holder_balances';

/**
 * Concentration thresholds, in basis points of adjusted supply.
 *
 * Adjusted supply excludes verified pools, burns, and bridges, so these measure
 * what a small number of ordinary holders control.
 */
const TOP1_FAIL_BPS = 5_000n;
const TOP1_WARNING_BPS = 2_500n;
const TOP10_FAIL_BPS = 8_000n;
const TOP10_WARNING_BPS = 5_000n;

/** A Gini coefficient this high means supply sits with very few addresses. */
const GINI_WARNING_SCALED = 9_000n;

/** Below this many holders, distribution statistics describe a handful of wallets. */
const HOLDER_COUNT_WARNING = 50;

export const HOLDER_RULE_CODES = [
  'TOP1_CONCENTRATION',
  'TOP10_CONCENTRATION',
  'SUPPLY_INEQUALITY',
  'HOLDER_COUNT',
  'CIRCULATING_SUPPLY_UNKNOWN',
] as const;
export type HolderRuleCode = (typeof HOLDER_RULE_CODES)[number];

function isHolderSnapshot(value: unknown): value is HolderSnapshot {
  return (
    value !== null &&
    typeof value === 'object' &&
    'rawConcentrationBps' in value &&
    typeof value.rawConcentrationBps === 'object' &&
    'adjustedConcentrationBps' in value &&
    typeof value.adjustedConcentrationBps === 'object' &&
    'holderCount' in value &&
    typeof value.holderCount === 'number' &&
    'allocations' in value &&
    'warnings' in value &&
    Array.isArray(value.warnings)
  );
}

function holderSnapshot(context: Readonly<RiskScanContext>): HolderSnapshot {
  const value = context.data.holderAnalysis;
  if (!isHolderSnapshot(value)) throw new Error('Holder analysis data is malformed');
  return value;
}

/**
 * A snapshot built from partial history cannot support a concentration claim: the
 * missing balances could sit anywhere in the distribution.
 */
function historyIncomplete(snapshot: HolderSnapshot): boolean {
  return snapshot.warnings.includes('Holder history is incomplete');
}

function evidenceOf(
  snapshot: HolderSnapshot,
  code: HolderRuleCode,
  summary: string,
): RiskRuleEvaluation['evidence'] {
  return [
    {
      evidenceType: 'holder_distribution',
      summary,
      data: {
        code,
        holderCount: snapshot.holderCount,
        totalSupplyRaw: snapshot.totalSupplyRaw?.toString() ?? null,
        circulatingSupplyRaw: snapshot.circulatingSupplyRaw?.toString() ?? null,
        rawConcentrationBps: {
          top1: snapshot.rawConcentrationBps.top1.toString(),
          top5: snapshot.rawConcentrationBps.top5.toString(),
          top10: snapshot.rawConcentrationBps.top10.toString(),
          top20: snapshot.rawConcentrationBps.top20.toString(),
        },
        adjustedConcentrationBps: {
          top1: snapshot.adjustedConcentrationBps.top1.toString(),
          top5: snapshot.adjustedConcentrationBps.top5.toString(),
          top10: snapshot.adjustedConcentrationBps.top10.toString(),
          top20: snapshot.adjustedConcentrationBps.top20.toString(),
        },
        giniScaled: snapshot.giniScaled?.toString() ?? null,
        exclusions: snapshot.exclusions,
        sourceBlock: snapshot.sourceBlock.toString(),
        warnings: snapshot.warnings,
      },
      provenanceKeys: [HOLDER_BALANCES_SOURCE],
    },
  ];
}

const MEASURED: RiskConfidence = {
  level: 'high',
  basisPoints: 8_500,
  rationale: 'Balances are measured directly from pinned chain state.',
};

function incompleteHistoryEvaluation(
  snapshot: HolderSnapshot,
  code: HolderRuleCode,
  title: string,
): RiskRuleEvaluation {
  const summary =
    'Holder history is incomplete at the pinned block, so the distribution cannot be measured.';
  return {
    status: 'unknown',
    severity: 'info',
    confidence: {
      level: 'unknown',
      basisPoints: 0,
      rationale: 'Missing holder history could sit anywhere in the distribution.',
    },
    title: `${title} unavailable`,
    explanation: summary,
    evidence: evidenceOf(snapshot, code, summary),
    remediation: 'Backfill holder history for this token and rescan at a pinned block.',
    fingerprintSeed: code,
  };
}

function concentrationEvaluation(
  context: Readonly<RiskScanContext>,
  code: 'TOP1_CONCENTRATION' | 'TOP10_CONCENTRATION',
): RiskRuleEvaluation {
  const snapshot = holderSnapshot(context);
  const isTop1 = code === 'TOP1_CONCENTRATION';
  const label = isTop1 ? 'Largest holder' : 'Top ten holders';
  if (historyIncomplete(snapshot)) return incompleteHistoryEvaluation(snapshot, code, label);

  const shareBps = isTop1
    ? snapshot.adjustedConcentrationBps.top1
    : snapshot.adjustedConcentrationBps.top10;
  const failAt = isTop1 ? TOP1_FAIL_BPS : TOP10_FAIL_BPS;
  const warnAt = isTop1 ? TOP1_WARNING_BPS : TOP10_WARNING_BPS;
  const percent = `${(Number(shareBps) / 100).toFixed(2)}%`;

  const severity: RiskSeverity =
    shareBps >= failAt ? 'high' : shareBps >= warnAt ? 'medium' : 'info';
  const status = shareBps >= failAt ? 'fail' : shareBps >= warnAt ? 'warning' : 'pass';
  const summary =
    status === 'pass'
      ? `${label} hold ${percent} of adjusted supply, below the ${(Number(warnAt) / 100).toFixed(0)}% threshold.`
      : `${label} hold ${percent} of adjusted supply, which is enough to move or exit the market.`;

  return {
    status,
    severity,
    confidence: MEASURED,
    title: status === 'pass' ? `${label} concentration within threshold` : `${label} concentration`,
    explanation: summary,
    evidence: evidenceOf(snapshot, code, summary),
    remediation:
      status === 'pass'
        ? null
        : 'Check whether the concentrated addresses are verifiably locked, vested, or exchange-held before treating supply as distributed.',
    fingerprintSeed: code,
  };
}

function inequalityEvaluation(context: Readonly<RiskScanContext>): RiskRuleEvaluation {
  const snapshot = holderSnapshot(context);
  const code = 'SUPPLY_INEQUALITY';
  if (historyIncomplete(snapshot)) {
    return incompleteHistoryEvaluation(snapshot, code, 'Supply inequality');
  }

  const gini = snapshot.giniScaled;
  if (gini === null) {
    const summary = 'No positive balances were observed, so inequality is undefined.';
    return {
      status: 'unknown',
      severity: 'info',
      confidence: {
        level: 'unknown',
        basisPoints: 0,
        rationale: 'Inequality is undefined without positive balances.',
      },
      title: 'Supply inequality unavailable',
      explanation: summary,
      evidence: evidenceOf(snapshot, code, summary),
      remediation: 'Rescan once holder balances are indexed for this token.',
      fingerprintSeed: code,
    };
  }

  const triggered = gini >= GINI_WARNING_SCALED;
  const summary = triggered
    ? `Supply is highly unequal (Gini ${(Number(gini) / 10_000).toFixed(4)}), concentrated in very few addresses.`
    : `Supply inequality (Gini ${(Number(gini) / 10_000).toFixed(4)}) is below the reporting threshold.`;

  return {
    status: triggered ? 'warning' : 'pass',
    severity: triggered ? 'medium' : 'info',
    confidence: MEASURED,
    title: triggered ? 'Supply inequality' : 'Supply inequality within threshold',
    explanation: summary,
    evidence: evidenceOf(snapshot, code, summary),
    remediation: triggered ? 'Review the largest holders and their provenance.' : null,
    fingerprintSeed: code,
  };
}

function holderCountEvaluation(context: Readonly<RiskScanContext>): RiskRuleEvaluation {
  const snapshot = holderSnapshot(context);
  const code = 'HOLDER_COUNT';
  if (historyIncomplete(snapshot)) {
    return incompleteHistoryEvaluation(snapshot, code, 'Holder count');
  }

  const triggered = snapshot.holderCount < HOLDER_COUNT_WARNING;
  const summary = triggered
    ? `The token has ${snapshot.holderCount} holders with a positive balance, too few for distribution statistics to describe a market.`
    : `The token has ${snapshot.holderCount} holders with a positive balance.`;

  return {
    status: triggered ? 'warning' : 'pass',
    severity: triggered ? 'low' : 'info',
    confidence: MEASURED,
    title: triggered ? 'Few holders' : 'Holder count within threshold',
    explanation: summary,
    evidence: evidenceOf(snapshot, code, summary),
    remediation: triggered ? 'Treat concentration statistics for this token as provisional.' : null,
    fingerprintSeed: code,
  };
}

/**
 * Reports whether circulating supply could be established at all. Reporting a
 * circulating supply that the analyzer could not derive would be a fabricated number.
 */
function circulatingSupplyEvaluation(context: Readonly<RiskScanContext>): RiskRuleEvaluation {
  const snapshot = holderSnapshot(context);
  const code = 'CIRCULATING_SUPPLY_UNKNOWN';
  const known = snapshot.circulatingSupplyRaw !== null;
  const summary = known
    ? 'Circulating supply was derived from total supply and verified exclusions.'
    : 'Circulating supply cannot be derived: total supply is unavailable or the token rebase state is uncertain.';

  return {
    status: known ? 'pass' : 'unknown',
    severity: 'info',
    confidence: known
      ? MEASURED
      : {
          level: 'unknown',
          basisPoints: 0,
          rationale: 'Total supply is unavailable or the rebase state is uncertain.',
        },
    title: known ? 'Circulating supply available' : 'Circulating supply unavailable',
    explanation: summary,
    evidence: evidenceOf(snapshot, code, summary),
    remediation: known ? null : 'Resolve the token rebase state and total supply, then rescan.',
    fingerprintSeed: code,
  };
}

const EVALUATORS: Record<
  HolderRuleCode,
  (context: Readonly<RiskScanContext>) => RiskRuleEvaluation
> = {
  TOP1_CONCENTRATION: (context) => concentrationEvaluation(context, 'TOP1_CONCENTRATION'),
  TOP10_CONCENTRATION: (context) => concentrationEvaluation(context, 'TOP10_CONCENTRATION'),
  SUPPLY_INEQUALITY: inequalityEvaluation,
  HOLDER_COUNT: holderCountEvaluation,
  CIRCULATING_SUPPLY_UNKNOWN: circulatingSupplyEvaluation,
};

const TITLES: Record<HolderRuleCode, string> = {
  TOP1_CONCENTRATION: 'Largest holder concentration',
  TOP10_CONCENTRATION: 'Top ten holder concentration',
  SUPPLY_INEQUALITY: 'Supply inequality',
  HOLDER_COUNT: 'Holder count',
  CIRCULATING_SUPPLY_UNKNOWN: 'Circulating supply availability',
};

const DESCRIPTIONS: Record<HolderRuleCode, string> = {
  TOP1_CONCENTRATION: 'Share of adjusted supply held by the largest holder.',
  TOP10_CONCENTRATION: 'Share of adjusted supply held by the ten largest holders.',
  SUPPLY_INEQUALITY: 'Gini coefficient of holder balances.',
  HOLDER_COUNT: 'Number of addresses holding a positive balance.',
  CIRCULATING_SUPPLY_UNKNOWN: 'Whether circulating supply can be derived at the pinned block.',
};

/**
 * Penalties apply only to measured concentration. Rules that withhold a conclusion
 * carry no penalty; the scan completeness signal reports the missing data instead.
 */
const MAX_PENALTIES: Record<HolderRuleCode, number> = {
  TOP1_CONCENTRATION: 2_500,
  TOP10_CONCENTRATION: 2_000,
  SUPPLY_INEQUALITY: 800,
  HOLDER_COUNT: 400,
  CIRCULATING_SUPPLY_UNKNOWN: 0,
};

/**
 * Deterministic holder distribution rules over a pinned holder snapshot.
 */
export function createHolderDistributionRules(): readonly RiskRule[] {
  return HOLDER_RULE_CODES.map((code) => ({
    ruleId: `holder.${code.toLowerCase()}`,
    version: '1.0.0',
    category: 'Holder distribution' as const,
    title: TITLES[code],
    description: DESCRIPTIONS[code],
    requiredDataSources: [HOLDER_BALANCES_SOURCE],
    maxPenaltyBps: MAX_PENALTIES[code],
    // async so malformed data rejects the promise rather than throwing synchronously
    // out of a call the signature declares as returning one.
    evaluate: async (context: Readonly<RiskScanContext>) => EVALUATORS[code](context),
  }));
}
