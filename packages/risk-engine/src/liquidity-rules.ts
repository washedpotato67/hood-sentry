import type {
  LiquidityOwnership,
  LiquidityPoolEvidence,
  LiquidityRemovalEvent,
  LiquidityRiskResult,
  StandardTradeImpact,
} from './liquidity-risk.js';
import type {
  RiskConfidence,
  RiskFindingStatus,
  RiskRule,
  RiskRuleEvaluation,
  RiskScanContext,
  RiskSeverity,
} from './types.js';

/** Provenance key for the pinned pool state the liquidity analyzer consumes. */
export const LIQUIDITY_STATE_SOURCE = 'protocol_liquidity_state';

/**
 * A single liquidity provider holding at least this share of a pool can move the
 * price or withdraw the market on its own.
 */
const PROVIDER_CONCENTRATION_WARNING_BPS = 9_000n;

export const LIQUIDITY_RULE_CODES = [
  'UNKNOWN_PROTOCOL',
  'LIQUIDITY_NOT_VERIFIABLY_LOCKED',
  'REMOVABLE_CREATOR_LIQUIDITY',
  'ABRUPT_LIQUIDITY_REMOVAL',
  'SINGLE_POOL_DEPENDENCY',
  'UNEXPECTED_MIGRATION_VENUE',
  'PROVIDER_CONCENTRATION',
  'STANDARD_TRADE_PRICE_IMPACT_UNAVAILABLE',
  'HIGH_STANDARD_TRADE_PRICE_IMPACT',
  'SINGLE_MARKET_POOL',
  'POOL_LIQUIDITY_CONCENTRATION',
] as const;
export type LiquidityRuleCode = (typeof LIQUIDITY_RULE_CODES)[number];

interface RuleSpec {
  readonly severity: RiskSeverity;
  /** Status to report when the condition holds. */
  readonly status: RiskFindingStatus;
  readonly title: string;
  readonly description: string;
  readonly whenPresent: string;
  readonly whenAbsent: string;
  readonly remediation: string;
}

/**
 * `unknown` rather than `fail` is deliberate where the analyzer proves absence of
 * evidence rather than presence of a problem: an unverifiable lock is not the same
 * claim as a lock that is known to be missing.
 */
