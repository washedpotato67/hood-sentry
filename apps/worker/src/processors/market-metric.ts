import { evaluateMarketAlertRule } from '@hood-sentry/alert-engine';
import { DrizzlePricingRepository, schema } from '@hood-sentry/db';
import {
  MARKET_WINDOWS,
  type MarketMetrics,
  type MarketWindow,
  type TradeMetricInput,
  bucketStart,
} from '@hood-sentry/market-engine';
import type { DerivedJobPayload } from '@hood-sentry/queue';
import { and, desc, eq, gte, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { getAddress, isAddress, isHash } from 'viem';
import { MarketMetricAggregationJob } from '../jobs/market-metric-aggregation.js';
import { OhlcAggregationJob } from '../jobs/ohlc-aggregation.js';
import type { ProcessorContext } from './types.js';
import { loadVerifiedPoolPricingContext } from './verified-pool-pricing.js';

const WINDOWS = Object.entries(MARKET_WINDOWS) as readonly [MarketWindow, number][];
const METRICS_METHODOLOGY = 'market-metrics-v1';

async function loadTrades(
  context: ProcessorContext,
  input: {
    chainId: number;
    tokenAddress: `0x${string}`;
    quoteAddress: `0x${string}`;
    from: Date;
    to: Date;
    quoteDecimals: number;
  },
): Promise<readonly TradeMetricInput[]> {
  const tokenKey = input.tokenAddress.toLowerCase();
  const quoteKey = input.quoteAddress.toLowerCase();
  const rows = await context.database.db
    .select({
      transactionHash: schema.swaps.transaction_hash,
      senderAddress: schema.swaps.sender_address,
      recipientAddress: schema.swaps.recipient_address,
      tokenInAddress: schema.swaps.token_in_address,
      amountInRaw: schema.swaps.amount_in_raw,
      amountOutRaw: schema.swaps.amount_out_raw,
      timestamp: schema.blocks.timestamp,
      canonical: schema.swaps.canonical,
    })
    .from(schema.swaps)
    .innerJoin(
      schema.blocks,
      and(
        eq(schema.blocks.chainId, BigInt(input.chainId)),
        eq(schema.blocks.number, schema.swaps.block_number),
        eq(schema.blocks.hash, schema.swaps.block_hash),
      ),
    )
    .where(
      and(
        eq(schema.swaps.chain_id, input.chainId),
        eq(schema.swaps.canonical, true),
        eq(schema.blocks.canonical, true),
        gte(schema.blocks.timestamp, input.from),
        lte(schema.blocks.timestamp, input.to),
        or(
          and(
            eq(schema.swaps.token_in_address, quoteKey),
            eq(schema.swaps.token_out_address, tokenKey),
          ),
          and(
            eq(schema.swaps.token_in_address, tokenKey),
            eq(schema.swaps.token_out_address, quoteKey),
          ),
        ),
      ),
    );
  const whaleFloor = 10_000n * 10n ** BigInt(input.quoteDecimals);
  return rows.flatMap((row): readonly TradeMetricInput[] => {
    const trader = row.senderAddress ?? row.recipientAddress;
    if (trader === null || !isAddress(trader)) return [];
    if (!isHash(row.transactionHash)) throw new Error('Stored swap hash is malformed');
    const isBuy = row.tokenInAddress.toLowerCase() === quoteKey;
    const quoteAmountRaw = BigInt(isBuy ? row.amountInRaw : row.amountOutRaw);
    return [
      {
        transactionHash: row.transactionHash,
        traderAddress: getAddress(trader),
        side: isBuy ? 'buy' : 'sell',
        tokenAmountRaw: BigInt(isBuy ? row.amountOutRaw : row.amountInRaw),
        quoteAmountRaw,
        timestamp: row.timestamp.toISOString(),
        canonical: row.canonical,
        whale: quoteAmountRaw >= whaleFloor,
      },
    ];
  });
}

async function loadLiquidity(
  context: ProcessorContext,
  input: {
    chainId: number;
    tokenAddress: `0x${string}`;
    quoteAddress: `0x${string}`;
    blockNumber: bigint;
  },
): Promise<bigint | null> {
  const tokenKey = input.tokenAddress.toLowerCase();
  const quoteKey = input.quoteAddress.toLowerCase();
  const rows = await context.database.db
    .select({
      poolAddress: schema.pools.address,
      token0Address: schema.pools.token0_address,
      reserve0Raw: schema.poolStateSnapshots.reserve0_raw,
      reserve1Raw: schema.poolStateSnapshots.reserve1_raw,
      blockNumber: schema.poolStateSnapshots.source_block_number,
    })
    .from(schema.pools)
    .innerJoin(
      schema.poolStateSnapshots,
      and(
        eq(schema.poolStateSnapshots.chain_id, schema.pools.chain_id),
        eq(schema.poolStateSnapshots.pool_address, schema.pools.address),
      ),
    )
    .where(
      and(
        eq(schema.pools.chain_id, input.chainId),
        eq(schema.pools.canonical, true),
        eq(schema.pools.active, true),
        eq(schema.poolStateSnapshots.canonical, true),
        lte(schema.poolStateSnapshots.source_block_number, input.blockNumber),
        or(
          and(eq(schema.pools.token0_address, tokenKey), eq(schema.pools.token1_address, quoteKey)),
          and(eq(schema.pools.token0_address, quoteKey), eq(schema.pools.token1_address, tokenKey)),
        ),
      ),
    )
    .orderBy(schema.pools.address, desc(schema.poolStateSnapshots.source_block_number));
  const seen = new Set<string>();
  let liquidity = 0n;
  let found = false;
  for (const row of rows) {
    if (seen.has(row.poolAddress)) continue;
    seen.add(row.poolAddress);
    const reserve =
      row.token0Address.toLowerCase() === quoteKey ? row.reserve0Raw : row.reserve1Raw;
    if (reserve === null) continue;
    liquidity += BigInt(reserve);
    found = true;
  }
  return found ? liquidity : null;
}

async function previousMetrics(
  context: ProcessorContext,
  input: {
    chainId: number;
    tokenAddress: `0x${string}`;
    quoteAddress: `0x${string}`;
    window: MarketWindow;
    bucket: Date;
  },
): Promise<{
  spotPriceRaw: bigint | null;
  volumeRaw: bigint;
  liquidityRaw: bigint | null;
  transactionCount: bigint;
} | null> {
  const rows = await context.database.db
    .select({
      spotPriceRaw: schema.marketMetrics.spot_price_raw,
      volumeRaw: schema.marketMetrics.volume_raw,
      liquidityRaw: schema.marketMetrics.liquidity_raw,
      buyCount: schema.marketMetrics.buy_count,
      sellCount: schema.marketMetrics.sell_count,
    })
    .from(schema.marketMetrics)
    .where(
      and(
        eq(schema.marketMetrics.chain_id, input.chainId),
        eq(schema.marketMetrics.token_address, input.tokenAddress.toLowerCase()),
        eq(schema.marketMetrics.quote_asset_address, input.quoteAddress.toLowerCase()),
        eq(schema.marketMetrics.window, input.window),
        eq(schema.marketMetrics.canonical, true),
        lt(schema.marketMetrics.bucket_start, input.bucket),
      ),
    )
    .orderBy(desc(schema.marketMetrics.bucket_start))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    spotPriceRaw: row.spotPriceRaw === null ? null : BigInt(row.spotPriceRaw),
    volumeRaw: BigInt(row.volumeRaw),
    liquidityRaw: row.liquidityRaw === null ? null : BigInt(row.liquidityRaw),
    transactionCount: BigInt(row.buyCount) + BigInt(row.sellCount),
  };
}

