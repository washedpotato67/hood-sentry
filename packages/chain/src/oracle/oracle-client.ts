import {
  type Address,
  type Hex,
  decodeFunctionResult,
  encodeFunctionData,
  hexToNumber,
} from 'viem';
import { aggregatorV3InterfaceAbi, sequencerUptimeFeedAbi } from '../abis/chainlink.js';
import type { RPCClient } from '../rpc/index.js';
import { ContractRevertError, ProviderUnavailableError } from '../rpc/index.js';

export interface ChainlinkRoundData {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}

export interface ChainlinkPriceReadResult {
  answer: bigint;
  decimals: number;
  roundId: bigint;
  answeredInRound: bigint;
  updatedAt: string;
}

export interface SequencerUptimeResult {
  up: boolean;
  recoveredAt: bigint | undefined;
}

export interface OracleClientConfig {
  rpcClient: RPCClient;
  chainId: number;
}

export function timestampStringFromBigInt(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString();
}

/**
 * Reads Chainlink price and sequencer uptime feeds through the shared RPC client.
 *
 * The client encodes/decodes calls directly so it does not need a deployed multicall
 * contract. All reads are deterministic `eth_call`s and can be pinned to a block number.
 */
export class OracleClient {
  constructor(private readonly config: OracleClientConfig) {}

  async readPriceFeed(
    feedAddress: Address,
    blockNumber?: bigint,
  ): Promise<ChainlinkPriceReadResult> {
    const [decimals, roundData] = await Promise.all([
      this.readDecimals(feedAddress, blockNumber),
      this.readLatestRoundData(feedAddress, blockNumber),
    ]);

    return {
      answer: roundData.answer,
      decimals,
      roundId: roundData.roundId,
      answeredInRound: roundData.answeredInRound,
      updatedAt: timestampStringFromBigInt(roundData.updatedAt),
    };
  }

  async readSequencerFeed(
    feedAddress: Address,
    blockNumber?: bigint,
  ): Promise<SequencerUptimeResult> {
    const roundData = await this.readSequencerRoundData(feedAddress, blockNumber);
    // Chainlink uptime feeds answer 0 when up, 1 when down.
    const up = roundData.answer === 0n;
    return {
      up,
      recoveredAt: up && roundData.startedAt > 0n ? roundData.startedAt : undefined,
    };
  }

  async readPaused(feedAddress: Address, blockNumber?: bigint): Promise<boolean> {
    const data = encodeFunctionData({
      abi: aggregatorV3InterfaceAbi,
      functionName: 'paused',
    });

    let returnData: Hex;
    try {
      returnData = await this.call(feedAddress, data, blockNumber, 'paused');
    } catch (error) {
      // Many Chainlink aggregators do not expose `paused()`. Treat a revert or
      // missing selector as "not paused" rather than failing the whole read.
      if (error instanceof ContractRevertError) return false;
      throw error;
    }

    try {
      return decodeFunctionResult({
        abi: aggregatorV3InterfaceAbi,
        functionName: 'paused',
        data: returnData,
      }) as boolean;
    } catch {
      return false;
    }
  }

  async getCode(address: Address, blockNumber?: bigint): Promise<Hex> {
    try {
      return await this.config.rpcClient.getCode(address, blockNumber);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw error;
      throw new ContractRevertError(
        this.config.rpcClient.getPrimaryProviderUrl(),
        `Failed to read code at ${address}`,
      );
    }
  }

  private async readDecimals(feedAddress: Address, blockNumber?: bigint): Promise<number> {
    const data = encodeFunctionData({
      abi: aggregatorV3InterfaceAbi,
      functionName: 'decimals',
    });
    const returnData = await this.call(feedAddress, data, blockNumber, 'decimals');
    try {
      return decodeFunctionResult({
        abi: aggregatorV3InterfaceAbi,
        functionName: 'decimals',
        data: returnData,
      }) as number;
    } catch {
      return hexToNumber(returnData);
    }
  }

  private async readLatestRoundData(
    feedAddress: Address,
    blockNumber?: bigint,
  ): Promise<ChainlinkRoundData> {
    const data = encodeFunctionData({
      abi: aggregatorV3InterfaceAbi,
      functionName: 'latestRoundData',
    });
    const returnData = await this.call(feedAddress, data, blockNumber, 'latestRoundData');
    const decoded = decodeFunctionResult({
      abi: aggregatorV3InterfaceAbi,
      functionName: 'latestRoundData',
      data: returnData,
    }) as [bigint, bigint, bigint, bigint, bigint];
    return {
      roundId: decoded[0],
      answer: decoded[1],
      startedAt: decoded[2],
      updatedAt: decoded[3],
      answeredInRound: decoded[4],
    };
  }

  private async readSequencerRoundData(
    feedAddress: Address,
    blockNumber?: bigint,
  ): Promise<ChainlinkRoundData> {
    const data = encodeFunctionData({
      abi: sequencerUptimeFeedAbi,
      functionName: 'latestRoundData',
    });
    const returnData = await this.call(feedAddress, data, blockNumber, 'sequencer_latestRoundData');
    const decoded = decodeFunctionResult({
      abi: sequencerUptimeFeedAbi,
      functionName: 'latestRoundData',
      data: returnData,
    }) as [bigint, bigint, bigint, bigint, bigint];
    return {
      roundId: decoded[0],
      answer: decoded[1],
      startedAt: decoded[2],
      updatedAt: decoded[3],
      answeredInRound: decoded[4],
    };
  }

  private async call(
    to: Address,
    data: Hex,
    blockNumber: bigint | undefined,
    functionName: string,
  ): Promise<Hex> {
    try {
      return await this.config.rpcClient.call({ to, data, blockNumber });
    } catch (error) {
      if (error instanceof ContractRevertError) throw error;
      if (error instanceof ProviderUnavailableError) throw error;
      throw new ContractRevertError(
        this.config.rpcClient.getPrimaryProviderUrl(),
        `Oracle call failed: ${functionName}`,
        typeof error === 'object' && error !== null && 'data' in error
          ? (error.data as Hex)
          : undefined,
      );
    }
  }
}
