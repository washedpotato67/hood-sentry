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
