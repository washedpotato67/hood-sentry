import type { PublicClient } from 'viem';
import { MAINNET_CHAIN_ID, type SupportedChainId, isSupportedChainId } from './types.js';

export class ChainMismatchError extends Error {
  constructor(
    public readonly expectedChainId: number,
    public readonly actualChainId: number,
  ) {
    super(`Chain ID mismatch: expected ${expectedChainId}, got ${actualChainId}`);
    this.name = 'ChainMismatchError';
  }
}

export class UnsupportedChainError extends Error {
  constructor(public readonly chainId: number) {
    super(`Unsupported chain ID: ${chainId}. Supported: 4663 (mainnet), 46630 (testnet)`);
    this.name = 'UnsupportedChainError';
  }
}

export class MainnetWriteError extends Error {
  constructor(operation: string) {
    super(
      `Mainnet write operation "${operation}" is blocked. MAINNET_WRITES_ENABLED must be true to perform writes on mainnet.`,
    );
    this.name = 'MainnetWriteError';
  }
}

export function assertSupportedChain(chainId: number): asserts chainId is SupportedChainId {
  if (!isSupportedChainId(chainId)) {
    throw new UnsupportedChainError(chainId);
  }
}

export async function validateChainId(
  client: PublicClient,
  expectedChainId: SupportedChainId,
): Promise<void> {
  const actualChainId = await client.getChainId();
  if (actualChainId !== expectedChainId) {
    throw new ChainMismatchError(expectedChainId, actualChainId);
  }
}

export function assertMainnetWriteAllowed(
  chainId: SupportedChainId,
  operation: string,
  mainnetWritesEnabled: boolean,
): void {
  if (chainId === MAINNET_CHAIN_ID && !mainnetWritesEnabled) {
    throw new MainnetWriteError(operation);
  }
}

export async function verifyBytecode(
  client: PublicClient,
  address: `0x${string}`,
  expectedHash: string,
): Promise<boolean> {
  if (!expectedHash) {
    return true;
  }

  const bytecode = await client.getBytecode({ address });
  if (!bytecode) {
    return false;
  }

  const { keccak256 } = await import('viem');
  const actualHash = keccak256(bytecode);
  return actualHash === expectedHash;
}

export function guardWriteOperation(
  chainId: SupportedChainId,
  operation: string,
  mainnetWritesEnabled: boolean,
): void {
  assertSupportedChain(chainId);
  assertMainnetWriteAllowed(chainId, operation, mainnetWritesEnabled);
}
