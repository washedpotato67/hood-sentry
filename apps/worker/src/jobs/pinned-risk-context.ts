import type { Block, BlockRepository } from '@hood-sentry/db';
import type { RiskDataSource, RiskScanContext } from '@hood-sentry/risk-engine';
import type { Hash } from 'viem';
import type { RiskContextLoader, RiskScanJobInput } from './risk-scan.js';

export interface PinnedBlockClient {
  getChainId(): Promise<number>;
  getBlock(params: { blockNumber: bigint }): Promise<{ hash: Hash | null }>;
}

export class BaseRiskContextLoader implements RiskContextLoader {
  async loadContext(input: RiskScanJobInput, methodologyVersion: string): Promise<RiskScanContext> {
    return {
      target: input.target,
      sourceBlock: input.sourceBlock,
      sourceBlockHash: input.sourceBlockHash,
      methodologyVersion,
      data: {},
      dataSources: [],
    };
  }
}

function indexedBlockSource(context: RiskScanContext, block: Block): RiskDataSource {
  return {
    key: 'indexed_canonical_block',
    kind: 'database',
    provider: 'hood_sentry_indexer',
    status: 'available',
    sourceBlock: context.sourceBlock,
    sourceBlockHash: context.sourceBlockHash,
    fetchedAt: block.updatedAt.toISOString(),
    reason: null,
  };
}

function mergeSource(context: RiskScanContext, source: RiskDataSource): RiskScanContext {
  const sources = new Map(context.dataSources.map((entry) => [entry.key, entry]));
  sources.set(source.key, source);
  return {
    ...context,
    dataSources: [...sources.values()].sort((left, right) => left.key.localeCompare(right.key)),
  };
}

export class CanonicalRiskContextLoader implements RiskContextLoader {
  constructor(
    private readonly baseLoader: RiskContextLoader,
    private readonly expectedChainId: number,
    private readonly blocks: Pick<BlockRepository, 'getBlock'>,
    private readonly chainClient: PinnedBlockClient,
  ) {}

  private async validate(input: RiskScanJobInput): Promise<Block> {
    if (input.target.chainId !== this.expectedChainId) {
      throw new Error('RISK_CONFIGURED_CHAIN_ID_MISMATCH');
    }

    const [providerChainId, indexedBlock, providerBlock] = await Promise.all([
      this.chainClient.getChainId(),
      this.blocks.getBlock(BigInt(input.target.chainId), input.sourceBlock),
      this.chainClient.getBlock({ blockNumber: input.sourceBlock }),
    ]);

    if (providerChainId !== input.target.chainId) {
      throw new Error('RISK_PROVIDER_CHAIN_ID_MISMATCH');
    }
    if (indexedBlock === null) {
      throw new Error('RISK_INDEXED_BLOCK_NOT_CANONICAL');
    }
    if (indexedBlock.hash.toLowerCase() !== input.sourceBlockHash.toLowerCase()) {
      throw new Error('RISK_INDEXED_BLOCK_HASH_MISMATCH');
    }
    if (
      providerBlock.hash === null ||
      providerBlock.hash.toLowerCase() !== input.sourceBlockHash.toLowerCase()
    ) {
      throw new Error('RISK_PROVIDER_BLOCK_HASH_MISMATCH');
    }

    return indexedBlock;
  }

  async loadContext(input: RiskScanJobInput, methodologyVersion: string): Promise<RiskScanContext> {
    await this.validate(input);
    const context = await this.baseLoader.loadContext(input, methodologyVersion);
    const indexedBlock = await this.validate(input);
    return mergeSource(context, indexedBlockSource(context, indexedBlock));
  }
}
