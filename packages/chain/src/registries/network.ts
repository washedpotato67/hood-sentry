import type { NetworkConfig } from '../types.js';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from '../types.js';

export const networkRegistry: ReadonlyArray<NetworkConfig> = [
  {
    chainId: MAINNET_CHAIN_ID,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    publicRpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    explorerUrl: 'https://robinhoodchain.blockscout.com',
    explorerApiUrl: 'https://robinhoodchain.blockscout.com/api',
    isTestnet: false,
  },
  {
    chainId: TESTNET_CHAIN_ID,
    name: 'Robinhood Chain Testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    publicRpcUrl: 'https://rpc.testnet.chain.robinhood.com',
    explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
    isTestnet: true,
  },
] as const;

export function getNetworkConfig(chainId: number): NetworkConfig | undefined {
  return networkRegistry.find((n) => n.chainId === chainId);
}

export function getMainnetConfig(): NetworkConfig {
  const config = networkRegistry.find((n) => n.chainId === MAINNET_CHAIN_ID);
  if (!config) throw new Error('Mainnet configuration not found');
  return config;
}

export function getTestnetConfig(): NetworkConfig {
  const config = networkRegistry.find((n) => n.chainId === TESTNET_CHAIN_ID);
  if (!config) throw new Error('Testnet configuration not found');
  return config;
}