async function deliverMarketAlerts(
  context: ProcessorContext,
  input: {
    metrics: MarketMetrics;
    windowSeconds: number;
    previousVolumeRaw: bigint | null;
    blockNumber: bigint;
    blockHash: string;
    transactionHash: string;
    logIndex: number;
    triggeredAt: Date;
  },
): Promise<void> {
  const rules = await context.database.db
    .select()
    .from(schema.alertRules)
    .where(
      and(
        eq(schema.alertRules.chainId, input.metrics.chainId),
        eq(schema.alertRules.targetAddress, input.metrics.tokenAddress.toLowerCase()),
        inArray(schema.alertRules.ruleType, ['price_change', 'volume_spike']),
        eq(schema.alertRules.enabled, true),
        isNull(schema.alertRules.deletedAt),
      ),
    );
  for (const rule of rules) {
    let decision: ReturnType<typeof evaluateMarketAlertRule>;
    try {
      decision = evaluateMarketAlertRule(
        {
          ruleType: rule.ruleType,
          targetAddress: rule.targetAddress,
          condition: rule.condition,
        },
        {
          tokenAddress: input.metrics.tokenAddress,
          windowSeconds: input.windowSeconds,
          priceChangeBps: input.metrics.priceChangeBps,
          volumeRaw: input.metrics.volumeRaw,
          previousVolumeRaw: input.previousVolumeRaw,
        },
      );
    } catch {
      context.logger.warn('Skipping market alert rule with an invalid condition', {
        alertRuleId: rule.id,
      });
      continue;
    }
    if (decision === null) continue;
    await context.database.db
      .insert(schema.alertEvents)
      .values({
        alertRuleId: rule.id,
        chainId: input.metrics.chainId,
        blockNumber: input.blockNumber,
        blockHash: input.blockHash.toLowerCase(),
        transactionHash: input.transactionHash.toLowerCase(),
        logIndex: input.logIndex,
        triggeredAt: input.triggeredAt,
        severity: decision.severity,
        metadata: {
          methodologyVersion: METRICS_METHODOLOGY,
          evidence: decision.evidence,
          metricWindow: input.metrics.window,
          metricBucketStart: input.metrics.bucketStart,
          quoteAssetAddress: input.metrics.quoteAssetAddress.toLowerCase(),
          blockHash: input.blockHash.toLowerCase(),
          logIndex: input.logIndex,
        },
        resolvedAt: null,
      })
      .onConflictDoNothing();
    const events = await context.database.db
      .select()
      .from(schema.alertEvents)
      .where(
        and(
          eq(schema.alertEvents.alertRuleId, rule.id),
          eq(schema.alertEvents.chainId, input.metrics.chainId),
          eq(schema.alertEvents.blockHash, input.blockHash.toLowerCase()),
          eq(schema.alertEvents.transactionHash, input.transactionHash.toLowerCase()),
          eq(schema.alertEvents.logIndex, input.logIndex),
        ),
      )
      .limit(1);
    const event = events[0];
    if (event === undefined) continue;
    if (context.alertDelivery === undefined) {
      throw new Error('ALERT_DELIVERY_SERVICE_NOT_CONFIGURED');
    }
    await context.alertDelivery.deliver(event, rule);
  }
}

