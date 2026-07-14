export type FlowKind =
  | 'buy'
  | 'sell'
  | 'transfer_in'
  | 'transfer_out'
  | 'user_transfer'
  | 'bridge_deposit'
  | 'bridge_withdrawal'
  | 'mint'
  | 'burn'
  | 'airdrop'
  | 'fee'
  | 'launchpad_buy'
  | 'launchpad_sell'
  | 'migration'
  | 'unknown';
export type CostLot = {
  id: string;
  acquisitionTransaction: string;
  amount: bigint;
  costRaw: bigint | null;
  costCurrency: string;
  normalizedValueRaw: bigint | null;
  source: string;
  confidence: 'high' | 'medium' | 'low';
  remainingAmount: bigint;
};
export type CostFlow = {
  kind: FlowKind;
  transaction: string;
  amount: bigint;
  priceRaw: bigint | null;
  feeRaw?: bigint;
  source: string;
  userOwnedTransfer?: boolean;
  confidence: 'high' | 'medium' | 'low';
};
export type CostBasisResult = {
  lots: readonly CostLot[];
  realizedPnlRaw: bigint | null;
  unrealizedPnlRaw: bigint | null;
  costBasisRaw: bigint | null;
  proceedsRaw: bigint | null;
  feesRaw: bigint;
  averageEntryRaw: bigint | null;
  confidence: 'high' | 'medium' | 'low';
  incompleteHistory: boolean;
  warnings: readonly string[];
};
export function fifoCostBasis(
  flows: readonly CostFlow[],
  currentPriceRaw: bigint | null,
  tokenDecimals: number,
  gasFeesIncluded = false,
): CostBasisResult {
  void tokenDecimals;
  const lots: CostLot[] = [];
  let realized: bigint | null = 0n;
  let proceeds: bigint | null = 0n;
  let fees = 0n;
  const warnings: string[] = [];
  for (const f of flows) {
    if (f.feeRaw !== undefined && gasFeesIncluded) fees += f.feeRaw;
    if (
      ['buy', 'launchpad_buy', 'mint', 'airdrop', 'bridge_deposit', 'migration'].includes(f.kind)
    ) {
      lots.push({
        id: `${f.transaction}:${lots.length}`,
        acquisitionTransaction: f.transaction,
        amount: f.amount,
        costRaw: f.priceRaw === null ? null : f.amount * f.priceRaw,
        costCurrency: 'quote',
        normalizedValueRaw: f.priceRaw === null ? null : f.amount * f.priceRaw,
        source: f.source,
        confidence: f.confidence,
        remainingAmount: f.amount,
      });
    } else if (
      ['sell', 'launchpad_sell', 'burn', 'transfer_out'].includes(f.kind) &&
      !f.userOwnedTransfer
    ) {
      let remaining = f.amount;
      let cost = 0n;
      while (remaining > 0n && lots.length) {
        const lot = lots[0];
        if (lot === undefined) break;
        const used = remaining < lot.remainingAmount ? remaining : lot.remainingAmount;
        if (lot.costRaw === null) {
          realized = null;
          warnings.push('Missing acquisition price');
        } else cost += (lot.costRaw * used) / lot.amount;
        lot.remainingAmount -= used;
        remaining -= used;
        if (lot.remainingAmount === 0n) lots.shift();
      }
      if (remaining > 0n) {
        realized = null;
        warnings.push('Incomplete history');
      }
      if (f.priceRaw === null) {
        realized = null;
        warnings.push('Missing sale price');
      } else {
        const p = f.amount * f.priceRaw;
        proceeds = (proceeds ?? 0n) + p;
        if (realized !== null) realized += p - cost;
      }
    }
  }
  const basis = lots.reduce(
    (s, l) => s + (l.costRaw === null ? 0n : (l.costRaw * l.remainingAmount) / l.amount),
    0n,
  );
  const unrealized =
    currentPriceRaw === null
      ? null
      : lots.reduce(
          (s, l) =>
            s +
            (currentPriceRaw * l.remainingAmount -
              ((l.costRaw ?? 0n) * l.remainingAmount) / l.amount),
          0n,
        );
  if (currentPriceRaw === null && lots.length) warnings.push('Missing current price');
  return {
    lots,
    realizedPnlRaw: realized,
    unrealizedPnlRaw: unrealized,
    costBasisRaw: basis,
    proceedsRaw: proceeds,
    feesRaw: fees,
    averageEntryRaw: lots.length ? basis / lots.reduce((s, l) => s + l.remainingAmount, 0n) : null,
    confidence: flows.some((f) => f.confidence === 'low')
      ? 'low'
      : flows.some((f) => f.confidence === 'medium')
        ? 'medium'
        : 'high',
    incompleteHistory: warnings.some((w) => w.includes('Incomplete') || w.includes('Missing')),
    warnings,
  };
}
