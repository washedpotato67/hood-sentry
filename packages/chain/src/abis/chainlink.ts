import type { Abi } from 'viem';

/**
 * Minimal Chainlink AggregatorV3Interface ABI for reading price feed rounds.
 * Source: https://docs.chain.link/data-feeds/using-data-feeds
 */
export const aggregatorV3InterfaceAbi: Abi = [
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAnswer',
    inputs: [{ name: 'roundId', type: 'uint256' }],
    outputs: [{ name: '', type: 'int256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'paused',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

/**
 * Minimal Chainlink sequencer uptime feed ABI. The uptime feed returns a 0 when
 * the sequencer is up and a 1 when it is down. `startedAt` is the timestamp the
 * sequencer recovered (relevant during the grace period).
 */
export const sequencerUptimeFeedAbi: Abi = [
  {
    type: 'function',
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
] as const;
