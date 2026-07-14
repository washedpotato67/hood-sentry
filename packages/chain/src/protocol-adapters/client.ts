import { decodeFunctionResult, encodeFunctionData } from 'viem';
import type { RPCClient } from '../rpc/rpc-client.js';
import type {
  ProtocolExecutionClient,
  ProtocolReadRequest,
  ProtocolSimulationRequest,
  ProtocolSimulationResult,
} from './types.js';

export class ResilientProtocolClient implements ProtocolExecutionClient {
  constructor(private readonly rpc: RPCClient) {}

  async getChainId(): Promise<number> {
    return this.rpc.getChainId();
  }

  async getBytecode(address: `0x${string}`, blockNumber?: bigint): Promise<`0x${string}`> {
    return this.rpc.getCode(address, blockNumber);
  }

  async getStorageAt(
    address: `0x${string}`,
    slot: `0x${string}`,
    blockNumber?: bigint,
  ): Promise<`0x${string}`> {
    return this.rpc.getStorageAt(address, slot, blockNumber);
  }

  async getBlockNumber(): Promise<bigint> {
    return this.rpc.getBlockNumber();
  }

  async getBlockTimestamp(): Promise<bigint> {
    const block = await this.rpc.getBlock({});
    return block.timestamp;
  }

  async readContract(request: ProtocolReadRequest): Promise<unknown> {
    const data = encodeFunctionData({
      abi: request.abi,
      functionName: request.functionName,
      args: request.args,
    });
    const result = await this.rpc.call({
      to: request.address,
      data,
      blockNumber: request.blockNumber,
    });
    return decodeFunctionResult({
      abi: request.abi,
      functionName: request.functionName,
      data: result,
    });
  }

  async simulateTransaction(request: ProtocolSimulationRequest): Promise<ProtocolSimulationResult> {
    return this.rpc.simulateTransaction({
      from: request.account,
      to: request.to,
      data: request.data,
      value: request.value,
    });
  }
}
