import { getNetworkConfig } from './registries/network.js';
import { type SupportedChainId, isSupportedChainId } from './types.js';

function getExplorerBase(chainId: number): string {
  const config = getNetworkConfig(chainId);
  if (!config) {
    throw new Error(`No network configuration found for chain ID ${chainId}`);
  }
  return config.explorerUrl.replace(/\/$/, '');
}

export function buildTransactionUrl(chainId: number, txHash: string): string {
  if (!isSupportedChainId(chainId)) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new Error(`Invalid transaction hash: ${txHash}`);
  }
  return `${getExplorerBase(chainId)}/tx/${txHash}`;
}

export function buildAddressUrl(chainId: number, address: string): string {
  if (!isSupportedChainId(chainId)) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`Invalid address: ${address}`);
  }
  return `${getExplorerBase(chainId)}/address/${address}`;
}

export function buildBlockUrl(chainId: number, blockNumberOrHash: number | string): string {
  if (!isSupportedChainId(chainId)) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  const segment =
    typeof blockNumberOrHash === 'number'
      ? `block/${blockNumberOrHash}`
      : `block/${blockNumberOrHash}`;
  return `${getExplorerBase(chainId)}/${segment}`;
}

export function buildTokenUrl(chainId: number, tokenAddress: string): string {
  if (!isSupportedChainId(chainId)) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
    throw new Error(`Invalid token address: ${tokenAddress}`);
  }
  return `${getExplorerBase(chainId)}/token/${tokenAddress}`;
}

export function getExplorerApiUrl(chainId: SupportedChainId): string | undefined {
  const config = getNetworkConfig(chainId);
  return config?.explorerApiUrl;
}
