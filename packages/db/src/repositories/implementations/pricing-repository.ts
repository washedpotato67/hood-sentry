import {
  type MarketCandle,
  type MarketMetrics,
  type MarketWindow,
  type PriceObservation,
  type PriceSourceConfig,
  parsePriceSourceConfig,
} from '@hood-sentry/market-engine';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { type Hash, getAddress, isHash } from 'viem';
import { z } from 'zod';
import type { Database } from '../../client.js';
import * as schema from '../../schema/index.js';
import type { PricingRepository } from '../interfaces/pricing-repository.js';

const sourceTypeSchema = z.enum([
  'chainlink',
  'launchpadBondingCurve',
  'stablecoinPool',
  'wethRoute',
  'directDex',
  'multihop',
  'externalProvider',
  'unavailable',
]);
const statusSchema = z.enum(['available', 'lowConfidence', 'unavailable']);
const windowSchema = z.enum(['1m', '5m', '15m', '1h', '6h', '24h', '7d', '30d']);
const routeSchema = z.array(
  z.object({
    protocolKey: z.string(),
    protocolVersion: z.string(),
    poolAddress: z.string().transform((value) => getAddress(value)),
    inputTokenAddress: z.string().transform((value) => getAddress(value)),
    outputTokenAddress: z.string().transform((value) => getAddress(value)),
  }),
);
const reasonsSchema = z.array(z.string());
const exclusionsSchema = z.array(z.string().transform((value) => getAddress(value)));
const priceImpactSchema = z.record(z.string(), z.string().nullable());

type PriceObservationRow = typeof schema.deterministicPriceObservations.$inferSelect;
type CandleRow = typeof schema.marketCandles.$inferSelect;
type MetricsRow = typeof schema.marketMetrics.$inferSelect;

function parseHash(value: string | null): Hash | null {
  if (value === null) return null;
  if (!isHash(value)) throw new Error('Stored source block hash is malformed');
  return value;
}

function bigintOrNull(value: string | null): bigint | null {
  return value === null ? null : BigInt(value);
}

function jsonValue(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  );
}

function mapObservation(row: PriceObservationRow): PriceObservation {
  return {
    observationKey: row.observation_key,
    chainId: row.chain_id,
    tokenAddress: getAddress(row.token_address),
    quoteAssetAddress: getAddress(row.quote_asset_address),
    sourceKey: row.source_key,
    sourceType: sourceTypeSchema.parse(row.source_type),
    sourceContractAddress:
      row.source_contract_address === null ? null : getAddress(row.source_contract_address),
    providerName: row.provider_name,
    poolAddress: row.pool_address === null ? null : getAddress(row.pool_address),
    route: routeSchema.parse(row.route),
    priceRaw: bigintOrNull(row.price_raw),
    priceDecimals: row.price_decimals,
    sourceBlockNumber: row.source_block_number,
    sourceBlockHash: parseHash(row.source_block_hash),
    sourceTimestamp: row.source_timestamp.toISOString(),
    observedAt: row.observed_at.toISOString(),
    liquidityDepthRaw: bigintOrNull(row.liquidity_depth_raw),
    liquidityDepthDecimals: row.liquidity_depth_decimals,
    priceImpactBps: bigintOrNull(row.price_impact_bps),
    singleTransactionVolumeBps: bigintOrNull(row.single_transaction_volume_bps),
    confidenceBps: BigInt(row.confidence_bps),
    stale: row.stale,
    status: statusSchema.parse(row.status),
    authoritative: row.authoritative,
    reasons: reasonsSchema.parse(row.reasons),
    canonical: row.canonical,
    methodologyVersion: row.methodology_version,
    roundId: row.round_id === null ? undefined : BigInt(row.round_id),
    answeredInRound: row.answered_in_round === null ? undefined : BigInt(row.answered_in_round),
    oraclePaused: row.oracle_paused,
    sequencerUp: row.sequencer_up === null ? undefined : row.sequencer_up,
    sequencerRecoveredAt:
      row.sequencer_recovered_at === null
        ? undefined
        : BigInt(Math.floor(row.sequencer_recovered_at.getTime() / 1000)),
  };
}

