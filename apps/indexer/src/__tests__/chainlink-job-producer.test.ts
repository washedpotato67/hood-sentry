import type { PricingRepository } from '@hood-sentry/db';
import type { DerivedJobInput, DerivedJobPublisher } from '@hood-sentry/queue';
import { describe, expect, it } from 'vitest';
import { ChainlinkJobProducer } from '../chainlink-job-producer.js';

// Derive the config type from the repository interface so the indexer does not
// depend on @hood-sentry/market-engine, matching the production producer, which
// works with the inferred `listSourceConfigs` element type.
type PriceSourceConfig = Awaited<ReturnType<PricingRepository['listSourceConfigs']>>[number];

const FEED_A = '0x1000000000000000000000000000000000000001';
const FEED_B = '0x1000000000000000000000000000000000000002';
const TOKEN = '0x3000000000000000000000000000000000000001';
const QUOTE = '0x3000000000000000000000000000000000000002';
const BLOCK_HASH = `0x${'a'.repeat(64)}` as const;

function chainlinkConfig(
  sourceKey: string,
  overrides: Partial<PriceSourceConfig> = {},
): PriceSourceConfig {
  return {
    sourceKey,
    sourceType: 'chainlink',
    assetClass: 'erc20',
    chainId: 4663,
    sourceContractAddress: sourceKey === 'feed-a' ? FEED_A : FEED_B,
    sourceAssetAddress: TOKEN,
    quoteAssetAddress: QUOTE,
    verificationSourceUrl: 'https://docs.chain.link/',
    verifiedAt: '2026-07-14T00:00:00.000Z',
    minimumLiquidityRaw: 0n,
    liquidityDecimals: 0,
    maximumStalenessSeconds: 3600,
    enabled: true,
    priority: 1,
    confidenceRules: {
      baseConfidenceBps: 9_000n,
      thinLiquidityPenaltyBps: 0n,
      stalePenaltyBps: 0n,
      disagreementThresholdBps: 0n,
      disagreementPenaltyBps: 0n,
      maximumPriceImpactBps: 0n,
      maximumSingleTransactionVolumeBps: 0n,
      maximumPriceJumpBps: 0n,
      stablecoinDepegThresholdBps: 0n,
      minimumAuthoritativeConfidenceBps: 7_000n,
    },
    route: [],
    methodologyVersion: 'chainlink-v1',
    oracleHeartbeatSeconds: 60,
    ...overrides,
  };
}

class RecordingPublisher implements DerivedJobPublisher {
  readonly published: Array<{ job: DerivedJobInput; idempotencyKey: string }> = [];

  async publish(job: DerivedJobInput, idempotencyKey: string): Promise<void> {
    this.published.push({ job, idempotencyKey });
  }
}

function fakeRepository(configs: readonly PriceSourceConfig[]): PricingRepository {
  return {
    listSourceConfigs: async () => configs,
  } as unknown as PricingRepository;
}

describe('ChainlinkJobProducer', () => {
  it('publishes a job for every enabled Chainlink source', async () => {
    const publisher = new RecordingPublisher();
    const producer = new ChainlinkJobProducer({
      chainId: 4663,
      repository: fakeRepository([chainlinkConfig('feed-a'), chainlinkConfig('feed-b')]),
      publisher,
      logger: { warn: () => undefined, debug: () => undefined },
    });

    await producer.publishJobsForBlock(100n, BLOCK_HASH);

    expect(publisher.published).toHaveLength(2);
    const keys = publisher.published.map((p) => p.idempotencyKey);
    expect(keys[0]).toContain('feed-a');
    expect(keys[1]).toContain('feed-b');
    expect(keys[0]).not.toBe(keys[1]);

    const first = publisher.published[0];
    if (first === undefined) throw new Error('missing first job');
    expect(first.job.type).toBe('new-price-observation');
    expect(first.job.data).toMatchObject({
      sourceKey: 'feed-a',
      sourceContractAddress: FEED_A,
      sourceAssetAddress: TOKEN,
      quoteAssetAddress: QUOTE,
      oracleHeartbeatSeconds: 60,
    });
  });

  it('skips disabled and non-Chainlink sources', async () => {
    const publisher = new RecordingPublisher();
    const producer = new ChainlinkJobProducer({
      chainId: 4663,
      repository: fakeRepository([
        chainlinkConfig('feed-a', { enabled: false }),
        {
          ...chainlinkConfig('feed-b'),
          sourceType: 'directDex',
          sourceContractAddress: '0x2000000000000000000000000000000000000001',
        },
      ]),
      publisher,
      logger: { warn: () => undefined, debug: () => undefined },
    });

    await producer.publishJobsForBlock(100n, BLOCK_HASH);

    expect(publisher.published).toHaveLength(0);
  });

  it('skips Chainlink sources missing required fields', async () => {
    const publisher = new RecordingPublisher();
    const producer = new ChainlinkJobProducer({
      chainId: 4663,
      repository: fakeRepository([
        chainlinkConfig('feed-a', { sourceContractAddress: null }),
        chainlinkConfig('feed-b', { oracleHeartbeatSeconds: undefined }),
      ]),
      publisher,
      logger: { warn: () => undefined, debug: () => undefined },
    });

    await producer.publishJobsForBlock(100n, BLOCK_HASH);

    expect(publisher.published).toHaveLength(0);
  });
});