export async function processMarketMetric(
  payload: DerivedJobPayload,
  context: ProcessorContext,
): Promise<void> {
  const loaded = await loadVerifiedPoolPricingContext(context.database, payload);
  if (loaded === null) return;
  const repository = new DrizzlePricingRepository(context.database.db);
  const asOf = new Date(loaded.sourceTimestamp);
  const observations = await repository.getPriceHistory(
    loaded.identity.chainId,
    loaded.tokenAddress,
    loaded.quoteAddress,
    asOf,
    asOf,
  );
  const currentObservation = observations.find(
    (observation) =>
      observation.sourceBlockHash?.toLowerCase() === loaded.identity.blockHash.toLowerCase(),
  );
  if (currentObservation === undefined) throw new Error('PRICE_OBSERVATION_NOT_READY');
  const tokenRows = await context.database.db
    .select({
      totalSupplyRaw: schema.tokens.total_supply_raw,
      decimals: schema.tokens.decimals,
    })
    .from(schema.tokens)
    .where(
      and(
        eq(schema.tokens.chain_id, loaded.identity.chainId),
        eq(schema.tokens.address, loaded.tokenAddress.toLowerCase()),
      ),
    )
    .limit(1);
  const token = tokenRows[0];
  if (token === undefined || token.decimals === null) {
    throw new Error('METRIC_TOKEN_SUPPLY_CONTEXT_UNAVAILABLE');
  }
  const liquidityRaw = await loadLiquidity(context, {
    chainId: loaded.identity.chainId,
    tokenAddress: loaded.tokenAddress,
    quoteAddress: loaded.quoteAddress,
    blockNumber: loaded.identity.blockNumber,
  });
  const metricJob = new MarketMetricAggregationJob(repository);
  const candleJob = new OhlcAggregationJob(repository);
  for (const [window, windowSeconds] of WINDOWS) {
    const bucket = new Date(bucketStart(loaded.sourceTimestamp, window));
    const history = await repository.getPriceHistory(
      loaded.identity.chainId,
      loaded.tokenAddress,
      loaded.quoteAddress,
      bucket,
      asOf,
    );
    await candleJob.run({
      observations: history,
      window,
      methodologyVersion: METRICS_METHODOLOGY,
    });
    const trades = await loadTrades(context, {
      chainId: loaded.identity.chainId,
      tokenAddress: loaded.tokenAddress,
      quoteAddress: loaded.quoteAddress,
      from: bucket,
      to: asOf,
      quoteDecimals: loaded.quoteDecimals,
    });
    const previous = await previousMetrics(context, {
      chainId: loaded.identity.chainId,
      tokenAddress: loaded.tokenAddress,
      quoteAddress: loaded.quoteAddress,
      window,
      bucket,
    });
    const result = await metricJob.run({
      chainId: loaded.identity.chainId,
      tokenAddress: loaded.tokenAddress,
      quoteAssetAddress: loaded.quoteAddress,
      window,
      asOf: loaded.sourceTimestamp,
      quoteDecimals: loaded.quoteDecimals,
      observation: currentObservation,
      trades,
      supply: {
        totalSupplyRaw: token.totalSupplyRaw === null ? null : BigInt(token.totalSupplyRaw),
        circulatingSupplyRaw: null,
        supplyDecimals: token.decimals,
        circulatingSupplyReliable: false,
        circulatingSupplyMethodology: null,
        circulatingSupplyExclusions: [],
      },
      context: {
        liquidityRaw,
        liquidityDecimals: liquidityRaw === null ? null : loaded.quoteDecimals,
        previousClosePriceRaw: previous?.spotPriceRaw ?? null,
        previousVolumeRaw: previous?.volumeRaw ?? null,
        previousLiquidityRaw: previous?.liquidityRaw ?? null,
        holderCount: null,
        previousHolderCount: null,
        previousTransactionCount: previous?.transactionCount ?? null,
        priceImpactByOrderSize: {},
      },
      methodologyVersion: METRICS_METHODOLOGY,
    });
    await deliverMarketAlerts(context, {
      metrics: result.metrics,
      windowSeconds,
      previousVolumeRaw: previous?.volumeRaw ?? null,
      blockNumber: loaded.identity.blockNumber,
      blockHash: loaded.identity.blockHash,
      transactionHash: loaded.identity.transactionHash,
      logIndex: loaded.identity.logIndex,
      triggeredAt: asOf,
    });
  }
}
