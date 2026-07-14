import { defineChain } from 'viem';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from './types.js';

export const robinhoodMainnet = defineChain({
  id: MAINNET_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
});

export const robinhoodTestnet = defineChain({
  id: TESTNET_CHAIN_ID,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://explorer.testnet.chain.robinhood.com' },
  },
  testnet: true,
});

export function getChainDefinition(chainId: number) {
  if (chainId === MAINNET_CHAIN_ID) return robinhoodMainnet;
  if (chainId === TESTNET_CHAIN_ID) return robinhoodTestnet;
  throw new Error(`Unsupported chain ID: ${chainId}`);
}
