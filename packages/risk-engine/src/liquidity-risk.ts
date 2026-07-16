export type LiquidityOwnership = {
  kind: 'locked' | 'burned' | 'creator' | 'unknown';
  owner?: `0x${string}`;
  lockContract?: `0x${string}`;
  beneficiary?: `0x${string}`;
  unlockTime?: bigint;
  withdrawalConditions?: string;
  verified: boolean;
  evidence?: {
    sourceBlock: bigint;
    sourceBlockHash: `0x${string}`;
    transactionHash: `0x${string}`;
    logIndex: number;
    verificationSource: string;
    methodologyVersion: string;
  };
};

export type LiquidityRemovalEvent = {
  amountRaw: bigint;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  logIndex: number;
};

export type StandardTradeImpact = {
  amountQuoteRaw: bigint;
  amountPoolQuoteRaw: bigint;
  expectedTokenOutRaw: bigint;
  priceImpactBps: bigint;
  poolAddress: `0x${string}`;
};

export type LiquidityPoolEvidence = {
  poolAddress: `0x${string}`;
  protocolKey: string;
  protocolVersion: string;
  poolType: string;
  quoteAsset: `0x${string}`;
  poolAgeBlocks: bigint;
  tokenLiquidityRaw: bigint;
  quoteLiquidityRaw: bigint;
  currentLiquidityRaw: bigint;
  burnedLiquidityRaw: bigint;
  burnedProviders: readonly { address: `0x${string}`; liquidityRaw: bigint }[];
  providers: readonly { address: `0x${string}`; liquidityRaw: bigint }[];
  ownership: LiquidityOwnership;
  removalsRaw: bigint;
  additionsRaw: bigint;
  removalEvents: readonly LiquidityRemovalEvent[];
  normalizedQuoteLiquidityRaw: bigint;
  normalization: {
    kind: 'identity' | 'price_observation';
    quoteDecimals: number;
    normalizationQuoteAsset: `0x${string}`;
    normalizationQuoteDecimals: number;
    priceRaw: bigint;
    priceDecimals: number;
    observationKey?: string;
    sourceKey?: string;
    sourceBlock?: bigint;
    sourceBlockHash?: `0x${string}`;
    sourceTimestamp?: string;
    observedAt?: string;
    maximumStalenessSeconds?: number;
    verificationSourceUrl?: string;
    verifiedAt?: string;
  };
  standardTradeImpacts: readonly StandardTradeImpact[];
};

export type LiquidityRiskInput = {
  chainId: number;
  poolAddress: `0x${string}`;
  protocolKey: string;
  poolType: string;
  quoteAsset: `0x${string}`;
  verifiedProtocol: boolean;
  sourceBlock: bigint;
  sourceBlockHash: `0x${string}`;
  poolAgeBlocks: bigint;
  tokenLiquidityRaw: bigint;
  quoteLiquidityRaw: bigint;
  currentLiquidityRaw: bigint;
  burnedLiquidityRaw: bigint;
  burnedProviders: readonly { address: `0x${string}`; liquidityRaw: bigint }[];
  feeTier?: bigint;
  priceImpactBps?: bigint;
  providers: readonly { address: `0x${string}`; liquidityRaw: bigint }[];
  ownership: LiquidityOwnership;
  removalsRaw: bigint;
  additionsRaw: bigint;
  removalEvents: readonly LiquidityRemovalEvent[];
  normalizationQuoteAsset?: `0x${string}`;
  normalizationQuoteDecimals?: number;
  normalizedQuoteLiquidityRaw?: bigint;
  standardTradeSizeQuoteRaw?: bigint;
  standardTradeImpacts?: readonly StandardTradeImpact[];
  poolCount?: number;
  poolConcentrationBps?: bigint;
  pools?: readonly LiquidityPoolEvidence[];
  creatorAddress?: `0x${string}`;
  migrationDestination?: `0x${string}`;
  expectedMigrationDestination?: `0x${string}`;
};
export type LiquidityRiskResult = Omit<LiquidityRiskInput, 'poolCount' | 'poolConcentrationBps'> & {
  providerConcentrationBps: bigint;
  poolCount: number;
  poolConcentrationBps: bigint | null;
  status: 'verified' | 'warning' | 'unknown';
  warnings: readonly string[];
  findings: readonly string[];
};

