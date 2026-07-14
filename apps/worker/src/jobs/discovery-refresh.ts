import { stockTokenRegistry } from '@hood-sentry/chain';
import {
  type DiscoveryCandidate,
  type DiscoveryItem,
  applyCanonicalTokenRegistry,
  materializeDiscoveryItem,
} from '@hood-sentry/discovery-engine';

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
    const idempotencyKey = `discovery-refresh:${input.chainId}:${input.tokenAddress.toLowerCase()}:${input.sourceBlockNumber.toString()}`;
    const candidate = await this.loader.loadCandidate(input);
    if (candidate === null) return { item: null, idempotencyKey };
    if (
      candidate.chainId !== input.chainId ||
      candidate.sourceBlockNumber !== input.sourceBlockNumber
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
