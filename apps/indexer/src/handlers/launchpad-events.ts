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
  if ('destinationPoolAddress' in event) {
    const migrationData = {
      ...data,
      destinationProtocolKey: event.destinationProtocolKey,
      destinationPoolAddress: event.destinationPoolAddress,
      poolAddress: event.destinationPoolAddress,
      eventType: 'launchpadMigration',
    };
    return [
      { type: 'bonding-curve-migration-transition', ...shared, data: migrationData },
      { type: 'source-reconciliation', ...shared, data: migrationData },
      { type: 'market-metric', ...shared, data: migrationData },
      { type: 'alert-evaluation', ...shared, data: migrationData },
    ];
  }
  const tradeData = { ...data, eventType: 'launchpadTrade' };
  return [{ type: 'alert-evaluation', ...shared, data: tradeData }];
}