function validateOwnershipTotals(input: LiquidityRiskInput): void {
  if (input.currentLiquidityRaw < 0n || input.burnedLiquidityRaw < 0n) {
    throw new Error('Liquidity totals must be unsigned');
  }
  const burned = input.burnedProviders.reduce((total, holder) => total + holder.liquidityRaw, 0n);
  if (burned !== input.burnedLiquidityRaw) {
    throw new Error('Burned LP evidence does not match the burned total');
  }
  if (input.providers.some((provider) => provider.liquidityRaw <= 0n)) {
    throw new Error('Liquidity providers must hold a positive balance');
  }
  const controllable = input.providers.reduce((a, p) => a + p.liquidityRaw, 0n);
  if (controllable + input.burnedLiquidityRaw > input.currentLiquidityRaw) {
    throw new Error('LP ownership exceeds total supply');
  }
}

function validateAggregateBounds(input: LiquidityRiskInput): void {
  if (
    input.priceImpactBps !== undefined &&
    (input.priceImpactBps < 0n || input.priceImpactBps > 10_000n)
  ) {
    throw new Error('Price impact must use basis points');
  }
  if (
    input.poolCount !== undefined &&
    (!Number.isInteger(input.poolCount) || input.poolCount <= 0)
  ) {
    throw new Error('Pool count must be a positive integer');
  }
  if (
    input.poolConcentrationBps !== undefined &&
    (input.poolConcentrationBps < 0n || input.poolConcentrationBps > 10_000n)
  ) {
    throw new Error('Pool concentration must use basis points');
  }
}

function validatePoolEvidence(input: LiquidityRiskInput): void {
  if (input.pools !== undefined) {
    if (input.pools.length === 0) throw new Error('Pool evidence must not be empty');
    const addresses = new Set(input.pools.map((pool) => pool.poolAddress.toLowerCase()));
    if (addresses.size !== input.pools.length) throw new Error('Pool evidence contains duplicates');
    if (input.poolCount !== undefined && input.poolCount !== input.pools.length) {
      throw new Error('Pool evidence does not match the pool count');
    }
    if (input.pools.some((pool) => pool.normalizedQuoteLiquidityRaw < 0n)) {
      throw new Error('Normalized pool liquidity must be unsigned');
    }
    for (const pool of input.pools) validateSinglePoolEvidence(pool);
    const normalizedTotal = input.pools.reduce(
      (total, pool) => total + pool.normalizedQuoteLiquidityRaw,
      0n,
    );
    if (
      input.normalizedQuoteLiquidityRaw !== undefined &&
      normalizedTotal !== input.normalizedQuoteLiquidityRaw
    ) {
      throw new Error('Normalized pool liquidity does not match the aggregate');
    }
  }
}

function validateSinglePoolEvidence(pool: LiquidityPoolEvidence): void {
  if (pool.currentLiquidityRaw < 0n || pool.burnedLiquidityRaw < 0n) {
    throw new Error('Pool LP totals must be unsigned');
  }
  const burned = pool.burnedProviders.reduce(
    (total, provider) => total + provider.liquidityRaw,
    0n,
  );
  if (burned !== pool.burnedLiquidityRaw) {
    throw new Error('Pool burned LP evidence does not match its total');
  }
  if (pool.providers.some((provider) => provider.liquidityRaw <= 0n)) {
    throw new Error('Pool liquidity providers must hold a positive balance');
  }
  const providers = pool.providers.reduce((total, provider) => total + provider.liquidityRaw, 0n);
  if (providers + pool.burnedLiquidityRaw > pool.currentLiquidityRaw) {
    throw new Error('Pool LP ownership exceeds total supply');
  }
  const normalization = pool.normalization;
  if (
    !Number.isInteger(normalization.quoteDecimals) ||
    normalization.quoteDecimals < 0 ||
    normalization.quoteDecimals > 255 ||
    !Number.isInteger(normalization.normalizationQuoteDecimals) ||
    normalization.normalizationQuoteDecimals < 0 ||
    normalization.normalizationQuoteDecimals > 255 ||
    !Number.isInteger(normalization.priceDecimals) ||
    normalization.priceDecimals < 0 ||
    normalization.priceDecimals > 255 ||
    normalization.priceRaw <= 0n
  ) {
    throw new Error('Pool quote normalization is invalid');
  }
  if (
    normalization.kind === 'price_observation' &&
    (normalization.observationKey === undefined ||
      normalization.sourceKey === undefined ||
      normalization.sourceBlock === undefined ||
      normalization.sourceBlockHash === undefined ||
      normalization.sourceTimestamp === undefined ||
      normalization.observedAt === undefined ||
      normalization.maximumStalenessSeconds === undefined ||
      normalization.verificationSourceUrl === undefined ||
      normalization.verifiedAt === undefined)
  ) {
    throw new Error('Pool quote observation provenance is incomplete');
  }
}

