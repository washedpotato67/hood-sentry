import {
  http,
  type Chain,
  type PublicClient,
  type Transport,
  createPublicClient,
  fallback,
} from 'viem';
import { getChainDefinition } from './chains.js';
import { selectRpcUrl, selectWsUrl } from './rpc.js';
import { type SupportedChainId, isSupportedChainId } from './types.js';

export interface ChainClientOptions {
  chainId: SupportedChainId;
  managedRpcUrl?: string;
  secondaryRpcUrl?: string;
  managedWsUrl?: string;
  preferManaged?: boolean;
}

export function createChainClient(options: ChainClientOptions): PublicClient<Transport, Chain> {
  if (!isSupportedChainId(options.chainId)) {
    throw new Error(`Unsupported chain ID: ${options.chainId}`);
  }

  const chain = getChainDefinition(options.chainId);
  const primaryUrl = selectRpcUrl({
    chainId: options.chainId,
    managedRpcUrl: options.managedRpcUrl,
    preferManaged: options.preferManaged,
  });

  const urls = [primaryUrl];
  if (options.secondaryRpcUrl) {
    urls.push(options.secondaryRpcUrl);
  }

  const transport = urls.length > 1 ? fallback(urls.map((url) => http(url))) : http(primaryUrl);

  return createPublicClient({
    chain,
    transport,
  });
}

export function createWebSocketClient(
  options: ChainClientOptions,
): PublicClient<Transport, Chain> | null {
  if (!isSupportedChainId(options.chainId)) {
    throw new Error(`Unsupported chain ID: ${options.chainId}`);
  }

  const wsUrl = selectWsUrl({
    chainId: options.chainId,
    managedWsUrl: options.managedWsUrl,
    preferManaged: options.preferManaged,
  });

  if (!wsUrl) {
    return null;
  }

  const chain = getChainDefinition(options.chainId);

  return createPublicClient({
    chain,
    transport: http(wsUrl),
  });
}