function mapCandle(row: CandleRow): MarketCandle {
  return {
    chainId: row.chain_id,
    tokenAddress: getAddress(row.token_address),
    quoteAssetAddress: getAddress(row.quote_asset_address),
    window: windowSchema.parse(row.window),
    bucketStart: row.bucket_start.toISOString(),
    priceDecimals: row.price_decimals,
    openPriceRaw: BigInt(row.open_price_raw),
    highPriceRaw: BigInt(row.high_price_raw),
    lowPriceRaw: BigInt(row.low_price_raw),
    closePriceRaw: BigInt(row.close_price_raw),
    sourceObservationCount: BigInt(row.source_observation_count),
    canonical: row.canonical,
    methodologyVersion: row.methodology_version,
  };
}

function mapMetrics(row: MetricsRow): MarketMetrics {
  const impacts = priceImpactSchema.parse(row.price_impact_by_order_size);
  return {
    chainId: row.chain_id,
    tokenAddress: getAddress(row.token_address),
    quoteAssetAddress: getAddress(row.quote_asset_address),
    window: windowSchema.parse(row.window),
    bucketStart: row.bucket_start.toISOString(),
    quoteDecimals: row.quote_decimals,
    spotPriceRaw: bigintOrNull(row.spot_price_raw),
    spotPriceDecimals: row.spot_price_decimals,
    volumeRaw: BigInt(row.volume_raw),
    buyVolumeRaw: BigInt(row.buy_volume_raw),
    sellVolumeRaw: BigInt(row.sell_volume_raw),
    buyCount: BigInt(row.buy_count),
    sellCount: BigInt(row.sell_count),
    uniqueTraders: BigInt(row.unique_traders),
    liquidityRaw: bigintOrNull(row.liquidity_raw),
    liquidityDecimals: row.liquidity_decimals,
    marketCapitalizationRaw: bigintOrNull(row.market_capitalization_raw),
    fullyDilutedValuationRaw: bigintOrNull(row.fully_diluted_valuation_raw),
    valuationDecimals: row.valuation_decimals,
    circulatingSupplyRaw: bigintOrNull(row.circulating_supply_raw),
    circulatingSupplyMethodology: row.circulating_supply_methodology,
    circulatingSupplyExclusions: exclusionsSchema.parse(row.circulating_supply_exclusions),
    priceChangeBps: bigintOrNull(row.price_change_bps),
    volumeChangeBps: bigintOrNull(row.volume_change_bps),
    liquidityChangeBps: bigintOrNull(row.liquidity_change_bps),
    holderChange: bigintOrNull(row.holder_change),
    transactionGrowthBps: bigintOrNull(row.transaction_growth_bps),
    averageTradeSizeRaw: bigintOrNull(row.average_trade_size_raw),
    medianTradeSizeRaw: bigintOrNull(row.median_trade_size_raw),
    whaleVolumeRaw: BigInt(row.whale_volume_raw),
    priceImpactByOrderSize: Object.fromEntries(
      Object.entries(impacts).map(([key, value]) => [key, value === null ? null : BigInt(value)]),
    ),
    canonical: row.canonical,
    methodologyVersion: row.methodology_version,
  };
}

export class DrizzlePricingRepository implements PricingRepository {
  constructor(private readonly db: Database['db']) {}

  async saveSourceConfig(config: PriceSourceConfig): Promise<void> {
    await this.db
      .insert(schema.priceSourceConfigs)
      .values({
        source_key: config.sourceKey,
        source_type: config.sourceType,
        asset_class: config.assetClass,
        chain_id: config.chainId,
        source_contract_address: config.sourceContractAddress,
        source_asset_address: config.sourceAssetAddress.toLowerCase(),
        quote_asset_address: config.quoteAssetAddress.toLowerCase(),
        verification_source_url: config.verificationSourceUrl,
        verified_at: new Date(config.verifiedAt),
        minimum_liquidity_raw: config.minimumLiquidityRaw.toString(),
        liquidity_decimals: config.liquidityDecimals,
        maximum_staleness_seconds: config.maximumStalenessSeconds,
        enabled: config.enabled,
        priority: config.priority,
        confidence_rules: jsonValue(config.confidenceRules),
        route: jsonValue(config.route),
        methodology_version: config.methodologyVersion,
        oracle_heartbeat_seconds: config.oracleHeartbeatSeconds ?? null,
        sequencer_feed_address: config.sequencerFeedAddress ?? null,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.priceSourceConfigs.source_key,
        set: {
          enabled: config.enabled,
          priority: config.priority,
          confidence_rules: jsonValue(config.confidenceRules),
          route: jsonValue(config.route),
          methodology_version: config.methodologyVersion,
          oracle_heartbeat_seconds: config.oracleHeartbeatSeconds ?? null,
          sequencer_feed_address: config.sequencerFeedAddress ?? null,
          updated_at: new Date(),
        },
      });
  }