const SPECS: Record<LiquidityRuleCode, RuleSpec> = {
  UNKNOWN_PROTOCOL: {
    severity: 'medium',
    status: 'warning',
    title: 'Unrecognised protocol',
    description: 'The pool belongs to a protocol outside the verified registry.',
    whenPresent:
      'This pool belongs to a protocol that is not in the verified registry, so its reserve and fee semantics cannot be interpreted reliably.',
    whenAbsent: 'The pool belongs to a protocol in the verified registry.',
    remediation: 'Treat reserve, fee, and price readings from this pool as uninterpreted.',
  },
  LIQUIDITY_NOT_VERIFIABLY_LOCKED: {
    severity: 'medium',
    status: 'unknown',
    title: 'Liquidity lock unverifiable',
    description: 'Ownership of the LP position could not be verified at the pinned block.',
    whenPresent:
      'LP ownership or lock conditions could not be verified at the pinned block. This is an absence of evidence, not proof that liquidity is unlocked.',
    whenAbsent: 'LP ownership and lock conditions were verified at the pinned block.',
    remediation:
      'Verify the lock contract, beneficiary, and unlock time directly before relying on locked liquidity.',
  },
  REMOVABLE_CREATOR_LIQUIDITY: {
    severity: 'high',
    status: 'fail',
    title: 'Creator can remove liquidity',
    description: 'The LP position is held by the creator and can be withdrawn at any time.',
    whenPresent:
      'The LP position is held by the token creator, who can withdraw the market at any time.',
    whenAbsent: 'The LP position is not held by the token creator.',
    remediation: 'Do not treat this market as durable while the creator holds the LP position.',
  },
  ABRUPT_LIQUIDITY_REMOVAL: {
    severity: 'high',
    status: 'fail',
    title: 'Abrupt liquidity removal',
    description: 'Removals exceed half of current liquidity.',
    whenPresent:
      'Observed removals exceed half of the pool current liquidity, which is consistent with liquidity being withdrawn.',
    whenAbsent: 'No abrupt liquidity removal was observed at the pinned block.',
    remediation: 'Review the removal transactions and the recipient before trading this market.',
  },
  SINGLE_POOL_DEPENDENCY: {
    severity: 'medium',
    status: 'warning',
    title: 'Single liquidity provider',
    description: 'The pool depends on one liquidity provider.',
    whenPresent:
      'All liquidity comes from a single provider, so the entire market depends on one party.',
    whenAbsent: 'Liquidity comes from more than one provider.',
    remediation: 'Expect the market to disappear if the sole provider exits.',
  },
  UNEXPECTED_MIGRATION_VENUE: {
    severity: 'high',
    status: 'fail',
    title: 'Unexpected migration venue',
    description: 'Liquidity migrated somewhere other than the expected destination.',
    whenPresent:
      'Liquidity migrated to a venue other than the expected destination for this launchpad.',
    whenAbsent: 'No unexpected migration venue was observed.',
    remediation: 'Confirm the destination pool and its ownership before trading.',
  },
  PROVIDER_CONCENTRATION: {
    severity: 'medium',
    status: 'warning',
    title: 'Concentrated liquidity provider',
    description: 'One provider holds a dominant share of pool liquidity.',
    whenPresent: 'One provider holds a dominant share of pool liquidity.',
    whenAbsent: 'No single provider holds a dominant share of pool liquidity.',
    remediation: 'Size positions against the possibility that the dominant provider exits.',
  },
  STANDARD_TRADE_PRICE_IMPACT_UNAVAILABLE: {
    severity: 'medium',
    status: 'unknown',
    title: 'Standard trade impact unavailable',
    description: 'Pinned normalized quote evidence is missing for the standard trade size.',
    whenPresent:
      'The analyzer lacks enough pinned quote evidence to calculate the standard trade price impact.',
    whenAbsent: 'The standard trade price impact was calculated from pinned pool state.',
    remediation: 'Confirm the quote asset conversion and pool reserves before sizing a trade.',
  },
  HIGH_STANDARD_TRADE_PRICE_IMPACT: {
    severity: 'medium',
    status: 'warning',
    title: 'High standard trade impact',
    description: 'The best verified pool quote loses at least ten percent against spot execution.',
    whenPresent:
      'The best verified pool quote has at least ten percent price impact at the standard trade size.',
    whenAbsent: 'The standard trade price impact stays below ten percent.',
    remediation: 'Reduce order size or wait for deeper verified liquidity.',
  },
  SINGLE_MARKET_POOL: {
    severity: 'medium',
    status: 'warning',
    title: 'Single market pool',
    description: 'Only one verified pool supplies market liquidity for the token.',
    whenPresent: 'Only one verified pool supplies liquidity for this token.',
    whenAbsent: 'More than one verified pool supplies liquidity for this token.',
    remediation: 'Review the effect of a full exit from the only verified pool.',
  },
  POOL_LIQUIDITY_CONCENTRATION: {
    severity: 'medium',
    status: 'warning',
    title: 'Liquidity concentrated in one pool',
    description: 'One pool holds at least ninety percent of normalized quote liquidity.',
    whenPresent: 'One pool holds at least ninety percent of normalized quote liquidity.',
    whenAbsent: 'No pool holds ninety percent of normalized quote liquidity.',
    remediation: 'Review the dominant pool protocol, ownership, and removal history.',
  },
};

function isLiquidityRiskResult(value: unknown): value is LiquidityRiskResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    'findings' in value &&
    Array.isArray(value.findings) &&
    'providerConcentrationBps' in value &&
    typeof value.providerConcentrationBps === 'bigint' &&
    'sourceBlock' in value &&
    typeof value.sourceBlock === 'bigint' &&
    'ownership' in value
  );
}

function liquidityResult(context: Readonly<RiskScanContext>): LiquidityRiskResult {
  const value = context.data.liquidityAnalysis;
  if (!isLiquidityRiskResult(value)) throw new Error('Liquidity analysis data is malformed');
  return value;
}

