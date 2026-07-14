export interface PricingReorgRepository {
  markPricingNonCanonical(chainId: number, fromBlock: bigint, toBlock: bigint): Promise<void>;
}

export interface PricingRecomputePublisher {
  publishRecompute(input: { chainId: number; fromBlock: bigint; toBlock: bigint }): Promise<void>;
}

export class PricingReorgJob {
  constructor(
    private readonly repository: PricingReorgRepository,
    private readonly publisher: PricingRecomputePublisher,
  ) {}

  async run(input: {
    chainId: number;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<{ idempotencyKey: string }> {
    if (input.toBlock < input.fromBlock) throw new Error('Reorg range is invalid');
    await this.repository.markPricingNonCanonical(input.chainId, input.fromBlock, input.toBlock);
    await this.publisher.publishRecompute(input);
    return {
      idempotencyKey: `pricing-reorg:${input.chainId}:${input.fromBlock.toString()}:${input.toBlock.toString()}`,
    };
  }
}
