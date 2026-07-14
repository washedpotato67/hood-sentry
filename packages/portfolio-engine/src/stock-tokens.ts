export type CanonicalAsset = {
  address: `0x${string}`;
  chainId: number;
  category: 'stock' | 'etf';
  underlyingTicker: string;
  source: string;
};
export type StockTokenObservation = CanonicalAsset & {
  rawBalance: bigint;
  decimals: number;
  uiMultiplier: bigint;
  multiplierDecimals: number;
  pendingMultiplier?: bigint;
  pendingEffectiveAt?: string;
  priceRaw: bigint | null;
  priceDecimals: number;
  oracleStatus: string;
  sourceBlock: bigint;
};
export function adjustedBalance(o: StockTokenObservation): bigint {
  return o.rawBalance * o.uiMultiplier;
}
export function validateCanonical(
  o: StockTokenObservation,
  registry: readonly CanonicalAsset[],
): void {
  if (
    !registry.some(
      (a) => a.address.toLowerCase() === o.address.toLowerCase() && a.chainId === o.chainId,
    )
  )
    throw new Error('Asset is not canonical');
  if (o.uiMultiplier < 0n) throw new Error('Invalid multiplier');
}
