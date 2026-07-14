import type { Address } from 'viem';
import { getAddress, isAddress, zeroAddress } from 'viem';
import { UnverifiedProtocolContractError } from '../errors.js';
import type { DecodedProtocolEvent, NormalizedPool, NormalizedPoolState } from '../types.js';

export interface FactoryEventDiscovery {
  discoverPool(event: DecodedProtocolEvent): Promise<NormalizedPool | null>;
}

export interface PoolMetadataReader {
  readPoolMetadata(poolAddress: Address, blockNumber?: bigint): Promise<NormalizedPool>;
}

export interface PoolStateReader {
  readPoolState(poolAddress: Address, blockNumber?: bigint): Promise<NormalizedPoolState>;
}

export function validateDiscoveredAddress(value: unknown, name: string): Address {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new UnverifiedProtocolContractError(`${name} is not a valid EVM address`);
  }
  const address = getAddress(value);
  if (address.toLowerCase() === zeroAddress) {
    throw new UnverifiedProtocolContractError(`${name} uses the zero address`);
  }
  return address;
}
