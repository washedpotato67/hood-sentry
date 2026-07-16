import {
  type DexAdapter,
  type NormalizedPoolState,
  type ProtocolAdapter,
  type ProtocolAdapterManager,
  checksumAddress,
} from '@hood-sentry/chain';
import type { ProtocolRepository } from '@hood-sentry/db';
import type { Hash } from 'viem';

export interface PoolRefreshJobData {
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
  poolAddress: string;
  blockNumber: bigint;
  blockHash: Hash;
}

export class PoolRefreshJob {
  constructor(
    private readonly manager: ProtocolAdapterManager,
    private readonly repository: Pick<ProtocolRepository, 'getPool' | 'updatePoolState'>,
  ) {}

  async run(data: PoolRefreshJobData): Promise<{
    state: NormalizedPoolState;
    idempotencyKey: string;
  }> {
    const poolAddress = checksumAddress(data.poolAddress);
    const pool = await this.repository.getPool(data.chainId, poolAddress, data.blockNumber);
    if (pool === null) throw new Error('Pool refresh target is not indexed');
    if (pool.protocolKey !== data.protocolKey || pool.protocolVersion !== data.protocolVersion) {
      throw new Error('Pool refresh protocol identity does not match the indexed pool');
    }
    this.manager.registerPool(pool);
    const adapter = this.manager.getAdapter(data.protocolKey, data.protocolVersion, data.chainId);
    if (!isDexAdapter(adapter)) throw new Error('Pool refresh requires a DEX adapter');
    const dexAdapter = adapter;
    const state = await dexAdapter.readPoolState(poolAddress, data.blockNumber);
    await this.repository.updatePoolState(
      data.chainId,
      poolAddress,
      state,
      data.blockNumber,
      data.blockHash,
    );
    return {
      state,
      idempotencyKey: `${data.chainId}:${poolAddress.toLowerCase()}:${data.blockNumber.toString()}`,
    };
  }
}

function isDexAdapter(adapter: ProtocolAdapter): adapter is DexAdapter {
  return adapter.kind === 'dex' && 'readPoolState' in adapter;
}
