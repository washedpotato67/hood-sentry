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
  feeTier?: bigint;
  priceImpactBps: bigint;
  providers: readonly { address: `0x${string}`; liquidityRaw: bigint }[];
  ownership: {
    kind: 'locked' | 'burned' | 'creator' | 'unknown';
    owner?: `0x${string}`;
    lockContract?: `0x${string}`;
    beneficiary?: `0x${string}`;
    unlockTime?: bigint;
    withdrawalConditions?: string;
    verified: boolean;
  };
  removalsRaw: bigint;
  additionsRaw: bigint;
  creatorAddress?: `0x${string}`;
  migrationDestination?: `0x${string}`;
  expectedMigrationDestination?: `0x${string}`;
};
export type LiquidityRiskResult = LiquidityRiskInput & {
  providerConcentrationBps: bigint;
  status: 'verified' | 'warning' | 'unknown';
  warnings: readonly string[];
  findings: readonly string[];
};
export function analyzeLiquidityRisk(input: LiquidityRiskInput): LiquidityRiskResult {
  const total = input.providers.reduce((a, p) => a + p.liquidityRaw, 0n);
  const top =
    [...input.providers].sort((a, b) => (b.liquidityRaw > a.liquidityRaw ? 1 : -1))[0]
      ?.liquidityRaw ?? 0n;
  const concentration = total === 0n ? 0n : (top * 10_000n) / total;
  const warnings: string[] = [];
  const findings: string[] = [];
  if (!input.verifiedProtocol) {
    warnings.push('Protocol is not verified');
    findings.push('UNKNOWN_PROTOCOL');
  }
  if (!input.ownership.verified || input.ownership.kind === 'unknown') {
    warnings.push('LP ownership and lock conditions are not verified');
    findings.push('LIQUIDITY_NOT_VERIFIABLY_LOCKED');
  }
  if (input.ownership.kind === 'creator') findings.push('REMOVABLE_CREATOR_LIQUIDITY');
  if (input.removalsRaw > input.currentLiquidityRaw / 2n) findings.push('ABRUPT_LIQUIDITY_REMOVAL');
  if (input.providers.length === 1) findings.push('SINGLE_POOL_DEPENDENCY');
  if (
    input.expectedMigrationDestination !== undefined &&
    input.migrationDestination !== input.expectedMigrationDestination
  )
    findings.push('UNEXPECTED_MIGRATION_VENUE');
  return {
    ...input,
    providerConcentrationBps: concentration,
    status:
      !input.verifiedProtocol || !input.ownership.verified
        ? 'unknown'
        : findings.length > 0
          ? 'warning'
          : 'verified',
    warnings,
    findings,
  };
}
