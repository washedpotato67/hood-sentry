import type { OracleClient } from '@hood-sentry/chain';
import { type Database, schema } from '@hood-sentry/db';
import { describe, expect, it } from 'vitest';
import {
  type VerifiedChainlinkPricingContext,
  buildChainlinkObservation,
} from '../chainlink-pricing.js';

const FEED = '0x1000000000000000000000000000000000000001';
const TOKEN = '0x3000000000000000000000000000000000000001';
const QUOTE = '0x3000000000000000000000000000000000000002';
const BLOCK_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function fakeContext(
  overrides: Partial<VerifiedChainlinkPricingContext> = {},
): VerifiedChainlinkPricingContext {
  return {
    identity: {
      chainId: 4663,
      blockNumber: 200n,
      blockHash: BLOCK_HASH,
      sourceKey: 'chainlink-fixture',
      sourceContractAddress: FEED,
      sourceAssetAddress: TOKEN,
      quoteAssetAddress: QUOTE,
      oracleHeartbeatSeconds: 60,
      sequencerFeedAddress: undefined,
    },
    sourceTimestamp: '2026-07-14T12:00:00.000Z',
    config: {
      sourceKey: 'chainlink-fixture',
      sourceType: 'chainlink',
      assetClass: 'erc20',
      chainId: 4663,
      sourceContractAddress: FEED,
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
        maximumPriceJumpBps: 5_000n,
        stablecoinDepegThresholdBps: 0n,
        minimumAuthoritativeConfidenceBps: 7_000n,
      },
      route: [],
      methodologyVersion: 'chainlink-v1',
      oracleHeartbeatSeconds: 60,
    },
    ...overrides,
  };
}

function fakeOracleClient(state: {
  answer?: bigint;
  paused?: boolean;
  sequencerUp?: boolean;
}): OracleClient {
  return {
    readPriceFeed: async () => ({
      answer: state.answer ?? 123_456_789n,
      decimals: 8,
      roundId: 100n,
      answeredInRound: 100n,
      updatedAt: '2026-07-14T12:00:00.000Z',
    }),
    readSequencerFeed: async () => ({
      up: state.sequencerUp ?? true,
      recoveredAt: undefined,
    }),
    readPaused: async () => state.paused ?? false,
  } as unknown as OracleClient;
}

function createFakeDatabase(responses: {
  priceRows?: Array<{ priceRaw: string | null }>;
  blockRows?: Array<{ timestamp: Date }>;
}): Database {
  let currentTable: unknown = null;
  const chain = {
    select: () => chain,
    from: (table: unknown) => {
      currentTable = table;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    limit: () => {
      if (currentTable === schema.blocks) {
        return Promise.resolve(responses.blockRows ?? []);
      }
      return Promise.resolve(responses.priceRows ?? []);
    },
  };
  return { db: chain } as unknown as Database;
}

describe('buildChainlinkObservation', () => {
  it('uses the latest prior canonical observation as the previous price', async () => {
    const database = createFakeDatabase({
      blockRows: [{ timestamp: new Date('2026-07-14T12:00:00.000Z') }],
      priceRows: [{ priceRaw: '100000000' }],
    });

    const observation = await buildChainlinkObservation(
      fakeContext(),
      fakeOracleClient({ answer: 150_000_000n }),
      database,
    );

    expect(observation.priceRaw).toBe(150_000_000n);
    expect(observation.reasons).not.toContain('ABNORMAL_PRICE_JUMP');
  });

  it('flags an abnormal price jump against the previous observation', async () => {
    const database = createFakeDatabase({
      blockRows: [{ timestamp: new Date('2026-07-14T12:00:00.000Z') }],
      priceRows: [{ priceRaw: '100000000' }],
    });

    const observation = await buildChainlinkObservation(
      fakeContext(),
      fakeOracleClient({ answer: 200_000_000n }),
      database,
    );

    expect(observation.priceRaw).toBe(200_000_000n);
    expect(observation.reasons).toContain('ABNORMAL_PRICE_JUMP');
  });

  it('reads oracle paused state from the client', async () => {
    const database = createFakeDatabase({
      blockRows: [{ timestamp: new Date('2026-07-14T12:00:00.000Z') }],
      priceRows: [],
    });

    const observation = await buildChainlinkObservation(
      fakeContext(),
      fakeOracleClient({ paused: true }),
      database,
    );

    expect(observation.oraclePaused).toBe(true);
    expect(observation.reasons).toContain('ORACLE_PAUSED');
    expect(observation.priceRaw).toBeNull();
  });

  it('marks the observation unavailable when the sequencer is down', async () => {
    const database = createFakeDatabase({
      blockRows: [{ timestamp: new Date('2026-07-14T12:00:00.000Z') }],
      priceRows: [],
    });

    const observation = await buildChainlinkObservation(
      fakeContext({
        identity: {
          ...fakeContext().identity,
          sequencerFeedAddress: '0x2000000000000000000000000000000000000002',
        },
      }),
      fakeOracleClient({ sequencerUp: false }),
      database,
    );

    expect(observation.sequencerUp).toBe(false);
    expect(observation.reasons).toContain('SEQUENCER_DOWN');
    expect(observation.status).toBe('unavailable');
  });
});
