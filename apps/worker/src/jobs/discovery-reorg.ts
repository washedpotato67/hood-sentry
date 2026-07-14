export interface DiscoveryReorgRepository {
  markNonCanonical(chainId: number, fromBlock: bigint, toBlock: bigint): Promise<void>;
}

export interface DiscoveryRecomputePublisher {
  publishDiscoveryRecompute(input: {
    chainId: number;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<void>;
}

export class DiscoveryReorgJob {
  constructor(
    private readonly repository: DiscoveryReorgRepository,
    private readonly publisher: DiscoveryRecomputePublisher,
  ) {}

  async run(input: {
    chainId: number;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<{ idempotencyKey: string }> {
    if (input.toBlock < input.fromBlock) throw new Error('Reorg range is invalid');
    await this.repository.markNonCanonical(input.chainId, input.fromBlock, input.toBlock);
    await this.publisher.publishDiscoveryRecompute(input);
    return {
      idempotencyKey: `discovery-reorg:${input.chainId}:${input.fromBlock.toString()}:${input.toBlock.toString()}`,
    };
  }
}