  async listSourceConfigs(
    chainId: number,
    tokenAddress?: string,
  ): Promise<readonly PriceSourceConfig[]> {
    const where =
      tokenAddress === undefined
        ? eq(schema.priceSourceConfigs.chain_id, chainId)
        : and(
            eq(schema.priceSourceConfigs.chain_id, chainId),
            eq(schema.priceSourceConfigs.source_asset_address, tokenAddress.toLowerCase()),
          );
    const rows = await this.db
      .select()
      .from(schema.priceSourceConfigs)
      .where(where)
      .orderBy(schema.priceSourceConfigs.priority);
    return rows.map((row) =>
      parsePriceSourceConfig({
        sourceKey: row.source_key,
        sourceType: row.source_type,
        assetClass: row.asset_class,
        chainId: row.chain_id,
        sourceContractAddress: row.source_contract_address,
        sourceAssetAddress: row.source_asset_address,
        quoteAssetAddress: row.quote_asset_address,
        verificationSourceUrl: row.verification_source_url,
        verifiedAt: row.verified_at.toISOString(),
        minimumLiquidityRaw: row.minimum_liquidity_raw,
        liquidityDecimals: row.liquidity_decimals,
        maximumStalenessSeconds: row.maximum_staleness_seconds,
        enabled: row.enabled,
        priority: row.priority,
        confidenceRules: row.confidence_rules,
        route: row.route,
        methodologyVersion: row.methodology_version,
        oracleHeartbeatSeconds: row.oracle_heartbeat_seconds ?? undefined,
        sequencerFeedAddress: row.sequencer_feed_address ?? null,
      }),
    );
  }

  async saveObservation(value: PriceObservation): Promise<void> {
    await this.db
      .insert(schema.deterministicPriceObservations)
      .values({
        observation_key: value.observationKey,
        chain_id: value.chainId,
        token_address: value.tokenAddress.toLowerCase(),
        quote_asset_address: value.quoteAssetAddress.toLowerCase(),
        source_key: value.sourceKey,
        source_type: value.sourceType,
        source_contract_address: value.sourceContractAddress,
        provider_name: value.providerName,
        pool_address: value.poolAddress,
        route: jsonValue(value.route),
        price_raw: value.priceRaw?.toString() ?? null,
        price_decimals: value.priceDecimals,
        source_block_number: value.sourceBlockNumber,
        source_block_hash: value.sourceBlockHash,
        source_timestamp: new Date(value.sourceTimestamp),
        observed_at: new Date(value.observedAt),
        liquidity_depth_raw: value.liquidityDepthRaw?.toString() ?? null,
        liquidity_depth_decimals: value.liquidityDepthDecimals,
        price_impact_bps: value.priceImpactBps?.toString() ?? null,
        single_transaction_volume_bps: value.singleTransactionVolumeBps?.toString() ?? null,
        confidence_bps: value.confidenceBps.toString(),
        stale: value.stale,
        status: value.status,
        authoritative: value.authoritative,
        reasons: jsonValue(value.reasons),
        canonical: value.canonical,
        methodology_version: value.methodologyVersion,
        round_id: value.roundId?.toString() ?? null,
        answered_in_round: value.answeredInRound?.toString() ?? null,
        oracle_paused: value.oraclePaused ?? false,
        sequencer_up: value.sequencerUp ?? null,
        sequencer_recovered_at:
          value.sequencerRecoveredAt === undefined
            ? null
            : new Date(Number(value.sequencerRecoveredAt) * 1000),
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.deterministicPriceObservations.observation_key,
        set: {
          price_raw: value.priceRaw?.toString() ?? null,
          confidence_bps: value.confidenceBps.toString(),
          stale: value.stale,
          status: value.status,
          authoritative: value.authoritative,
          reasons: jsonValue(value.reasons),
          canonical: value.canonical,
          round_id: value.roundId?.toString() ?? null,
          answered_in_round: value.answeredInRound?.toString() ?? null,
          oracle_paused: value.oraclePaused ?? false,
          sequencer_up: value.sequencerUp ?? null,
          sequencer_recovered_at:
            value.sequencerRecoveredAt === undefined
              ? null
              : new Date(Number(value.sequencerRecoveredAt) * 1000),
          updated_at: new Date(),
        },
      });
  }

