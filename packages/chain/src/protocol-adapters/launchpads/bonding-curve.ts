import type { Address } from 'viem';
import type { LaunchpadTokenState, LaunchpadTrade, RawChainLog } from '../types.js';

export interface BondingCurveAdapter {
  decodeBondingCurveTrade(log: RawChainLog): Promise<LaunchpadTrade | null>;
  readLaunchState(tokenAddress: Address, blockNumber?: bigint): Promise<LaunchpadTokenState>;
}

export type { LaunchpadTrade, LaunchpadTokenState } from '../types.js';
