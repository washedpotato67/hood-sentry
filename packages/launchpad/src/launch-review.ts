import type { Hex } from 'viem';
export type LaunchManifest = {
  chainId: number;
  launchpad: string;
  factory: `0x${string}`;
  version: string;
  creatorWallet: `0x${string}`;
  treasurySafe: `0x${string}`;
  metadata: string;
  functionName: string;
  selector: `0x${string}`;
  value: bigint;
  fees: bigint;
  supply: bigint;
  destinationVenue: string;
  sources: readonly string[];
  timestamp: string;
};
export type LaunchReviewProvider = {
  targetAllowed: (target: `0x${string}`, chainId: number) => boolean;
  selectorAllowed: (target: `0x${string}`, selector: `0x${string}`) => boolean;
  simulate: (tx: { target: `0x${string}`; data: Hex; value: bigint }) => Promise<boolean>;
};
export async function reviewLaunchTransaction(
  p: LaunchReviewProvider,
  tx: { chainId: number; target: `0x${string}`; data: Hex; value: bigint },
  manifest: LaunchManifest,
) {
  if (
    tx.chainId !== manifest.chainId ||
    tx.target.toLowerCase() !== manifest.factory.toLowerCase() ||
    !p.targetAllowed(tx.target, tx.chainId) ||
    tx.data.slice(0, 10).toLowerCase() !== manifest.selector.toLowerCase() ||
    !p.selectorAllowed(tx.target, manifest.selector) ||
    tx.value !== manifest.value
  )
    throw new Error('Launch transaction does not match manifest');
  if (!(await p.simulate(tx))) throw new Error('Launch simulation failed');
  return {
    approved: false,
    simulated: true,
    warnings: ['Review only. Mainnet broadcast is disabled'],
  };
}
