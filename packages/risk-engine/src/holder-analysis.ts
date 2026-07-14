import type { ConcentrationAlert, HolderAnalysisInput, HolderSnapshot } from './holder-types.js';

const classes = [
  'zero_burn',
  'pool',
  'bridge',
  'treasury',
  'exchange',
  'deployer',
  'team',
  'contract',
  'launchpad',
  'bonding_curve',
  'unknown',
] as const;
function concentrations(values: readonly bigint[]): {
  top1: bigint;
  top5: bigint;
  top10: bigint;
  top20: bigint;
} {
  const positive = values.filter((v) => v > 0n).sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));
  const total = positive.reduce((a, b) => a + b, 0n);
  const share = (n: number) =>
    total === 0n ? 0n : (positive.slice(0, n).reduce((a, b) => a + b, 0n) * 10_000n) / total;
  return { top1: share(1), top5: share(5), top10: share(10), top20: share(20) };
}
function gini(values: readonly bigint[]): bigint | null {
  const sorted = values.filter((v) => v > 0n).sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
  const total = sorted.reduce((a, b) => a + b, 0n);
  const n = BigInt(sorted.length);
  if (total === 0n || n === 0n) return null;
  const weighted = sorted.reduce((sum, value, i) => sum + BigInt(i + 1) * value, 0n);
  return ((2n * weighted - (n + 1n) * total) * 10_000n) / (n * total);
}
export function analyzeHolders(input: HolderAnalysisInput): HolderSnapshot {
  const byAddress = new Map((input.classifications ?? []).map((c) => [c.address.toLowerCase(), c]));
  const valid = input.balances.filter((b) => b.balanceRaw > 0n);
  const exclusions = [...byAddress.values()].filter(
    (c) => c.verified && c.addressClass !== 'unknown',
  );
  const excluded = new Set(exclusions.map((c) => c.address.toLowerCase()));
  const adjusted = valid
    .filter((b) => !excluded.has(b.address.toLowerCase()))
    .map((b) => b.balanceRaw);
  const allocations = Object.fromEntries(classes.map((c) => [c, 0n])) as Record<
    (typeof classes)[number],
    bigint
  >;
  for (const balance of valid)
    allocations[byAddress.get(balance.address.toLowerCase())?.addressClass ?? 'unknown'] +=
      balance.balanceRaw;
  const excludedTotal = valid
    .filter((b) => excluded.has(b.address.toLowerCase()))
    .reduce((a, b) => a + b.balanceRaw, 0n);
  const warnings = [
    ...(input.incompleteHistory ? ['Holder history is incomplete'] : []),
    ...(input.rebaseState === 'uncertain' ? ['Rebase state is uncertain'] : []),
  ];
  return {
    chainId: input.chainId,
    tokenAddress: input.tokenAddress,
    sourceBlock: input.sourceBlock,
    sourceBlockHash: input.sourceBlockHash,
    methodologyVersion: input.methodologyVersion,
    holderCount: valid.length,
    totalSupplyRaw: input.totalSupplyRaw,
    circulatingSupplyRaw:
      input.totalSupplyRaw === null || input.rebaseState === 'uncertain'
        ? null
        : input.totalSupplyRaw - excludedTotal,
    rawConcentrationBps: concentrations(valid.map((b) => b.balanceRaw)),
    adjustedConcentrationBps: concentrations(adjusted),
    giniScaled: gini(valid.map((b) => b.balanceRaw)),
    allocations,
    exclusions,
    warnings,
  };
}
export function concentrationChange(
  previous: HolderSnapshot,
  current: HolderSnapshot,
  thresholdBps: bigint,
): ConcentrationAlert | null {
  const change = current.rawConcentrationBps.top1 - previous.rawConcentrationBps.top1;
  return change >= thresholdBps
    ? {
        kind: 'concentration_change',
        previousTop10Bps: previous.rawConcentrationBps.top1,
        currentTop10Bps: current.rawConcentrationBps.top1,
        changeBps: change,
        sourceBlock: current.sourceBlock,
      }
    : null;
}
