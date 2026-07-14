import { getNetworkConfig } from './registries/network.js';
import { type SupportedChainId, isSupportedChainId } from './types.js';

export interface RpcSelectionOptions {
  chainId: SupportedChainId;
  managedRpcUrl?: string;
  managedWsUrl?: string;
  preferManaged?: boolean;
}

export function selectRpcUrl(options: RpcSelectionOptions): string {
  if (!isSupportedChainId(options.chainId)) {
    throw new Error(`Unsupported chain ID: ${options.chainId}`);
  }

  const config = getNetworkConfig(options.chainId);
  if (!config) {
    throw new Error(`No network configuration found for chain ID ${options.chainId}`);
  }

  if (options.preferManaged && options.managedRpcUrl) {
    return options.managedRpcUrl;
  }

  if (options.managedRpcUrl) {
    return options.managedRpcUrl;
  }

  return config.publicRpcUrl;
}

export function selectWsUrl(options: RpcSelectionOptions): string | undefined {
  if (!isSupportedChainId(options.chainId)) {
    throw new Error(`Unsupported chain ID: ${options.chainId}`);
  }

  const config = getNetworkConfig(options.chainId);
  if (!config) {
    throw new Error(`No network configuration found for chain ID ${options.chainId}`);
  }

  if (options.preferManaged && options.managedWsUrl) {
    return options.managedWsUrl;
  }

  if (options.managedWsUrl) {
    return options.managedWsUrl;
  }

  return config.publicWsUrl;
}

export function isPublicRpc(url: string): boolean {
  const publicPatterns = ['rpc.mainnet.chain.robinhood.com', 'rpc.testnet.chain.robinhood.com'];
  try {
    const parsed = new URL(url);
    return publicPatterns.some((pattern) => parsed.hostname.includes(pattern));
  } catch {
    return false;
  }
}
