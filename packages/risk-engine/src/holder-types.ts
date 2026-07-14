export type HolderAddressClass =
  | 'zero_burn'
  | 'pool'
  | 'bridge'
  | 'treasury'
  | 'exchange'
  | 'deployer'
  | 'team'
  | 'contract'
  | 'launchpad'
  | 'bonding_curve'
  | 'unknown';

export type HolderBalance = { address: `0x${string}`; balanceRaw: bigint };
export type HolderClassification = {
  address: `0x${string}`;
  addressClass: HolderAddressClass;
  verified: boolean;
  reason: string;
  provenance: string;
};
export type HolderAnalysisInput = {
  chainId: number;
  tokenAddress: `0x${string}`;
  sourceBlock: bigint;
  sourceBlockHash: `0x${string}`;
  totalSupplyRaw: bigint | null;
  balances: readonly HolderBalance[];
  classifications?: readonly HolderClassification[];
  methodologyVersion: string;
  rebaseState?: 'known' | 'uncertain' | 'not_applicable';
  incompleteHistory?: boolean;
};
export type HolderSnapshot = {
  chainId: number;
  tokenAddress: `0x${string}`;
  sourceBlock: bigint;
  sourceBlockHash: `0x${string}`;
  methodologyVersion: string;
  holderCount: number;
  totalSupplyRaw: bigint | null;
  circulatingSupplyRaw: bigint | null;
  rawConcentrationBps: { top1: bigint; top5: bigint; top10: bigint; top20: bigint };
  adjustedConcentrationBps: { top1: bigint; top5: bigint; top10: bigint; top20: bigint };
  giniScaled: bigint | null;
  allocations: Readonly<Record<HolderAddressClass, bigint>>;
  exclusions: readonly HolderClassification[];
  warnings: readonly string[];
};
export type ConcentrationAlert = {
  kind: 'concentration_change';
  previousTop10Bps: bigint;
  currentTop10Bps: bigint;
  changeBps: bigint;
  sourceBlock: bigint;
};