  async getCurrentPrice(
    chainId: number,
    tokenAddress: string,
    quoteAssetAddress: string,
  ): Promise<PriceObservation | null> {
    const rows = await this.db
      .select()
      .from(schema.deterministicPriceObservations)
      .where(
        and(
          eq(schema.deterministicPriceObservations.chain_id, chainId),
          eq(schema.deterministicPriceObservations.token_address, tokenAddress.toLowerCase()),
          eq(
            schema.deterministicPriceObservations.quote_asset_address,
            quoteAssetAddress.toLowerCase(),
          ),
          eq(schema.deterministicPriceObservations.canonical, true),
        ),
      )
      .orderBy(desc(schema.deterministicPriceObservations.observed_at))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : mapObservation(row);
  }

  async findLatestOracleStatus(
    chainId: number,
    tokenAddress: string,
    quoteAssetAddress: string,
  ): Promise<PriceObservation | null> {
    const rows = await this.db
      .select()
      .from(schema.deterministicPriceObservations)
      .where(
        and(
          eq(schema.deterministicPriceObservations.chain_id, chainId),
          eq(schema.deterministicPriceObservations.token_address, tokenAddress.toLowerCase()),
          eq(
            schema.deterministicPriceObservations.quote_asset_address,
            quoteAssetAddress.toLowerCase(),
          ),
          eq(schema.deterministicPriceObservations.source_type, 'chainlink'),
          eq(schema.deterministicPriceObservations.canonical, true),
        ),
      )
      .orderBy(desc(schema.deterministicPriceObservations.observed_at))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : mapObservation(row);
  }

  async getPriceHistory(
    chainId: number,
    tokenAddress: string,
    quoteAssetAddress: string,
    from: Date,
    to: Date,
  ): Promise<readonly PriceObservation[]> {
    const rows = await this.db
      .select()
      .from(schema.deterministicPriceObservations)
      .where(
        and(
          eq(schema.deterministicPriceObservations.chain_id, chainId),
          eq(schema.deterministicPriceObservations.token_address, tokenAddress.toLowerCase()),
          eq(
            schema.deterministicPriceObservations.quote_asset_address,
            quoteAssetAddress.toLowerCase(),
          ),
          gte(schema.deterministicPriceObservations.observed_at, from),
          lte(schema.deterministicPriceObservations.observed_at, to),
          eq(schema.deterministicPriceObservations.canonical, true),
        ),
      )
      .orderBy(schema.deterministicPriceObservations.observed_at);
    return rows.map(mapObservation);
  }

  async saveCandle(value: MarketCandle): Promise<void> {
    const row = {
      chain_id: value.chainId,
      token_address: value.tokenAddress.toLowerCase(),
      quote_asset_address: value.quoteAssetAddress.toLowerCase(),
      window: value.window,
      bucket_start: new Date(value.bucketStart),
      price_decimals: value.priceDecimals,
      open_price_raw: value.openPriceRaw.toString(),
      high_price_raw: value.highPriceRaw.toString(),
      low_price_raw: value.lowPriceRaw.toString(),
      close_price_raw: value.closePriceRaw.toString(),
      source_observation_count: value.sourceObservationCount.toString(),
      canonical: value.canonical,
      methodology_version: value.methodologyVersion,
      updated_at: new Date(),
    };
    await this.db
      .insert(schema.marketCandles)
      .values(row)
      .onConflictDoUpdate({
        target: [
          schema.marketCandles.chain_id,
          schema.marketCandles.token_address,
          schema.marketCandles.quote_asset_address,
          schema.marketCandles.window,
          schema.marketCandles.bucket_start,
          schema.marketCandles.methodology_version,
        ],
        set: row,
      });
  }

  async getCandles(
    chainId: number,
    tokenAddress: string,
    quoteAssetAddress: string,
    window: MarketWindow,
    limit: number,
  ): Promise<readonly MarketCandle[]> {
    const rows = await this.db
      .select()
      .from(schema.marketCandles)
      .where(
        and(
          eq(schema.marketCandles.chain_id, chainId),
          eq(schema.marketCandles.token_address, tokenAddress.toLowerCase()),
          eq(schema.marketCandles.quote_asset_address, quoteAssetAddress.toLowerCase()),
          eq(schema.marketCandles.window, window),
          eq(schema.marketCandles.canonical, true),
        ),
      )
      .orderBy(desc(schema.marketCandles.bucket_start))
      .limit(limit);
    return rows.map(mapCandle);
  }

