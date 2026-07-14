import type {
  LaunchpadGraduation,
  LaunchpadMigration,
  LaunchpadTokenCreated,
  LaunchpadTrade,
} from '@hood-sentry/chain';
import type { DerivedJob } from '../types.js';

type LaunchpadEvent =
  | LaunchpadTokenCreated
  | LaunchpadTrade
  | LaunchpadGraduation
  | LaunchpadMigration;

export function launchpadDerivedJobs(event: LaunchpadEvent): readonly DerivedJob[] {
  const shared = {
    chainId: BigInt(event.chainId),
    blockNumber: event.blockNumber,
    blockHash: event.blockHash,
  };
  const data = {
    protocolKey: event.protocolKey,
    protocolVersion: event.protocolVersion,
    tokenAddress: event.tokenAddress,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
  };
  if ('initialSupplyRaw' in event) {
    return [
      { type: 'token-metadata', ...shared, data },
      { type: 'protocol-enrichment', ...shared, data },
      { type: 'risk-analysis', ...shared, data },
    ];
  }
  return [
    { type: 'market-metric', ...shared, data },
    { type: 'wallet-activity', ...shared, data },
    { type: 'alert-evaluation', ...shared, data },
  ];
}