function invalidTradeImpact(impact: StandardTradeImpact): boolean {
  return (
    impact.amountQuoteRaw <= 0n ||
    impact.amountPoolQuoteRaw <= 0n ||
    impact.expectedTokenOutRaw <= 0n ||
    impact.priceImpactBps < 0n ||
    impact.priceImpactBps > 10_000n
  );
}

function validateTradeImpacts(input: LiquidityRiskInput): void {
  const impacts = [
    ...(input.standardTradeImpacts ?? []),
    ...(input.pools?.flatMap((pool) => pool.standardTradeImpacts) ?? []),
  ];
  if (impacts.some(invalidTradeImpact)) {
    throw new Error('Standard trade impact evidence is invalid');
  }
}

function validateLiquidityInput(input: LiquidityRiskInput): void {
  validateOwnershipTotals(input);
  validateAggregateBounds(input);
  validatePoolEvidence(input);
  validateTradeImpacts(input);
}

function warnings(input: LiquidityRiskInput): string[] {
  const values: string[] = [];
  if (!input.verifiedProtocol) values.push('Protocol is not verified');
  if (!input.ownership.verified || input.ownership.kind === 'unknown') {
    values.push('LP ownership and lock conditions are not verified');
  }
  if (input.priceImpactBps === undefined) {
    values.push('Standard-size price impact is unavailable');
  } else if (input.priceImpactBps >= 1_000n) {
    values.push('Standard-size price impact is high');
  }
  return values;
}

function findings(input: LiquidityRiskInput): string[] {
  const values: string[] = [];
  if (!input.verifiedProtocol) values.push('UNKNOWN_PROTOCOL');
  if (!input.ownership.verified || input.ownership.kind === 'unknown') {
    values.push('LIQUIDITY_NOT_VERIFIABLY_LOCKED');
  }
  if (input.ownership.kind === 'creator') values.push('REMOVABLE_CREATOR_LIQUIDITY');
  if (
    input.removalsRaw > input.currentLiquidityRaw / 2n ||
    input.pools?.some((pool) => pool.removalsRaw > pool.currentLiquidityRaw / 2n)
  ) {
    values.push('ABRUPT_LIQUIDITY_REMOVAL');
  }
  if (input.providers.length === 1) values.push('SINGLE_POOL_DEPENDENCY');
  if (
    input.expectedMigrationDestination !== undefined &&
    input.migrationDestination !== input.expectedMigrationDestination
  ) {
    values.push('UNEXPECTED_MIGRATION_VENUE');
  }
  if (input.priceImpactBps === undefined) {
    values.push('STANDARD_TRADE_PRICE_IMPACT_UNAVAILABLE');
  } else if (input.priceImpactBps >= 1_000n) {
    values.push('HIGH_STANDARD_TRADE_PRICE_IMPACT');
  }
  if (input.poolCount === 1) values.push('SINGLE_MARKET_POOL');
  if (
    input.poolCount !== undefined &&
    input.poolCount > 1 &&
    input.poolConcentrationBps !== undefined &&
    input.poolConcentrationBps >= 9_000n
  ) {
    values.push('POOL_LIQUIDITY_CONCENTRATION');
  }
  return values;
}

export function analyzeLiquidityRisk(input: LiquidityRiskInput): LiquidityRiskResult {
  validateLiquidityInput(input);
  const top = input.providers.reduce(
    (highest, provider) => (provider.liquidityRaw > highest ? provider.liquidityRaw : highest),
    0n,
  );
  const concentration =
    input.currentLiquidityRaw === 0n ? 0n : (top * 10_000n) / input.currentLiquidityRaw;
  const poolCount = input.poolCount ?? input.pools?.length ?? 0;
  const poolConcentrationBps = input.poolConcentrationBps ?? null;
  const detectedFindings = findings(input);
  return {
    ...input,
    providerConcentrationBps: concentration,
    poolCount,
    poolConcentrationBps,
    status:
      !input.verifiedProtocol || !input.ownership.verified || input.priceImpactBps === undefined
        ? 'unknown'
        : detectedFindings.length > 0
          ? 'warning'
          : 'verified',
    warnings: warnings(input),
    findings: detectedFindings,
  };
}