function confidence(
  result: LiquidityRiskResult,
  status: RiskFindingStatus,
  triggered: boolean,
): RiskConfidence {
  // A withheld conclusion carries no confidence: the engine reports that it does not
  // know, not that it is confident about not knowing.
  if (status === 'unknown') {
    return {
      level: 'unknown',
      basisPoints: 0,
      rationale: 'The analyzer could not verify this condition at the pinned block.',
    };
  }
  if (!triggered) {
    return {
      level: 'high',
      basisPoints: 8_500,
      rationale: 'Pinned pool state analysis did not find this condition.',
    };
  }
  // A conclusion drawn from an unverified protocol rests on reserve semantics the
  // registry has not confirmed, so it cannot carry full confidence.
  return result.verifiedProtocol
    ? {
        level: 'high',
        basisPoints: 8_500,
        rationale: 'Verified protocol reserves and LP ownership at the pinned block support this.',
      }
    : {
        level: 'low',
        basisPoints: 3_000,
        rationale: 'The protocol is unverified, so pool reserve semantics are uninterpreted.',
      };
}

function isTriggered(code: LiquidityRuleCode, result: LiquidityRiskResult): boolean {
  if (code === 'PROVIDER_CONCENTRATION') {
    return result.providerConcentrationBps >= PROVIDER_CONCENTRATION_WARNING_BPS;
  }
  return result.findings.includes(code);
}

function serializedTradeImpact(impact: StandardTradeImpact): Record<string, unknown> {
  return {
    amountQuoteRaw: impact.amountQuoteRaw.toString(),
    amountPoolQuoteRaw: impact.amountPoolQuoteRaw.toString(),
    expectedTokenOutRaw: impact.expectedTokenOutRaw.toString(),
    priceImpactBps: impact.priceImpactBps.toString(),
    poolAddress: impact.poolAddress,
  };
}

function serializedOwnership(ownership: LiquidityOwnership): Record<string, unknown> {
  return {
    ...ownership,
    unlockTime: ownership.unlockTime?.toString() ?? null,
    evidence:
      ownership.evidence === undefined
        ? null
        : {
            ...ownership.evidence,
            sourceBlock: ownership.evidence.sourceBlock.toString(),
          },
  };
}

function serializedRemovalEvent(event: LiquidityRemovalEvent): Record<string, unknown> {
  return {
    amountRaw: event.amountRaw.toString(),
    blockNumber: event.blockNumber.toString(),
    blockHash: event.blockHash,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
  };
}

function serializedPool(pool: LiquidityPoolEvidence): Record<string, unknown> {
  return {
    poolAddress: pool.poolAddress,
    protocolKey: pool.protocolKey,
    protocolVersion: pool.protocolVersion,
    poolType: pool.poolType,
    quoteAsset: pool.quoteAsset,
    poolAgeBlocks: pool.poolAgeBlocks.toString(),
    tokenLiquidityRaw: pool.tokenLiquidityRaw.toString(),
    quoteLiquidityRaw: pool.quoteLiquidityRaw.toString(),
    currentLiquidityRaw: pool.currentLiquidityRaw.toString(),
    burnedLiquidityRaw: pool.burnedLiquidityRaw.toString(),
    burnedProviders: pool.burnedProviders.map((provider) => ({
      address: provider.address,
      liquidityRaw: provider.liquidityRaw.toString(),
    })),
    providers: pool.providers.map((provider) => ({
      address: provider.address,
      liquidityRaw: provider.liquidityRaw.toString(),
    })),
    providerCount: pool.providers.length,
    ownership: serializedOwnership(pool.ownership),
    removalsRaw: pool.removalsRaw.toString(),
    additionsRaw: pool.additionsRaw.toString(),
    removalEvents: pool.removalEvents.map(serializedRemovalEvent),
    normalizedQuoteLiquidityRaw: pool.normalizedQuoteLiquidityRaw.toString(),
    normalization: {
      ...pool.normalization,
      priceRaw: pool.normalization.priceRaw.toString(),
      sourceBlock: pool.normalization.sourceBlock?.toString() ?? null,
    },
    standardTradeImpacts: pool.standardTradeImpacts.map(serializedTradeImpact),
  };
}

