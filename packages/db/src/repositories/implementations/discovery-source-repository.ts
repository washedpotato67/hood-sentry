import type { DiscoveryCandidate, DiscoveryTrade, RiskGrade } from '@hood-sentry/discovery-engine';
import { and, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { type Address, type Hash, getAddress, isHash } from 'viem';
import { z } from 'zod';
import type { Database } from '../../client.js';
import * as schema from '../../schema/index.js';

const priceStatusSchema = z.enum(['available', 'lowConfidence', 'unavailable']);
const riskGradeSchema = z.enum(['A', 'B', 'C', 'D', 'F']);
const priceImpactSchema = z.record(z.string(), z.string().nullable());
const stringArraySchema = z.array(z.string());

export interface DiscoverySourceOptions {
  minimumHealthyLiquidityRaw: bigint;
  tinyTradeThresholdRaw: bigint;
  maximumRecentTrades: number;
}

export interface DiscoveryCandidateRequest {
  chainId: number;
  tokenAddress: string;
  sourceBlockNumber: bigint;
}

function hash(value: string): Hash {
  if (!isHash(value)) throw new Error('Indexed discovery hash is malformed');
  return value;
}

function bigintOrNull(value: string | null): bigint | null {
  return value === null ? null : BigInt(value);
}

function tokenType(value: string): DiscoveryCandidate['tokenType'] {
  if (value === 'stock_token') return 'stockToken';
  if (value === 'etf_token') return 'etfToken';
  if (value === 'erc20') return 'erc20';
  return 'unknown';
}

function percentToBps(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  const fractionPadded = `${fraction}00`.slice(0, 2);
  return BigInt(whole) * 100n + BigInt(fractionPadded);
}

function maxPriceImpact(value: unknown): bigint | null {
  const parsed = priceImpactSchema.parse(value);
  const impacts = Object.values(parsed).flatMap((item) => (item === null ? [] : [BigInt(item)]));
  if (impacts.length === 0) return null;
  return impacts.reduce((highest, item) => (item > highest ? item : highest));
}

function windowGrowth(dates: readonly Date[], now: Date): bigint {
  const currentStart = now.getTime() - 86_400_000;
  const previousStart = currentStart - 86_400_000;
  const current = dates.filter((date) => date.getTime() >= currentStart).length;
  const previous = dates.filter(
    (date) => date.getTime() >= previousStart && date.getTime() < currentStart,
  ).length;
  return BigInt(current - previous);
}

function earliestDate(values: readonly (Date | null | undefined)[], fallback: Date): Date {
  return values
    .filter((value): value is Date => value instanceof Date)
    .reduce((earliest, value) => (value < earliest ? value : earliest), fallback);
}

function checksummedAddresses(values: readonly string[]): Address[] {
  return [
    ...new Map(values.map((value) => [value.toLowerCase(), getAddress(value)])).values(),
  ].sort((left, right) => left.localeCompare(right));
}

export class DrizzleDiscoverySourceRepository {
  constructor(
    private readonly db: Database['db'],
    private readonly options: DiscoverySourceOptions,
  ) {
    if (
      !Number.isInteger(options.maximumRecentTrades) ||
      options.maximumRecentTrades < 1 ||
      options.maximumRecentTrades > 5_000
    ) {
      throw new Error('Discovery recent trade limit is outside the supported range');
    }
    if (options.minimumHealthyLiquidityRaw < 0n || options.tinyTradeThresholdRaw < 0n) {
      throw new Error('Discovery manipulation thresholds must not be negative');
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one coordinator preserves a single source-block boundary across indexed facts
  async loadCandidate(input: DiscoveryCandidateRequest): Promise<DiscoveryCandidate | null> {
    const identity = input.tokenAddress.toLowerCase();
    const [token] = await this.db
      .select()
      .from(schema.tokens)
      .where(and(eq(schema.tokens.chain_id, input.chainId), eq(schema.tokens.address, identity)))
      .limit(1);
    if (token === undefined) return null;

    const [sourceBlock] = await this.db
      .select()
      .from(schema.blocks)
      .where(
        and(
          eq(schema.blocks.chainId, BigInt(input.chainId)),
          eq(schema.blocks.number, input.sourceBlockNumber),
          eq(schema.blocks.canonical, true),
        ),
      )
      .orderBy(desc(schema.blocks.timestamp))
      .limit(1);
    if (sourceBlock === undefined)
      throw new Error('Discovery source block is unavailable or noncanonical');

    const activeProtocols = await this.db
      .select({
        id: schema.dexProtocols.id,
        protocolKey: schema.dexProtocols.protocol_key,
        kind: schema.dexProtocols.kind,
      })
      .from(schema.dexProtocols)
      .where(
        and(
          eq(schema.dexProtocols.chain_id, input.chainId),
          eq(schema.dexProtocols.enabled, true),
          eq(schema.dexProtocols.validation_status, 'active'),
        ),
      );
    const activeDexIds = activeProtocols
      .filter((protocol) => protocol.kind === 'dex')
      .map((protocol) => protocol.id);
    const activeLaunchpadKeys = activeProtocols
      .filter((protocol) => protocol.kind === 'launchpad')
      .map((protocol) => protocol.protocolKey);
    const poolsPromise =
      activeDexIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(schema.pools)
            .where(
              and(
                eq(schema.pools.chain_id, input.chainId),
                eq(schema.pools.canonical, true),
                lte(schema.pools.created_block, input.sourceBlockNumber),
                inArray(schema.pools.protocol_id, activeDexIds),
                or(
                  eq(schema.pools.token0_address, identity),
                  eq(schema.pools.token1_address, identity),
                ),
              ),
            )
            .orderBy(desc(schema.pools.created_block));
    const contractPromise = this.db
      .select()
      .from(schema.contracts)
      .where(
        and(eq(schema.contracts.chain_id, input.chainId), eq(schema.contracts.address, identity)),
      )
      .limit(1);
    const pricePromise = this.db
      .select()
      .from(schema.deterministicPriceObservations)
      .where(
        and(
          eq(schema.deterministicPriceObservations.chain_id, input.chainId),
          eq(schema.deterministicPriceObservations.token_address, identity),
          eq(schema.deterministicPriceObservations.canonical, true),
          lte(schema.deterministicPriceObservations.observed_at, sourceBlock.timestamp),
        ),
      )
      .orderBy(desc(schema.deterministicPriceObservations.observed_at))
      .limit(1);
    const metricsPromise = this.db
      .select()
      .from(schema.marketMetrics)
      .where(
        and(
          eq(schema.marketMetrics.chain_id, input.chainId),
          eq(schema.marketMetrics.token_address, identity),
          eq(schema.marketMetrics.window, '24h'),
          eq(schema.marketMetrics.canonical, true),
          lte(schema.marketMetrics.bucket_start, sourceBlock.timestamp),
        ),
      )
      .orderBy(desc(schema.marketMetrics.bucket_start))
      .limit(1);
    const holdersPromise = this.db
      .select()
      .from(schema.holderSnapshots)
      .where(
        and(
          eq(schema.holderSnapshots.chain_id, input.chainId),
          eq(schema.holderSnapshots.token_address, identity),
          lte(schema.holderSnapshots.snapshot_block, input.sourceBlockNumber),
        ),
      )
      .orderBy(desc(schema.holderSnapshots.snapshot_block))
      .limit(2);
    const launchPromise =
      activeLaunchpadKeys.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(schema.launchpadTokens)
            .where(
              and(
                eq(schema.launchpadTokens.chain_id, input.chainId),
                eq(schema.launchpadTokens.token_address, identity),
                eq(schema.launchpadTokens.canonical, true),
                lte(schema.launchpadTokens.block_number, input.sourceBlockNumber),
                inArray(schema.launchpadTokens.protocol_key, activeLaunchpadKeys),
              ),
            )
            .orderBy(desc(schema.launchpadTokens.block_number))
            .limit(1);
    const graduationPromise =
      activeLaunchpadKeys.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(schema.launchpadGraduations)
            .where(
              and(
                eq(schema.launchpadGraduations.chain_id, input.chainId),
                eq(schema.launchpadGraduations.token_address, identity),
                eq(schema.launchpadGraduations.canonical, true),
                lte(schema.launchpadGraduations.block_number, input.sourceBlockNumber),
                inArray(schema.launchpadGraduations.protocol_key, activeLaunchpadKeys),
              ),
            )
            .orderBy(desc(schema.launchpadGraduations.block_number))
            .limit(1);
    const migrationPromise =
      activeLaunchpadKeys.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(schema.launchpadMigrations)
            .where(
              and(
                eq(schema.launchpadMigrations.chain_id, input.chainId),
                eq(schema.launchpadMigrations.token_address, identity),
                eq(schema.launchpadMigrations.canonical, true),
                lte(schema.launchpadMigrations.block_number, input.sourceBlockNumber),
                inArray(schema.launchpadMigrations.protocol_key, activeLaunchpadKeys),
              ),
            )
            .orderBy(desc(schema.launchpadMigrations.block_number))
            .limit(1);
    const warningsPromise = this.db
      .select({
        category: schema.dataQualityWarnings.category,
        field: schema.dataQualityWarnings.field,
      })
      .from(schema.dataQualityWarnings)
      .where(
        and(
          eq(schema.dataQualityWarnings.chain_id, input.chainId),
          eq(schema.dataQualityWarnings.address, identity),
          eq(schema.dataQualityWarnings.status, 'open'),
        ),
      );
    const watchDatesPromise = this.db
      .select({ addedAt: schema.watchlistItems.addedAt })
      .from(schema.watchlistItems)
      .innerJoin(schema.watchlists, eq(schema.watchlistItems.watchlistId, schema.watchlists.id))
      .where(
        and(
          eq(schema.watchlistItems.chainId, input.chainId),
          eq(schema.watchlistItems.targetAddress, identity),
          isNull(schema.watchlists.deletedAt),
        ),
      );
    const alertDatesPromise = this.db
      .select({ createdAt: schema.alertRules.createdAt })
      .from(schema.alertRules)
      .where(
        and(
          eq(schema.alertRules.chainId, input.chainId),
          eq(schema.alertRules.targetAddress, identity),
          eq(schema.alertRules.enabled, true),
          isNull(schema.alertRules.deletedAt),
        ),
      );
    const duplicatePromise =
      token.symbol === null
        ? Promise.resolve([])
        : this.db
            .select({ address: schema.tokens.address })
            .from(schema.tokens)
            .where(
              and(
                eq(schema.tokens.chain_id, input.chainId),
                eq(schema.tokens.symbol, token.symbol),
              ),
            );

    const [
      pools,
      contracts,
      prices,
      metricsRows,
      holders,
      launches,
      graduations,
      migrations,
      warnings,
      watchDates,
      alertDates,
      duplicates,
    ] = await Promise.all([
      poolsPromise,
      contractPromise,
      pricePromise,
      metricsPromise,
      holdersPromise,
      launchPromise,
      graduationPromise,
      migrationPromise,
      warningsPromise,
      watchDatesPromise,
      alertDatesPromise,
      duplicatePromise,
    ]);

    const primaryPool = pools[0];
    const poolAddresses = pools.map((pool) => pool.address);
    const activityPoolAddresses = primaryPool === undefined ? [] : [primaryPool.address];
    const swaps =
      activityPoolAddresses.length === 0
        ? []
        : await this.db
            .select()
            .from(schema.swaps)
            .where(
              and(
                eq(schema.swaps.chain_id, input.chainId),
                eq(schema.swaps.canonical, true),
                lte(schema.swaps.block_number, input.sourceBlockNumber),
                inArray(schema.swaps.pool_address, activityPoolAddresses),
              ),
            )
            .orderBy(desc(schema.swaps.block_number), desc(schema.swaps.log_index))
            .limit(this.options.maximumRecentTrades);
    const launchpadTrades =
      activeLaunchpadKeys.length === 0
        ? []
        : await this.db
            .select()
            .from(schema.launchpadTrades)
            .where(
              and(
                eq(schema.launchpadTrades.chain_id, input.chainId),
                eq(schema.launchpadTrades.token_address, identity),
                eq(schema.launchpadTrades.canonical, true),
                lte(schema.launchpadTrades.block_number, input.sourceBlockNumber),
                inArray(schema.launchpadTrades.protocol_key, activeLaunchpadKeys),
              ),
            )
            .orderBy(
              desc(schema.launchpadTrades.block_number),
              desc(schema.launchpadTrades.log_index),
            )
            .limit(this.options.maximumRecentTrades);
    const blockNumbers = [
      token.first_seen_block,
      primaryPool?.created_block,
      graduations[0]?.block_number,
      migrations[0]?.block_number,
      ...swaps.map((swap) => swap.block_number),
      ...launchpadTrades.map((trade) => trade.block_number),
    ].filter((value): value is bigint => value !== null && value !== undefined);
    const relatedBlocks =
      blockNumbers.length === 0
        ? []
        : await this.db
            .select()
            .from(schema.blocks)
            .where(
              and(
                eq(schema.blocks.chainId, BigInt(input.chainId)),
                eq(schema.blocks.canonical, true),
                inArray(schema.blocks.number, [...new Set(blockNumbers)]),
              ),
            );
    const blockTimes = new Map(
      relatedBlocks.map((block) => [block.number.toString(), block.timestamp]),
    );
    const recentTrades = [
      ...this.mapTrades(swaps, blockTimes, identity),
      ...this.mapLaunchpadTrades(launchpadTrades, blockTimes),
    ]
      .sort((left, right) =>
        left.blockNumber === right.blockNumber
          ? right.logIndex - left.logIndex
          : left.blockNumber > right.blockNumber
            ? -1
            : 1,
      )
      .slice(0, this.options.maximumRecentTrades);

    const project = await this.loadProject(input.chainId, identity);
    const risk = await this.loadRisk(input.chainId, identity, input.sourceBlockNumber);
    const suspiciousDeployerEvidence = await this.loadDeployerEvidence(
      input.chainId,
      contracts[0]?.creator_address ?? null,
    );
    const currentHolder = holders[0];
    const previousHolder = holders[1];
    const price = prices[0];
    const metrics = metricsRows[0];
    const launch = launches[0];
    const graduation = graduations[0];
    const migration = migrations[0];
    const firstSeenBlock = token.first_seen_block ?? input.sourceBlockNumber;
    const firstSeenAt = blockTimes.get(firstSeenBlock.toString())?.toISOString() ?? null;
    const poolCreatedAt =
      primaryPool === undefined
        ? null
        : (blockTimes.get(primaryPool.created_block.toString())?.toISOString() ?? null);
    const quoteAssetAddress =
      primaryPool === undefined
        ? (price?.quote_asset_address ?? metrics?.quote_asset_address ?? null)
        : primaryPool.token0_address.toLowerCase() === identity
          ? primaryPool.token1_address
          : primaryPool.token0_address;
    const launchpadState =
      migration !== undefined
        ? 'migrated'
        : graduation !== undefined
          ? 'graduated'
          : launch !== undefined
            ? 'bondingCurve'
            : 'none';
    const freshnessSource = earliestDate(
      [price?.source_timestamp, metrics?.bucket_start, currentHolder?.updated_at],
      sourceBlock.timestamp,
    );
    const warningCodes = warnings.map((warning) => `${warning.category}:${warning.field}`);
    warningCodes.push(...risk.dataWarnings);
    if (token.first_seen_block === null) warningCodes.push('TOKEN_FIRST_SEEN_BLOCK_UNAVAILABLE');
    if (launch !== undefined && launchpadState === 'bondingCurve') {
      warningCodes.push('LAUNCHPAD_CURVE_PROGRESS_UNAVAILABLE');
    }

    return {
      chainId: input.chainId,
      address: getAddress(token.address),
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      tokenType: tokenType(token.token_type),
      canonicalState: 'unknown',
      canonicalTicker: null,
      stockTokenCategory: null,
      etfCategory: null,
      projectName: project?.projectName ?? null,
      projectSlug: project?.slug ?? null,
      projectVerified: project?.verified ?? false,
      projectVerifiedAt: project?.verifiedAt?.toISOString() ?? null,
      deployerAddress:
        contracts[0]?.creator_address === null || contracts[0]?.creator_address === undefined
          ? null
          : getAddress(contracts[0].creator_address),
      primaryPoolAddress: primaryPool === undefined ? null : getAddress(primaryPool.address),
      poolAddresses: checksummedAddresses(poolAddresses),
      protocolKey: primaryPool?.protocol_key ?? null,
      launchpadKey: launch?.protocol_key ?? null,
      quoteAssetAddress: quoteAssetAddress === null ? null : getAddress(quoteAssetAddress),
      firstSeenBlockNumber: firstSeenBlock,
      firstSeenAt,
      poolCreatedBlockNumber: primaryPool?.created_block ?? null,
      poolCreatedAt,
      priceRaw: bigintOrNull(price?.price_raw ?? null),
      priceDecimals: price?.price_decimals ?? null,
      priceStatus: price === undefined ? 'unavailable' : priceStatusSchema.parse(price.status),
      priceObservedAt: price?.observed_at.toISOString() ?? null,
      liquidityRaw: bigintOrNull(metrics?.liquidity_raw ?? null),
      liquidityDecimals: metrics?.liquidity_decimals ?? null,
      volumeRaw: bigintOrNull(metrics?.volume_raw ?? null),
      volumeDecimals: metrics?.quote_decimals ?? null,
      volumeChangeBps: bigintOrNull(metrics?.volume_change_bps ?? null),
      liquidityChangeBps: bigintOrNull(metrics?.liquidity_change_bps ?? null),
      holderCount: currentHolder === undefined ? null : BigInt(currentHolder.holder_count),
      holderGrowth:
        currentHolder === undefined || previousHolder === undefined
          ? null
          : BigInt(currentHolder.holder_count - previousHolder.holder_count),
      holderConcentrationBps: currentHolder === undefined ? null : BigInt(currentHolder.top_10_bps),
      transactionCount:
        metrics === undefined ? null : BigInt(metrics.buy_count) + BigInt(metrics.sell_count),
      transactionGrowthBps: bigintOrNull(metrics?.transaction_growth_bps ?? null),
      uniqueTraders: bigintOrNull(metrics?.unique_traders ?? null),
      watchlistCount: BigInt(watchDates.length),
      watchlistGrowth: windowGrowth(
        watchDates.map((row) => row.addedAt),
        sourceBlock.timestamp,
      ),
      alertCount: BigInt(alertDates.length),
      alertCreationGrowth: windowGrowth(
        alertDates.map((row) => row.createdAt),
        sourceBlock.timestamp,
      ),
      launchpadState,
      launchpadCurveProgressBps: null,
      graduatedAt:
        graduation === undefined
          ? null
          : (blockTimes.get(graduation.block_number.toString())?.toISOString() ?? null),
      migratedAt:
        migration === undefined
          ? null
          : (blockTimes.get(migration.block_number.toString())?.toISOString() ?? null),
      riskGrade: risk.grade,
      riskCompletenessBps: risk.completenessBps,
      suspiciousDeployerEvidence,
      duplicateSymbolAddresses: checksummedAddresses(
        duplicates
          .map((row) => row.address)
          .filter((address) => address.toLowerCase() !== identity),
      ),
      dataQualityWarnings: warningCodes.sort(),
      lastScannedAt: risk.lastScannedAt,
      latestCriticalFindingAt: risk.latestCriticalFindingAt,
      sourceBlockNumber: input.sourceBlockNumber,
      sourceBlockHash: hash(sourceBlock.hash),
      sourceTimestamp: freshnessSource.toISOString(),
      observedAt: sourceBlock.timestamp.toISOString(),
      canonical: true,
      recentTrades,
      manipulationContext: {
        liquidityRaw: bigintOrNull(metrics?.liquidity_raw ?? null),
        minimumHealthyLiquidityRaw: this.options.minimumHealthyLiquidityRaw,
        tinyTradeThresholdRaw: this.options.tinyTradeThresholdRaw,
        priceImpactBps:
          metrics === undefined ? null : maxPriceImpact(metrics.price_impact_by_order_size),
        sybilClusterWallets: [],
        launchpad: launch !== undefined,
      },
    };
  }

  private mapTrades(
    swaps: readonly (typeof schema.swaps.$inferSelect)[],
    blockTimes: ReadonlyMap<string, Date>,
    tokenAddress: string,
  ): DiscoveryTrade[] {
    return swaps.flatMap((swap) => {
      const timestamp = blockTimes.get(swap.block_number.toString());
      const trader = swap.sender_address;
      if (timestamp === undefined || trader === null) return [];
      const sellingToken = swap.token_in_address.toLowerCase() === tokenAddress;
      const quoteAmount = sellingToken ? swap.amount_out_raw : swap.amount_in_raw;
      return [
        {
          transactionHash: hash(swap.transaction_hash),
          blockNumber: swap.block_number,
          blockHash: hash(swap.block_hash),
          logIndex: swap.log_index,
          timestamp: timestamp.toISOString(),
          senderAddress: swap.sender_address === null ? null : getAddress(swap.sender_address),
          recipientAddress:
            swap.recipient_address === null ? null : getAddress(swap.recipient_address),
          traderAddress: getAddress(trader),
          counterpartyAddress:
            swap.recipient_address === null ? null : getAddress(swap.recipient_address),
          side: sellingToken ? 'sell' : 'buy',
          quoteAmountRaw: BigInt(quoteAmount),
          canonical: swap.canonical,
        },
      ];
    });
  }

  private mapLaunchpadTrades(
    trades: readonly (typeof schema.launchpadTrades.$inferSelect)[],
    blockTimes: ReadonlyMap<string, Date>,
  ): DiscoveryTrade[] {
    return trades.flatMap((trade) => {
      const timestamp = blockTimes.get(trade.block_number.toString());
      if (timestamp === undefined) return [];
      return [
        {
          transactionHash: hash(trade.transaction_hash),
          blockNumber: trade.block_number,
          blockHash: hash(trade.block_hash),
          logIndex: trade.log_index,
          timestamp: timestamp.toISOString(),
          senderAddress: getAddress(trade.trader_address),
          recipientAddress: null,
          traderAddress: getAddress(trade.trader_address),
          counterpartyAddress: getAddress(trade.bonding_curve_address),
          side: trade.side,
          quoteAmountRaw: BigInt(trade.payment_amount_raw),
          canonical: trade.canonical,
        },
      ];
    });
  }

  private async loadProject(chainId: number, tokenAddress: string) {
    const [project] = await this.db
      .select({
        projectName: schema.projectProfiles.projectName,
        slug: schema.projectProfiles.slug,
        verified: schema.projectProfiles.verified,
        verifiedAt: schema.projectProfiles.verifiedAt,
      })
      .from(schema.projectContracts)
      .innerJoin(
        schema.projectProfiles,
        eq(schema.projectContracts.projectProfileId, schema.projectProfiles.id),
      )
      .where(
        and(
          eq(schema.projectContracts.chainId, chainId),
          eq(schema.projectContracts.contractAddress, tokenAddress),
          isNull(schema.projectProfiles.deletedAt),
        ),
      )
      .orderBy(desc(schema.projectProfiles.verifiedAt))
      .limit(1);
    return project;
  }

  private async loadRisk(
    chainId: number,
    tokenAddress: string,
    sourceBlock: bigint,
  ): Promise<{
    grade: RiskGrade;
    completenessBps: bigint | null;
    lastScannedAt: string | null;
    latestCriticalFindingAt: string | null;
    dataWarnings: readonly string[];
  }> {
    const [score] = await this.db
      .select({
        grade: schema.riskScores.grade,
        completeness: schema.riskScores.completenessPercent,
        completedAt: schema.riskScanRuns.completedAt,
        dataWarnings: schema.riskScores.unresolvedDataWarnings,
      })
      .from(schema.riskScanRuns)
      .innerJoin(schema.riskScores, eq(schema.riskScores.scanRunId, schema.riskScanRuns.id))
      .where(
        and(
          eq(schema.riskScanRuns.chainId, chainId),
          eq(schema.riskScanRuns.targetAddress, tokenAddress),
          inArray(schema.riskScanRuns.status, ['completed', 'partial']),
          eq(schema.riskScanRuns.canonical, true),
          lte(schema.riskScanRuns.sourceBlock, sourceBlock),
        ),
      )
      .orderBy(desc(schema.riskScanRuns.completedAt))
      .limit(1);
    const [critical] = await this.db
      .select({ createdAt: schema.riskFindings.createdAt })
      .from(schema.riskFindings)
      .innerJoin(schema.riskScanRuns, eq(schema.riskFindings.scanRunId, schema.riskScanRuns.id))
      .where(
        and(
          eq(schema.riskScanRuns.chainId, chainId),
          eq(schema.riskScanRuns.targetAddress, tokenAddress),
          eq(schema.riskScanRuns.canonical, true),
          lte(schema.riskScanRuns.sourceBlock, sourceBlock),
          eq(schema.riskFindings.severity, 'critical'),
          eq(schema.riskFindings.suppressed, false),
        ),
      )
      .orderBy(desc(schema.riskFindings.createdAt))
      .limit(1);
    return {
      grade: score === undefined ? 'unavailable' : riskGradeSchema.parse(score.grade),
      completenessBps: score === undefined ? null : percentToBps(score.completeness),
      lastScannedAt: score?.completedAt?.toISOString() ?? null,
      latestCriticalFindingAt: critical?.createdAt.toISOString() ?? null,
      dataWarnings: score === undefined ? [] : stringArraySchema.parse(score.dataWarnings),
    };
  }

  private async loadDeployerEvidence(
    chainId: number,
    deployer: string | null,
  ): Promise<readonly string[]> {
    if (deployer === null) return [];
    const labels = await this.db
      .select({
        labelType: schema.maliciousAddressLabels.labelType,
        labelSource: schema.maliciousAddressLabels.labelSource,
        confidence: schema.maliciousAddressLabels.confidence,
      })
      .from(schema.maliciousAddressLabels)
      .where(
        and(
          eq(schema.maliciousAddressLabels.chainId, chainId),
          eq(schema.maliciousAddressLabels.address, deployer.toLowerCase()),
        ),
      );
    return labels
      .map((label) => `${label.labelType}:${label.labelSource}:${label.confidence}`)
      .sort();
  }
}
