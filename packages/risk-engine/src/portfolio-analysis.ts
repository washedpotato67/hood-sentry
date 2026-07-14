export type PortfolioAsset = {
  address: `0x${string}`;
  symbol?: string;
  rawBalance: bigint;
  decimals: number;
  priceRaw: bigint | null;
  priceDecimals: number;
  exact: boolean;
  stale: boolean;
  criticalRisk: boolean;
  spam?: boolean;
  multiplier?: bigint;
};
export type PortfolioResult = {
  assets: readonly PortfolioAsset[];
  exactValueRaw: bigint;
  estimatedValueRaw: bigint;
  unknownAssets: readonly `0x${string}`[];
  risk: Readonly<Record<string, bigint>>;
};
export function analyzePortfolio(assets: readonly PortfolioAsset[]): PortfolioResult {
  const ordered = [...assets].sort((a, b) => a.address.localeCompare(b.address));
  let exact = 0n;
  let estimated = 0n;
  const unknown: `0x${string}`[] = [];
  const risk = { critical: 0n, stale: 0n, spam: 0n };
  for (const asset of ordered) {
    if (asset.priceRaw === null) unknown.push(asset.address);
    else {
      const amount = asset.rawBalance * (asset.multiplier ?? 1n);
      const value = (amount * asset.priceRaw) / 10n ** BigInt(asset.decimals);
      if (asset.exact && !asset.stale) exact += value;
      estimated += value;
    }
    if (asset.criticalRisk) risk.critical += 1n;
    if (asset.stale) risk.stale += 1n;
    if (asset.spam) risk.spam += 1n;
  }
  return {
    assets: ordered,
    exactValueRaw: exact,
    estimatedValueRaw: estimated,
    unknownAssets: unknown,
    risk,
  };
}