function liquidityEvidenceData(
  code: LiquidityRuleCode,
  result: LiquidityRiskResult,
): Record<string, unknown> {
  return {
    code,
    poolAddress: result.poolAddress,
    protocolKey: result.protocolKey,
    verifiedProtocol: result.verifiedProtocol,
    ownership: serializedOwnership(result.ownership),
    providerConcentrationBps: result.providerConcentrationBps.toString(),
    providerCount: result.providers.length,
    poolCount: result.poolCount,
    poolConcentrationBps: result.poolConcentrationBps?.toString() ?? null,
    currentLiquidityRaw: result.currentLiquidityRaw.toString(),
    burnedLiquidityRaw: result.burnedLiquidityRaw.toString(),
    burnedProviders: result.burnedProviders.map((provider) => ({
      address: provider.address,
      liquidityRaw: provider.liquidityRaw.toString(),
    })),
    removalsRaw: result.removalsRaw.toString(),
    removalEvents: result.removalEvents.map(serializedRemovalEvent),
    additionsRaw: result.additionsRaw.toString(),
    normalizationQuoteAsset: result.normalizationQuoteAsset ?? null,
    normalizationQuoteDecimals: result.normalizationQuoteDecimals ?? null,
    normalizedQuoteLiquidityRaw: result.normalizedQuoteLiquidityRaw?.toString() ?? null,
    standardTradeSizeQuoteRaw: result.standardTradeSizeQuoteRaw?.toString() ?? null,
    priceImpactBps: result.priceImpactBps?.toString() ?? null,
    standardTradeImpacts: result.standardTradeImpacts?.map(serializedTradeImpact) ?? [],
    pools: result.pools?.map(serializedPool) ?? [],
    migrationDestination: result.migrationDestination ?? null,
    expectedMigrationDestination: result.expectedMigrationDestination ?? null,
    sourceBlock: result.sourceBlock.toString(),
    warnings: result.warnings,
  };
}

function evaluation(
  code: LiquidityRuleCode,
  context: Readonly<RiskScanContext>,
): RiskRuleEvaluation {
  const result = liquidityResult(context);
  const spec = SPECS[code];
  const triggered = isTriggered(code, result);
  const status = triggered ? spec.status : 'pass';

  return {
    status,
    severity: triggered ? spec.severity : 'info',
    confidence: confidence(result, status, triggered),
    title: triggered ? spec.title : `${spec.title} not found`,
    explanation: triggered ? spec.whenPresent : spec.whenAbsent,
    evidence: [
      {
        evidenceType: 'liquidity_analysis',
        summary: triggered ? spec.whenPresent : spec.whenAbsent,
        data: liquidityEvidenceData(code, result),
        provenanceKeys: [LIQUIDITY_STATE_SOURCE],
      },
    ],
    remediation: triggered ? spec.remediation : null,
    fingerprintSeed: code,
  };
}

function maxPenalty(code: LiquidityRuleCode): number {
  // An unverifiable lock withholds a conclusion rather than asserting one, so it
  // must not deduct from the score. Completeness carries that signal instead.
  if (SPECS[code].status === 'unknown') return 0;
  return SPECS[code].severity === 'high' ? 2_500 : 800;
}

/**
 * Deterministic liquidity rules over pinned pool state.
 *
 * Every rule reads the same `liquidityAnalysis` result, so a scan at a given block
 * always produces the same findings.
 */
export function createLiquidityRiskRules(): readonly RiskRule[] {
  return LIQUIDITY_RULE_CODES.map((code) => ({
    ruleId: `liquidity.${code.toLowerCase()}`,
    version: '1.1.0',
    category: 'Liquidity' as const,
    title: SPECS[code].title,
    description: SPECS[code].description,
    requiredDataSources: [LIQUIDITY_STATE_SOURCE],
    maxPenaltyBps: maxPenalty(code),
    // async so malformed data rejects the promise rather than throwing synchronously
    // out of a call the signature declares as returning one.
    evaluate: async (context: Readonly<RiskScanContext>) => evaluation(code, context),
  }));
}
