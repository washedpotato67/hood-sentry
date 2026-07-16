export type Tier = 'free' | 'scout' | 'analyst' | 'sentinel';
export type GateConfig = {
  tokenAddress: `0x${string}`;
  chainId: number;
  enabled: boolean;
  minimums: Readonly<Record<Tier, bigint>>;
  cacheSeconds: number;
  minimumHoldingSeconds: number;
  version: string;
};
export type Entitlement = {
  wallet: `0x${string}`;
  tier: Tier;
  balance: bigint;
  observedBlock: bigint;
  expiresAt: number;
  version: string;
};
export type EntitlementState = {
  grantedTier: Tier;
  candidateTier: Tier | null;
  candidateSince: number | null;
};
export function calculateTier(balance: bigint, c: GateConfig): Tier {
  if (balance >= c.minimums.sentinel) return 'sentinel';
  if (balance >= c.minimums.analyst) return 'analyst';
  if (balance >= c.minimums.scout) return 'scout';
  return 'free';
}
export function reconcileEntitlement(
  wallet: `0x${string}`,
  balance: bigint,
  block: bigint,
  c: GateConfig,
  now: number,
): Entitlement {
  if (!c.enabled)
    return {
      wallet,
      tier: 'free',
      balance,
      observedBlock: block,
      expiresAt: now,
      version: c.version,
    };
  return {
    wallet,
    tier: calculateTier(balance, c),
    balance,
    observedBlock: block,
    expiresAt: now + c.cacheSeconds * 1000,
    version: c.version,
  };
}

const tierRank: Readonly<Record<Tier, number>> = {
  free: 0,
  scout: 1,
  analyst: 2,
  sentinel: 3,
};

export function advanceEntitlementState(input: {
  current: EntitlementState | null;
  eligibleTier: Tier;
  observedAt: number;
  minimumHoldingSeconds: number;
  resetCandidate: boolean;
}): EntitlementState {
  const current = input.current ?? {
    grantedTier: 'free' as const,
    candidateTier: null,
    candidateSince: null,
  };
  if (tierRank[input.eligibleTier] < tierRank[current.grantedTier]) {
    return { grantedTier: input.eligibleTier, candidateTier: null, candidateSince: null };
  }
  if (input.eligibleTier === current.grantedTier) {
    return { grantedTier: current.grantedTier, candidateTier: null, candidateSince: null };
  }
  const candidateChanged = current.candidateTier !== input.eligibleTier || input.resetCandidate;
  const candidateSince = candidateChanged
    ? input.observedAt
    : (current.candidateSince ?? input.observedAt);
  if (input.observedAt - candidateSince >= input.minimumHoldingSeconds * 1_000) {
    return { grantedTier: input.eligibleTier, candidateTier: null, candidateSince: null };
  }
  return { grantedTier: current.grantedTier, candidateTier: input.eligibleTier, candidateSince };
}
