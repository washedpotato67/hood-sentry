import { z } from 'zod';

const discoveryReorgInputSchema = z.object({
  chainId: z.number().int().positive(),
  fromBlock: z.bigint().nonnegative(),
  toBlock: z.bigint().nonnegative(),
});

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
    const parsed = discoveryReorgInputSchema.parse(input);
    if (parsed.toBlock < parsed.fromBlock) throw new Error('Reorg range is invalid');
    await this.repository.markNonCanonical(parsed.chainId, parsed.fromBlock, parsed.toBlock);
    await this.publisher.publishDiscoveryRecompute(parsed);
    return {
      idempotencyKey: `discovery-reorg:${parsed.chainId}:${parsed.fromBlock.toString()}:${parsed.toBlock.toString()}`,
    };
  }
}