  async saveMetrics(value: MarketMetrics): Promise<void> {
    const row = {
      chain_id: value.chainId,
      token_address: value.tokenAddress.toLowerCase(),
      quote_asset_address: value.quoteAssetAddress.toLowerCase(),
      window: value.window,
      bucket_start: new Date(value.bucketStart),
      quote_decimals: value.quoteDecimals,
      spot_price_raw: value.spotPriceRaw?.toString() ?? null,
      spot_price_decimals: value.spotPriceDecimals,
      volume_raw: value.volumeRaw.toString(),
      buy_volume_raw: value.buyVolumeRaw.toString(),
      sell_volume_raw: value.sellVolumeRaw.toString(),
      buy_count: value.buyCount.toString(),
      sell_count: value.sellCount.toString(),
      unique_traders: value.uniqueTraders.toString(),
      liquidity_raw: value.liquidityRaw?.toString() ?? null,
      liquidity_decimals: value.liquidityDecimals,
      market_capitalization_raw: value.marketCapitalizationRaw?.toString() ?? null,
      fully_diluted_valuation_raw: value.fullyDilutedValuationRaw?.toString() ?? null,
      valuation_decimals: value.valuationDecimals,
      circulating_supply_raw: value.circulatingSupplyRaw?.toString() ?? null,
      circulating_supply_methodology: value.circulatingSupplyMethodology,
      circulating_supply_exclusions: jsonValue(value.circulatingSupplyExclusions),
      price_change_bps: value.priceChangeBps?.toString() ?? null,
      volume_change_bps: value.volumeChangeBps?.toString() ?? null,
      liquidity_change_bps: value.liquidityChangeBps?.toString() ?? null,
      holder_change: value.holderChange?.toString() ?? null,
      transaction_growth_bps: value.transactionGrowthBps?.toString() ?? null,
      average_trade_size_raw: value.averageTradeSizeRaw?.toString() ?? null,
      median_trade_size_raw: value.medianTradeSizeRaw?.toString() ?? null,
      whale_volume_raw: value.whaleVolumeRaw.toString(),
      price_impact_by_order_size: jsonValue(value.priceImpactByOrderSize),
      canonical: value.canonical,
      methodology_version: value.methodologyVersion,
      updated_at: new Date(),
    };
    await this.db
      .insert(schema.marketMetrics)
      .values(row)
      .onConflictDoUpdate({
        target: [
          schema.marketMetrics.chain_id,
          schema.marketMetrics.token_address,
          schema.marketMetrics.quote_asset_address,
          schema.marketMetrics.window,
          schema.marketMetrics.bucket_start,
          schema.marketMetrics.methodology_version,
        ],
        set: row,
      });
  }

  async getLatestMetrics(
    chainId: number,
    tokenAddress: string,
    quoteAssetAddress: string,
    window: MarketWindow,
  ): Promise<MarketMetrics | null> {
    const rows = await this.db
      .select()
      .from(schema.marketMetrics)
      .where(
        and(
          eq(schema.marketMetrics.chain_id, chainId),
          eq(schema.marketMetrics.token_address, tokenAddress.toLowerCase()),
          eq(schema.marketMetrics.quote_asset_address, quoteAssetAddress.toLowerCase()),
          eq(schema.marketMetrics.window, window),
          eq(schema.marketMetrics.canonical, true),
        ),
      )
      .orderBy(desc(schema.marketMetrics.bucket_start))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : mapMetrics(row);
  }

  async markStaleSources(observedBefore: Date): Promise<number> {
    const rows = await this.db
      .update(schema.deterministicPriceObservations)
      .set({
        stale: true,
        authoritative: false,
        status: 'lowConfidence',
        updated_at: new Date(),
      })
      .where(
        and(
          lte(schema.deterministicPriceObservations.observed_at, observedBefore),
          eq(schema.deterministicPriceObservations.stale, false),
        ),
      )
      .returning({ key: schema.deterministicPriceObservations.observation_key });
    return rows.length;
  }

  async markPricingNonCanonical(
    chainId: number,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<void> {
    await this.db
      .update(schema.deterministicPriceObservations)
      .set({ canonical: false, authoritative: false, updated_at: new Date() })
      .where(
        and(
          eq(schema.deterministicPriceObservations.chain_id, chainId),
          gte(schema.deterministicPriceObservations.source_block_number, fromBlock),
          lte(schema.deterministicPriceObservations.source_block_number, toBlock),
        ),
      );
    await this.db
      .update(schema.marketCandles)
      .set({ canonical: false, updated_at: new Date() })
      .where(eq(schema.marketCandles.chain_id, chainId));
    await this.db
      .update(schema.marketMetrics)
      .set({ canonical: false, updated_at: new Date() })
      .where(eq(schema.marketMetrics.chain_id, chainId));
  }
}
