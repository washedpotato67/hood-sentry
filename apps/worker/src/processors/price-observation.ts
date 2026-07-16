import { DrizzlePricingRepository, schema } from '@hood-sentry/db';
import { poolEvidence } from '@hood-sentry/market-engine';
import type { DerivedJobPayload } from '@hood-sentry/queue';
import { and, desc, eq, lt } from 'drizzle-orm';
import { NewPriceObservationJob } from '../jobs/price-observation.js';
import {
  buildChainlinkObservation,
  loadVerifiedChainlinkPricingContext,
} from './chainlink-pricing.js';
import type { ProcessorContext } from './types.js';
import { loadVerifiedPoolPricingContext } from './verified-pool-pricing.js';

function isChainlinkPayload(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'sourceKey' in data &&
    typeof data.sourceKey === 'string'
  );
}

export async function processPriceObservation(
  payload: DerivedJobPayload,
  context: ProcessorContext,
): Promise<void> {
  if (isChainlinkPayload(payload.data)) {
    await processChainlinkPriceObservation(payload, context);
    return;
  }
  await processPoolPriceObservation(payload, context);
}

async function processChainlinkPriceObservation(
  payload: DerivedJobPayload,
  context: ProcessorContext,
): Promise<void> {
  const loaded = await loadVerifiedChainlinkPricingContext(context.database, payload);
  if (loaded === null) {
    context.logger.warn('Skipping chainlink price observation: source config not found', {
      chainId: payload.chainId,
      blockNumber: payload.blockNumber,
    });
    return;
  }
  if (context.oracleClient === undefined) {
    throw new Error('OracleClient is required for chainlink price observations');
  }
  const repository = new DrizzlePricingRepository(context.database.db);
  const observation = await buildChainlinkObservation(
    loaded,
    context.oracleClient,
    context.database,
  );
  await repository.saveObservation(observation);
}

async function processPoolPriceObservation(
  payload: DerivedJobPayload,
  context: ProcessorContext,
): Promise<void> {
  const loaded = await loadVerifiedPoolPricingContext(context.database, payload);
  if (loaded === null) return;
  const repository = new DrizzlePricingRepository(context.database.db);
  const previousRows = await context.database.db
    .select({ priceRaw: schema.deterministicPriceObservations.price_raw })
    .from(schema.deterministicPriceObservations)
    .where(
      and(
        eq(schema.deterministicPriceObservations.chain_id, loaded.identity.chainId),
        eq(schema.deterministicPriceObservations.token_address, loaded.tokenAddress.toLowerCase()),
        eq(
          schema.deterministicPriceObservations.quote_asset_address,
          loaded.quoteAddress.toLowerCase(),
        ),
        eq(schema.deterministicPriceObservations.canonical, true),
        lt(schema.deterministicPriceObservations.source_block_number, loaded.identity.blockNumber),
      ),
    )
    .orderBy(desc(schema.deterministicPriceObservations.source_block_number))
    .limit(1);
  const previousPriceRaw =
    previousRows[0]?.priceRaw === null || previousRows[0]?.priceRaw === undefined
      ? null
      : BigInt(previousRows[0].priceRaw);
  const singleTransactionVolumeBps =
    loaded.reserveQuoteRaw <= 0n
      ? null
      : (loaded.quoteTradeAmountRaw * 10_000n) / loaded.reserveQuoteRaw;
  const evidence = poolEvidence(
    {
      tokenAddress: loaded.tokenAddress,
      quoteAssetAddress: loaded.quoteAddress,
      tokenDecimals: loaded.tokenDecimals,
      quoteDecimals: loaded.quoteDecimals,
      reserveTokenRaw: loaded.reserveTokenRaw,
      reserveQuoteRaw: loaded.reserveQuoteRaw,
      protocolVerified: true,
      tokenAddressesVerified: true,
      poolStateFresh: true,
      priceImpactBps: null,
      singleTransactionVolumeBps,
    },
    loaded.quoteDecimals,
    {
      sourceBlockNumber: loaded.identity.blockNumber,
      sourceBlockHash: loaded.identity.blockHash,
      sourceTimestamp: loaded.sourceTimestamp,
      observedAt: loaded.sourceTimestamp,
      liquidityDepthRaw: loaded.reserveQuoteRaw,
      liquidityDepthDecimals: loaded.quoteDecimals,
      priceImpactBps: null,
      singleTransactionVolumeBps,
      providerName: null,
      poolAddress: loaded.identity.poolAddress,
      route: loaded.config.route,
      canonical: true,
    },
  );
  await new NewPriceObservationJob(repository).run({
    config: loaded.config,
    evidence,
    previousPriceRaw,
  });
}
