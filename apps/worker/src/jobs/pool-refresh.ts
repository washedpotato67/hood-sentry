import {
  type DexAdapter,
  type NormalizedPoolState,
  type ProtocolAdapter,
  type ProtocolAdapterManager,
  checksumAddress,
} from '@hood-sentry/chain';
import type { ProtocolRepository } from '@hood-sentry/db';

export interface PoolRefreshJobData {
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
  poolAddress: string;
  blockNumber: bigint;
}

export class PoolRefreshJob {
  constructor(
    private readonly manager: ProtocolAdapterManager,
    private readonly repository: Pick<ProtocolRepository, 'updatePoolState'>,
  ) {}

  async run(data: PoolRefreshJobData): Promise<{
    state: NormalizedPoolState;
    idempotencyKey: string;
  }> {
    const adapter = this.manager.getAdapter(data.protocolKey, data.protocolVersion, data.chainId);
    if (!isDexAdapter(adapter)) throw new Error('Pool refresh requires a DEX adapter');
    const dexAdapter = adapter;
    const poolAddress = checksumAddress(data.poolAddress);
    const state = await dexAdapter.readPoolState(poolAddress, data.blockNumber);
    await this.repository.updatePoolState(data.chainId, poolAddress, state, data.blockNumber);
    return {
      state,
      idempotencyKey: `${data.chainId}:${poolAddress.toLowerCase()}:${data.blockNumber.toString()}`,
    };
  }
}

function isDexAdapter(adapter: ProtocolAdapter): adapter is DexAdapter {
  return adapter.kind === 'dex' && 'readPoolState' in adapter;
}
