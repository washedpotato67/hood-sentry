import { type OracleClient, checksumAddress } from '@hood-sentry/chain';
import { type Database, DrizzlePricingRepository, schema } from '@hood-sentry/db';
import {
  type PriceObservation,
  type PriceSourceConfig,
  chainlinkEvidence,
  evaluateObservation,
} from '@hood-sentry/market-engine';
import { and, desc, eq, lt } from 'drizzle-orm';
import { type Address, type Hash, isAddress } from 'viem';
import { z } from 'zod';

const chainlinkJobDataSchema = z.object({
  sourceKey: z.string().trim().min(1).max(100),
  sourceContractAddress: z.string().refine(isAddress).transform(checksumAddress),
  sourceAssetAddress: z.string().refine(isAddress).transform(checksumAddress),
  quoteAssetAddress: z.string().refine(isAddress).transform(checksumAddress),
  oracleHeartbeatSeconds: z.number().int().positive(),
  sequencerFeedAddress: z.string().refine(isAddress).transform(checksumAddress).optional(),
});

export interface ChainlinkPricingIdentity {
  chainId: number;
  blockNumber: bigint;
  blockHash: Hash;
  sourceKey: string;
  sourceContractAddress: Address;
  sourceAssetAddress: Address;
  quoteAssetAddress: Address;
  oracleHeartbeatSeconds: number;
  sequencerFeedAddress: Address | undefined;
}

export interface VerifiedChainlinkPricingContext {
  identity: ChainlinkPricingIdentity;
  sourceTimestamp: string;
  config: PriceSourceConfig;
}

export function parseChainlinkIdentity(input: {
  chainId: string;
  blockNumber: string;
  blockHash: string;
  data: unknown;
}): ChainlinkPricingIdentity {
  const data = chainlinkJobDataSchema.parse(input.data);
  return {
    chainId: z.coerce.number().int().positive().parse(input.chainId),
    blockNumber: BigInt(z.string().regex(/^\d+$/).parse(input.blockNumber)),
    blockHash: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .parse(input.blockHash) as Hash,
    sourceKey: data.sourceKey,
    sourceContractAddress: data.sourceContractAddress,
    sourceAssetAddress: data.sourceAssetAddress,
    quoteAssetAddress: data.quoteAssetAddress,
    oracleHeartbeatSeconds: data.oracleHeartbeatSeconds,
    sequencerFeedAddress: data.sequencerFeedAddress,
  };
}

export async function loadVerifiedChainlinkPricingContext(
  database: Database,
  payload: { chainId: string; blockNumber: string; blockHash: string; data: unknown },
): Promise<VerifiedChainlinkPricingContext | null> {
  const identity = parseChainlinkIdentity(payload);
  const repository = new DrizzlePricingRepository(database.db);
  const configs = await repository.listSourceConfigs(identity.chainId, identity.sourceAssetAddress);
  const config = configs.find((candidate) => candidate.sourceKey === identity.sourceKey);
  if (config === undefined) {
    return null;
  }
  if (!config.enabled) {
    throw new Error('CHAINLINK_SOURCE_DISABLED');
  }
  if (config.sourceType !== 'chainlink') {
    throw new Error('CHAINLINK_SOURCE_TYPE_MISMATCH');
  }

  const blockRows = await database.db
    .select({ timestamp: schema.blocks.timestamp })
    .from(schema.blocks)
    .where(eq(schema.blocks.hash, identity.blockHash.toLowerCase()))
    .limit(1);
  const block = blockRows[0];
  if (block === undefined) {
    throw new Error('CHAINLINK_PRICE_BLOCK_NOT_INDEXED');
  }

  return {
    identity,
    sourceTimestamp: block.timestamp.toISOString(),
    config,
  };
}

export async function buildChainlinkObservation(
  context: VerifiedChainlinkPricingContext,
  oracleClient: OracleClient,
  database: Database,
): Promise<PriceObservation> {
  const { identity, config, sourceTimestamp } = context;

  const [priceResult, sequencerResult, oraclePaused] = await Promise.all([
    oracleClient.readPriceFeed(identity.sourceContractAddress, identity.blockNumber),
    identity.sequencerFeedAddress === undefined
      ? Promise.resolve({ up: true, recoveredAt: undefined })
      : oracleClient.readSequencerFeed(identity.sequencerFeedAddress, identity.blockNumber),
    oracleClient.readPaused(identity.sourceContractAddress, identity.blockNumber),
  ]);

  const evidence = chainlinkEvidence(
    {
      answer: priceResult.answer,
      decimals: priceResult.decimals,
      roundId: priceResult.roundId,
      answeredInRound: priceResult.answeredInRound,
      updatedAt: priceResult.updatedAt,
      sequencerUp: sequencerResult.up,
      sequencerGracePeriodElapsed:
        sequencerResult.recoveredAt === undefined ||
        BigInt(Math.floor(Date.parse(sourceTimestamp) / 1000)) - sequencerResult.recoveredAt >=
          BigInt(config.oracleHeartbeatSeconds ?? identity.oracleHeartbeatSeconds),
      oraclePaused,
    },
    {
      sourceBlockNumber: identity.blockNumber,
      sourceBlockHash: identity.blockHash,
      sourceTimestamp,
      observedAt: new Date().toISOString(),
      liquidityDepthRaw: null,
      liquidityDepthDecimals: null,
      priceImpactBps: null,
      singleTransactionVolumeBps: null,
      providerName: null,
      poolAddress: null,
      route: [],
      canonical: true,
    },
  );

  const previousRows = await database.db
    .select({ priceRaw: schema.deterministicPriceObservations.price_raw })
    .from(schema.deterministicPriceObservations)
    .where(
      and(
        eq(schema.deterministicPriceObservations.chain_id, config.chainId),
        eq(
          schema.deterministicPriceObservations.token_address,
          config.sourceAssetAddress.toLowerCase(),
        ),
        eq(
          schema.deterministicPriceObservations.quote_asset_address,
          config.quoteAssetAddress.toLowerCase(),
        ),
        eq(schema.deterministicPriceObservations.canonical, true),
        lt(schema.deterministicPriceObservations.source_block_number, identity.blockNumber),
      ),
    )
    .orderBy(desc(schema.deterministicPriceObservations.source_block_number))
    .limit(1);
  const previousPriceRaw =
    previousRows[0]?.priceRaw === null || previousRows[0]?.priceRaw === undefined
      ? null
      : BigInt(previousRows[0].priceRaw);

  const observation = evaluateObservation(config, evidence, previousPriceRaw);

  // Augment the evaluated observation with oracle-specific state that does not
  // alter the deterministic evidence but is useful for diagnostics and health probes.
  return {
    ...observation,
    roundId: priceResult.roundId,
    answeredInRound: priceResult.answeredInRound,
    oraclePaused,
    sequencerUp: sequencerResult.up,
    sequencerRecoveredAt: sequencerResult.recoveredAt,
  };
}

// These fields are persisted alongside the observation but are not part of the
// public PriceObservation type; the repository maps them separately.
export interface ChainlinkObservationExtras {
  roundId: bigint;
  answeredInRound: bigint;
  oraclePaused: boolean;
  sequencerUp: boolean;
  sequencerRecoveredAt: bigint | undefined;
}
