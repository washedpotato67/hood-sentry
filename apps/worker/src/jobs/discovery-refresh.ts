import { stockTokenRegistry } from '@hood-sentry/chain';
import {
  type DiscoveryCandidate,
  type DiscoveryItem,
  applyCanonicalTokenRegistry,
  materializeDiscoveryItem,
} from '@hood-sentry/discovery-engine';
import { getAddress, isAddress } from 'viem';
import { z } from 'zod';

const discoveryRefreshInputSchema = z.object({
  chainId: z.number().int().positive(),
  tokenAddress: z
    .string()
    .refine(isAddress, 'Token address is malformed')
    .transform((address) => getAddress(address)),
  sourceBlockNumber: z.bigint().nonnegative(),
});

export interface DiscoveryCandidateLoader {
  loadCandidate(input: {
    chainId: number;
    tokenAddress: string;
    sourceBlockNumber: bigint;
  }): Promise<DiscoveryCandidate | null>;
}

export interface DiscoverySnapshotWriter {
  saveSnapshot(item: DiscoveryItem): Promise<void>;
}

export class DiscoveryRefreshJob {
  constructor(
    private readonly loader: DiscoveryCandidateLoader,
    private readonly writer: DiscoverySnapshotWriter,
  ) {}

  async run(input: {
    chainId: number;
    tokenAddress: string;
    sourceBlockNumber: bigint;
  }): Promise<{ item: DiscoveryItem | null; idempotencyKey: string }> {
    const parsed = discoveryRefreshInputSchema.parse(input);
    const idempotencyKey = `discovery-refresh:${parsed.chainId}:${parsed.tokenAddress.toLowerCase()}:${parsed.sourceBlockNumber.toString()}`;
    const candidate = await this.loader.loadCandidate(parsed);
    if (candidate === null) return { item: null, idempotencyKey };
    if (
      candidate.chainId !== parsed.chainId ||
      candidate.sourceBlockNumber !== parsed.sourceBlockNumber
    ) {
      throw new Error('Discovery source candidate does not match the requested chain position');
    }
    const classified = applyCanonicalTokenRegistry(
      candidate,
      stockTokenRegistry.entries
        .filter((entry) => entry.enabled)
        .map((entry) => ({
          chainId: entry.chainId,
          address: entry.address,
          ticker: entry.ticker,
          name: entry.name,
          assetType: entry.assetType,
          category: null,
        })),
    );
    const item = materializeDiscoveryItem(classified);
    await this.writer.saveSnapshot(item);
    return { item, idempotencyKey };
  }
}
