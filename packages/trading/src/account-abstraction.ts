export type SponsorshipPolicy = {
  enabled: boolean;
  chainId: number;
  senders: readonly `0x${string}`[];
  targets: readonly `0x${string}`[];
  selectors: readonly `0x${string}`[];
  maxAmount: bigint;
  maxGas: bigint;
  dailyBudget: bigint;
  globalBudget: bigint;
  featureFlag: string;
};
export type UserOperation = {
  sender: `0x${string}`;
  target: `0x${string}`;
  selector: `0x${string}`;
  callData: string;
  value: bigint;
  gas: bigint;
  nonce: bigint;
};
export function authorizeSponsorship(
  op: UserOperation,
  p: SponsorshipPolicy,
  spentToday: bigint,
  spentGlobal: bigint,
) {
  if (
    !p.enabled ||
    !p.senders.includes(op.sender) ||
    !p.targets.includes(op.target) ||
    !p.selectors.includes(op.selector) ||
    op.value > p.maxAmount ||
    op.gas > p.maxGas ||
    spentToday + op.value > p.dailyBudget ||
    spentGlobal + op.value > p.globalBudget
  )
    throw new Error('Sponsorship denied');
  return true;
}
