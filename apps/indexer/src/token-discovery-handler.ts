import type { Logger } from '@hood-sentry/observability';
import { getAddress } from 'viem';
import type { Address, Hash, Hex } from 'viem';
import type { DerivedJob, IndexerConfig } from './types.js';

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ERC20_APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f70ef71315f9003819d0370313b11d1b585155b528b34';
const WORD_HEX_PATTERN = /^0x[0-9a-fA-F]{64}$/;

interface DiscoveryTransaction {
  hash: Hash;
  from: Address;
  to: Address | null;
  nonce: number;
}

interface DiscoveryReceipt {
  transactionHash: Hash;
  status: 'success' | 'reverted';
  contractAddress?: Address | null;
}

interface DiscoveryLog {
  transactionHash: Hash | null;
  logIndex: number | null;
  address: Address;
  topics: readonly Hex[];
  data: Hex;
}

export interface DiscoveryBlockData {
  block: {
    number: bigint | null;
    hash: Hash | null;
  };
  transactions: readonly DiscoveryTransaction[];
  receipts: readonly DiscoveryReceipt[];
  logs: readonly DiscoveryLog[];
}

type DiscoveryLogger = Pick<Logger, 'warn'>;

export class TokenDiscoveryHandler {
  constructor(
    private readonly config: Pick<IndexerConfig, 'chainId'>,
    private readonly logger: DiscoveryLogger,
  ) {}

  detectNewContractsAndTokens(blockData: DiscoveryBlockData): DerivedJob[] {
    const blockNumber = blockData.block.number;
    const blockHash = blockData.block.hash;

    if (blockNumber === null || blockHash === null) {
      this.logger.warn('Skipping token discovery for block with missing number or hash');
      return [];
    }

    const jobs = this.createContractDiscoveryJobs(blockData, blockNumber, blockHash);

    for (const log of blockData.logs) {
      jobs.push(...this.createTokenEventJobs(log, blockNumber, blockHash));
    }

    jobs.push(...this.createTokenFollowUpJobs(jobs, blockNumber, blockHash));

    return jobs;
  }

  /**
   * Per-token follow-ups for the transfers in this block: fetch metadata, and
   * rank the token into the discovery feeds.
   *
   * Metadata was previously emitted only from pool and launchpad events, so a
   * token that merely traded never got a `tokens` row — and every downstream job
   * needing decimals (wallet activity, price observations, market metrics) failed
   * with the token unknown. Emitting on transfer closes that gap; the metadata
   * processor keeps the cost bounded by re-reading only mutable supply once a
   * token's immutable fields are known.
   */
  private createTokenFollowUpJobs(
    jobs: readonly DerivedJob[],
    blockNumber: bigint,
    blockHash: Hash,
  ): DerivedJob[] {
    const tokenAddresses = new Set<Address>();

    for (const job of jobs) {
      if (job.type !== 'token-transfer') continue;
      const tokenAddress = (job.data as { tokenAddress?: Address }).tokenAddress;
      if (tokenAddress !== undefined) {
        tokenAddresses.add(tokenAddress);
      }
    }

    return [...tokenAddresses].flatMap((tokenAddress) => [
      {
        type: 'token-metadata' as const,
        chainId: this.config.chainId,
        blockNumber,
        blockHash,
        data: { tokenAddress },
      },
      {
        type: 'discovery-refresh' as const,
        chainId: this.config.chainId,
        blockNumber,
        blockHash,
        data: { tokenAddress },
      },
    ]);
  }

  private createContractDiscoveryJobs(
    blockData: DiscoveryBlockData,
    blockNumber: bigint,
    blockHash: Hash,
  ): DerivedJob[] {
    const receiptsByTransaction = new Map(
      blockData.receipts.map((receipt) => [receipt.transactionHash.toLowerCase(), receipt]),
    );
    const jobs: DerivedJob[] = [];

    for (const transaction of blockData.transactions) {
      if (transaction.to !== null) {
        continue;
      }

      const receipt = receiptsByTransaction.get(transaction.hash.toLowerCase());
      if (
        receipt?.status !== 'success' ||
        receipt.contractAddress === null ||
        receipt.contractAddress === undefined
      ) {
        continue;
      }

      jobs.push({
        type: 'contract-creation',
        chainId: this.config.chainId,
        blockNumber,
        blockHash,
        data: {
          transactionHash: transaction.hash,
          contractAddress: getAddress(receipt.contractAddress),
          creatorAddress: getAddress(transaction.from),
          nonce: transaction.nonce.toString(),
        },
      });
    }

    return jobs;
  }

  private createTokenEventJobs(
    log: DiscoveryLog,
    blockNumber: bigint,
    blockHash: Hash,
  ): DerivedJob[] {
    const topic0 = log.topics[0]?.toLowerCase();
    if (topic0 !== ERC20_TRANSFER_TOPIC && topic0 !== ERC20_APPROVAL_TOPIC) {
      return [];
    }

    if (log.transactionHash === null || log.logIndex === null) {
      this.warnMalformedEvent(log, 'missing transaction provenance');
      return [];
    }

    if (log.topics.length !== 3 || !WORD_HEX_PATTERN.test(log.data)) {
      this.warnMalformedEvent(log, 'invalid ERC-20 event shape');
      return [];
    }

    const firstAddress = this.addressFromTopic(log.topics[1]);
    const secondAddress = this.addressFromTopic(log.topics[2]);
    if (firstAddress === null || secondAddress === null) {
      this.warnMalformedEvent(log, 'invalid indexed address');
      return [];
    }

    const sharedData = {
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      tokenAddress: getAddress(log.address),
      valueRaw: BigInt(log.data).toString(),
    };

    if (topic0 === ERC20_TRANSFER_TOPIC) {
      const data = {
        ...sharedData,
        fromAddress: firstAddress,
        toAddress: secondAddress,
      };
      return [
        {
          type: 'token-transfer',
          chainId: this.config.chainId,
          blockNumber,
          blockHash,
          data,
        },
        {
          type: 'alert-evaluation',
          chainId: this.config.chainId,
          blockNumber,
          blockHash,
          data: { ...data, eventType: 'tokenTransfer' },
        },
        {
          type: 'wallet-activity',
          chainId: this.config.chainId,
          blockNumber,
          blockHash,
          data: { ...data, eventType: 'tokenTransfer' },
        },
      ];
    }

    const data = {
      ...sharedData,
      ownerAddress: firstAddress,
      spenderAddress: secondAddress,
    };
    return [
      {
        type: 'token-approval',
        chainId: this.config.chainId,
        blockNumber,
        blockHash,
        data,
      },
      {
        type: 'alert-evaluation',
        chainId: this.config.chainId,
        blockNumber,
        blockHash,
        data: { ...data, eventType: 'tokenApproval' },
      },
    ];
  }

  private addressFromTopic(topic: Hex | undefined): Address | null {
    if (topic === undefined || !WORD_HEX_PATTERN.test(topic)) {
      return null;
    }

    return getAddress(`0x${topic.slice(-40)}`);
  }

  private warnMalformedEvent(log: DiscoveryLog, reason: string): void {
    this.logger.warn('Skipping malformed ERC-20 event', {
      reason,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      tokenAddress: log.address,
    });
  }
}
