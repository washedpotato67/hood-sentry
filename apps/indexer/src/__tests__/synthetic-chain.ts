import { createHash } from 'node:crypto';
import type { Address, Block, Hash, Hex, Log, Transaction, TransactionReceipt } from 'viem';
import type { BlockData } from '../types.js';

/**
 * A deterministic in-memory chain used to drive the indexer without an RPC node.
 *
 * Blocks are addressed by number and carry a `fork` label, so the same height can
 * be rebuilt with a different hash to synthesise a reorg. Hashes derive from
 * (fork, height), which keeps failures reproducible and readable.
 */

function digest(label: string): string {
  return createHash('sha256').update(label).digest('hex');
}

export function syntheticHash(label: string): Hash {
  return `0x${digest(label)}` as Hash;
}

export function syntheticAddress(label: string): Address {
  return `0x${digest(label).slice(0, 40)}` as Address;
}

export const GENESIS_PARENT_HASH = syntheticHash('genesis-parent');

/** keccak256('Transfer(address,address,uint256)'), the topic the indexer routes on. */
export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as Hex;

/** Left-pads an address into a 32-byte indexed topic word. */
function addressTopic(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as Hex;
}

/** Encodes a uint256 into a 32-byte data word. */
function uint256Word(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, '0')}` as Hex;
}

export interface SyntheticBlockOptions {
  /** Fork label. Blocks at the same height on different forks get different hashes. */
  fork: string;
  number: bigint;
  parentHash: Hash;
  /** Number of transactions (each with one log) to synthesise. Defaults to 1. */
  transactionCount?: number;
}

function buildBlockData(options: SyntheticBlockOptions): BlockData {
  const { fork, number, parentHash } = options;
  const transactionCount = options.transactionCount ?? 1;
  const blockHash = syntheticHash(`${fork}-block-${number}`);

  const transactions: Transaction[] = [];
  const receipts: TransactionReceipt[] = [];
  const logs: Log[] = [];

  for (let i = 0; i < transactionCount; i++) {
    const transactionHash = syntheticHash(`${fork}-tx-${number}-${i}`);
    const from = syntheticAddress(`${fork}-from-${number}-${i}`);
    const to = syntheticAddress(`${fork}-to-${number}-${i}`);

    const transaction = {
      hash: transactionHash,
      blockHash,
      blockNumber: number,
      transactionIndex: i,
      from,
      to,
      nonce: i,
      value: 1000n,
      input: '0x' as Hex,
      gas: 21000n,
      gasPrice: 1n,
      type: 'legacy',
      typeHex: '0x0',
      chainId: undefined,
      v: 0n,
      r: '0x' as Hex,
      s: '0x' as Hex,
    } as unknown as Transaction;

    // A well-formed ERC-20 Transfer. The indexer only publishes derived jobs for logs it
    // recognises, so an opaque topic would make every publishing assertion vacuous.
    const log = {
      address: to,
      blockHash,
      blockNumber: number,
      data: uint256Word(1000n),
      logIndex: i,
      removed: false,
      topics: [
        ERC20_TRANSFER_TOPIC,
        addressTopic(from),
        addressTopic(syntheticAddress(`${fork}-recipient-${number}-${i}`)),
      ],
      transactionHash,
      transactionIndex: i,
    } as unknown as Log;

    const receipt = {
      blockHash,
      blockNumber: number,
      contractAddress: null,
      cumulativeGasUsed: 21000n,
      effectiveGasPrice: 1n,
      from,
      gasUsed: 21000n,
      logs: [log],
      logsBloom: '0x' as Hex,
      status: 'success',
      to,
      transactionHash,
      transactionIndex: i,
      type: 'legacy',
    } as unknown as TransactionReceipt;

    transactions.push(transaction);
    receipts.push(receipt);
    logs.push(log);
  }

  const block = {
    hash: blockHash,
    number,
    parentHash,
    timestamp: 1700000000n + number,
    transactions,
    miner: syntheticAddress('miner'),
    gasUsed: 21000n * BigInt(transactionCount),
    gasLimit: 30000000n,
    baseFeePerGas: 1n,
    difficulty: 0n,
    extraData: '0x' as Hex,
    logsBloom: '0x' as Hex,
    nonce: '0x0',
    size: 1000n,
    stateRoot: syntheticHash(`${fork}-state-${number}`),
    transactionsRoot: syntheticHash(`${fork}-txroot-${number}`),
    receiptsRoot: syntheticHash(`${fork}-rxroot-${number}`),
    sha3Uncles: syntheticHash(`${fork}-uncles-${number}`),
    uncles: [],
    mixHash: syntheticHash(`${fork}-mix-${number}`),
    totalDifficulty: 0n,
  } as unknown as Block;

  return { block, transactions, receipts, logs };
}

export class SyntheticChain {
  private readonly blocks = new Map<string, BlockData>();

  /** Builds a canonical chain of `length` blocks (heights 0..length-1) on `fork`. */
  constructor(length: number, fork = 'a') {
    this.extendTo(BigInt(length - 1), fork);
  }

  /** Appends blocks on `fork` up to and including `height`, chaining parent hashes. */
  extendTo(height: bigint, fork = 'a'): void {
    for (let number = this.height() + 1n; number <= height; number++) {
      const parentHash = number === 0n ? GENESIS_PARENT_HASH : this.blockAt(number - 1n).block.hash;
      if (parentHash === null) throw new Error('Parent block is missing a hash');
      this.blocks.set(number.toString(), buildBlockData({ fork, number, parentHash }));
    }
  }

  /**
   * Rewrites the chain from `fromHeight` up to and including `toHeight` on a new
   * fork, keeping the common ancestor at `fromHeight - 1`. This is the synthetic reorg.
   */
  reorgFrom(fromHeight: bigint, toHeight: bigint, fork: string): void {
    for (let number = fromHeight; number <= toHeight; number++) {
      const parentHash =
        number === 0n
          ? GENESIS_PARENT_HASH
          : (this.blocks.get((number - 1n).toString())?.block.hash as Hash);
      if (parentHash === undefined) throw new Error(`Missing parent for block ${number}`);
      this.blocks.set(number.toString(), buildBlockData({ fork, number, parentHash }));
    }
    for (const key of [...this.blocks.keys()]) {
      if (BigInt(key) > toHeight) this.blocks.delete(key);
    }
  }

  height(): bigint {
    let max = -1n;
    for (const key of this.blocks.keys()) {
      const number = BigInt(key);
      if (number > max) max = number;
    }
    return max;
  }

  blockAt(number: bigint): BlockData {
    const blockData = this.blocks.get(number.toString());
    if (!blockData) throw new Error(`No synthetic block at height ${number}`);
    return blockData;
  }

  find(number: bigint): BlockData | undefined {
    return this.blocks.get(number.toString());
  }

  findByHash(hash: Hash): BlockData | undefined {
    for (const blockData of this.blocks.values()) {
      if (blockData.block.hash === hash) return blockData;
    }
    return undefined;
  }
}

/** A fault the fake RPC should inject on the next matching call. */
export interface RpcFaults {
  /** Heights where getBlock throws, simulating a provider outage. */
  throwOnBlock?: Set<bigint>;
  /** Heights where getBlock resolves to null, simulating an unavailable block. */
  nullOnBlock?: Set<bigint>;
  /** Heights where getBlock returns a block missing its number and hash. */
  malformedOnBlock?: Set<bigint>;
  /** Transaction hashes where getTransactionReceipt throws. */
  throwOnReceipt?: Set<Hash>;
  /** When set, each fault fires at most this many times before the call succeeds. */
  maxFaults?: number;
}

/**
 * Minimal stand-in for the chain package's RPCClient, covering only the surface
 * BlockFetcher uses. Records fetch counts so tests can assert that a restarted
 * indexer does not re-fetch blocks it already persisted.
 */
export class FakeRpcClient {
  readonly blockFetches: bigint[] = [];
  private faultCounts = new Map<string, number>();

  constructor(
    private readonly chain: SyntheticChain,
    private readonly faults: RpcFaults = {},
  ) {}

  private shouldFault(key: string): boolean {
    const max = this.faults.maxFaults;
    if (max === undefined) return true;
    const seen = this.faultCounts.get(key) ?? 0;
    if (seen >= max) return false;
    this.faultCounts.set(key, seen + 1);
    return true;
  }

  async getBlockNumber(): Promise<bigint> {
    return this.chain.height();
  }

  async getBlock(params: { blockNumber?: bigint; blockHash?: Hash }): Promise<Block | null> {
    const blockData =
      params.blockHash !== undefined
        ? this.chain.findByHash(params.blockHash)
        : this.chain.find(params.blockNumber as bigint);

    const number = params.blockNumber;
    if (number !== undefined) {
      if (this.faults.throwOnBlock?.has(number) && this.shouldFault(`throw-${number}`)) {
        throw new Error(`RPC provider unavailable for block ${number}`);
      }
      if (this.faults.nullOnBlock?.has(number) && this.shouldFault(`null-${number}`)) {
        return null;
      }
      if (this.faults.malformedOnBlock?.has(number) && this.shouldFault(`malformed-${number}`)) {
        // A response that parsed but lost its identity fields, as seen from
        // load balancers serving a pending block.
        const base = this.chain.blockAt(number).block;
        return { ...base, number: null, hash: null } as unknown as Block;
      }
      this.blockFetches.push(number);
    }

    if (!blockData) return null;
    return blockData.block;
  }

  async getTransactionReceipt(hash: Hash): Promise<TransactionReceipt> {
    if (this.faults.throwOnReceipt?.has(hash) && this.shouldFault(`receipt-${hash}`)) {
      throw new Error(`RPC provider failed to return receipt for ${hash}`);
    }
    for (const blockData of [...Array(Number(this.chain.height() + 1n)).keys()]) {
      const data = this.chain.find(BigInt(blockData));
      const receipt = data?.receipts.find((r) => r.transactionHash === hash);
      if (receipt) return receipt;
    }
    throw new Error(`No receipt for ${hash}`);
  }
}
