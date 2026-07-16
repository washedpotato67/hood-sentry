import { type Database, DrizzlePricingRepository, schema } from '@hood-sentry/db';
import {
  type DiscoveryTrade,
  type ManipulationContext,
  analyzeManipulation,
} from '@hood-sentry/discovery-engine';
import {
  type OutlierInput,
  type PriceObservation,
  type PriceSourceConfig,
  detectOutliers,
  selectPriceSource,
} from '@hood-sentry/market-engine';
import {
  MARKET_INTEGRITY_SIGNAL_CODES,
  MARKET_PRICE_RELIABILITY_SOURCE,
  MARKET_TRADE_MANIPULATION_SOURCE,
  type MarketIntegrityResult,
  type RiskScanContext,
  serializeMarketIntegrityResult,
} from '@hood-sentry/risk-engine';
import { and, asc, desc, eq, isNotNull, lte, or } from 'drizzle-orm';
import { type Address, type Hash, getAddress, isAddress, isHash } from 'viem';
import { z } from 'zod';
import type { RiskContextLoader, RiskScanJobInput } from './risk-scan.js';

export const MARKET_MIN_TRADES_FOR_MANIPULATION = 20;

const SIGNAL_CODE_SET = new Set<string>(MARKET_INTEGRITY_SIGNAL_CODES);

export interface MarketIntegrityInputs {
  sourceBlock: bigint;
  priceAvailable: boolean;
  activeSourceCount: number;
  disagreementWarnings: readonly string[];
  outlierReasons: readonly string[];
  primaryReasons: readonly string[];
  tradesAvailable: boolean;
  tradeCount: number;
  manipulation: {
    methodologyVersion: string;
    signals: readonly { code: string; status: string }[];
  };
}

/**
 * Pure mapping from the raw pinned price-selection/outlier/manipulation outputs
 * into the risk engine's MarketIntegrityResult. No DB access, so it is exercised
 * directly by a unit test.
 */
export function buildMarketIntegrityResult(input: MarketIntegrityInputs): MarketIntegrityResult {
  const disagreementSourceKeys = input.disagreementWarnings
    .map((w) => w.split(':')[1])
    .filter((k): k is string => k !== undefined && k.length > 0);
  const observedSignalCodes = input.manipulation.signals
    .filter((s) => s.status === 'observed' && SIGNAL_CODE_SET.has(s.code))
    .map((s) => s.code);
  const insufficientSignalCodes = input.manipulation.signals
    .filter((s) => s.status === 'insufficientData' && SIGNAL_CODE_SET.has(s.code))
    .map((s) => s.code);
  return {
    priceReliability: {
      available: input.priceAvailable,
      activeSourceCount: input.activeSourceCount,
      disagreementSourceKeys,
      outlierReasons: [...input.outlierReasons],
      oneTransactionManipulation: input.primaryReasons.includes('ONE_TRANSACTION_MANIPULATION'),
    },
    tradeManipulation: {
      available: input.tradesAvailable,
      tradeCount: input.tradeCount,
      minTradesForAssessment: MARKET_MIN_TRADES_FOR_MANIPULATION,
      observedSignalCodes,
      insufficientSignalCodes,
      methodologyVersion: input.manipulation.methodologyVersion,
    },
    sourceBlock: input.sourceBlock,
  };
}

export interface MarketDataSource {
  load(input: {
    chainId: number;
    tokenAddress: string;
    sourceBlock: bigint;
  }): Promise<MarketIntegrityInputs>;
}

/**
 * Appends the pinned market-integrity result (price-source reliability and
 * trade-manipulation signals) to the risk context so the market integrity rule
 * family has evidence to evaluate. Applies unconditionally: for targets that
 * have no configured price sources or trade activity, the underlying source
 * simply reports `priceAvailable`/`tradesAvailable` false-or-empty, which the
 * rules already resolve to `unknown`/`not_applicable`.
 */
export class MarketIntegrityContextLoader implements RiskContextLoader {
  constructor(
    private readonly inner: RiskContextLoader,
    private readonly source: MarketDataSource,
  ) {}

  async loadContext(input: RiskScanJobInput, methodologyVersion: string): Promise<RiskScanContext> {
    const context = await this.inner.loadContext(input, methodologyVersion);
    const inputs = await this.source.load({
      chainId: input.target.chainId,
      tokenAddress: input.target.address,
      sourceBlock: context.sourceBlock,
    });
    const serialized = serializeMarketIntegrityResult(buildMarketIntegrityResult(inputs));
    const provenance = (key: string, available: boolean) => ({
      key,
      kind: 'database' as const,
      provider: 'market_engine',
      status: (available ? 'available' : 'unavailable') as 'available' | 'unavailable',
      sourceBlock: context.sourceBlock,
      sourceBlockHash: context.sourceBlockHash,
      fetchedAt: new Date().toISOString(),
      reason: available ? null : 'market data unavailable at pinned block',
    });
    return {
      ...context,
      data: {
        ...context.data,
        [MARKET_PRICE_RELIABILITY_SOURCE]: serialized,
        [MARKET_TRADE_MANIPULATION_SOURCE]: serialized,
      },
      dataSources: [
        ...context.dataSources.filter(
          (existing) =>
            existing.key !== MARKET_PRICE_RELIABILITY_SOURCE &&
            existing.key !== MARKET_TRADE_MANIPULATION_SOURCE,
        ),
        provenance(MARKET_PRICE_RELIABILITY_SOURCE, inputs.priceAvailable),
        provenance(MARKET_TRADE_MANIPULATION_SOURCE, inputs.tradesAvailable),
      ],
    };
  }
}

// ─── DrizzleMarketDataSource ────────────────────────────────────────────────

const OBSERVATION_SOURCE_TYPE = z.enum([
  'chainlink',
  'launchpadBondingCurve',
  'stablecoinPool',
  'wethRoute',
  'directDex',
  'multihop',
  'externalProvider',
  'unavailable',
]);
const OBSERVATION_STATUS = z.enum(['available', 'lowConfidence', 'unavailable']);
const OBSERVATION_ROUTE = z.array(
  z.object({
    protocolKey: z.string(),
    protocolVersion: z.string(),
    poolAddress: z.string().transform((value) => getAddress(value)),
    inputTokenAddress: z.string().transform((value) => getAddress(value)),
    outputTokenAddress: z.string().transform((value) => getAddress(value)),
  }),
);
const OBSERVATION_REASONS = z.array(z.string());

type ObservationRow = typeof schema.deterministicPriceObservations.$inferSelect;

function toHash(value: string): Hash {
  if (!isHash(value)) throw new Error('MARKET_INTEGRITY_MALFORMED_HASH');
  return value;
}

function toHashOrNull(value: string | null): Hash | null {
  return value === null ? null : toHash(value);
}

function toBigintOrNull(value: string | null): bigint | null {
  return value === null ? null : BigInt(value);
}

function toPriceObservation(row: ObservationRow): PriceObservation {
  return {
    observationKey: row.observation_key,
    chainId: row.chain_id,
    tokenAddress: getAddress(row.token_address),
    quoteAssetAddress: getAddress(row.quote_asset_address),
    sourceKey: row.source_key,
    sourceType: OBSERVATION_SOURCE_TYPE.parse(row.source_type),
    sourceContractAddress:
      row.source_contract_address === null ? null : getAddress(row.source_contract_address),
    providerName: row.provider_name,
    poolAddress: row.pool_address === null ? null : getAddress(row.pool_address),
    route: OBSERVATION_ROUTE.parse(row.route),
    priceRaw: toBigintOrNull(row.price_raw),
    priceDecimals: row.price_decimals,
    sourceBlockNumber: row.source_block_number,
    sourceBlockHash: toHashOrNull(row.source_block_hash),
    sourceTimestamp: row.source_timestamp.toISOString(),
    observedAt: row.observed_at.toISOString(),
    liquidityDepthRaw: toBigintOrNull(row.liquidity_depth_raw),
    liquidityDepthDecimals: row.liquidity_depth_decimals,
    priceImpactBps: toBigintOrNull(row.price_impact_bps),
    singleTransactionVolumeBps: toBigintOrNull(row.single_transaction_volume_bps),
    confidenceBps: BigInt(row.confidence_bps),
    stale: row.stale,
    status: OBSERVATION_STATUS.parse(row.status),
    authoritative: row.authoritative,
    reasons: OBSERVATION_REASONS.parse(row.reasons),
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

/**
 * The Drizzle-backed MarketDataSource: reads the pinned price-source configs and
 * their most recent observation at or before the scan's pinned block, runs
 * selectPriceSource + detectOutliers over them, and separately reads pinned
 * swaps for the token and runs analyzeManipulation.
 *
 * detectThinPool is fed the selected observation's real `liquidityDepthRaw`
 * and the matching source config's `minimumLiquidityRaw`, so it is assessable
 * whenever a price source was selected. When no observation is selected at
 * all (`priceAvailable` is false), liquidityRaw stays null and the signal
 * legitimately reports `insufficientData`.
 *
 * Scope notes (documented rather than guessed): sybil wallet clustering is
 * not recomputed here -- it belongs to the discovery pipeline.
 * detectSybilClusters therefore always reports `insufficientData` from this
 * loader (sybilClusterWallets: []), which is safe: it never fabricates an
 * "observed" manipulation signal, and the risk rules already resolve
 * missing-data cases to `unknown`/`not_applicable`.
 */
export class DrizzleMarketDataSource implements MarketDataSource {
  constructor(private readonly database: Database) {}

  async load(input: {
    chainId: number;
    tokenAddress: string;
    sourceBlock: bigint;
  }): Promise<MarketIntegrityInputs> {
    const tokenAddress = getAddress(input.tokenAddress);
    const observedAt = await this.pinnedBlockTimestamp(input.chainId, input.sourceBlock);

    const priceRepository = new DrizzlePricingRepository(this.database.db);
    const allConfigs = await priceRepository.listSourceConfigs(input.chainId, tokenAddress);
    const enabledConfigs = allConfigs.filter((config) => config.enabled);

    const observations: PriceObservation[] = [];
    for (const config of enabledConfigs) {
      const observation = await this.pinnedObservation(
        input.chainId,
        tokenAddress,
        config,
        input.sourceBlock,
      );
      if (observation !== null) observations.push(observation);
    }

    const priceAvailable = observations.length > 0;
    let disagreementWarnings: readonly string[] = [];
    let outlierReasons: readonly string[] = [];
    let primaryReasons: readonly string[] = [];
    let priceImpactBps: bigint | null = null;
    let liquidityRaw: bigint | null = null;
    let minimumHealthyLiquidityRaw = 0n;

    if (priceAvailable) {
      const selection = selectPriceSource(enabledConfigs, observations, observedAt);
      disagreementWarnings = selection.disagreementWarnings;
      primaryReasons = selection.selected.reasons;
      priceImpactBps = selection.selected.priceImpactBps;
      liquidityRaw = selection.selected.liquidityDepthRaw;
      const selectedConfig = enabledConfigs.find(
        (config) => config.sourceKey === selection.selected.sourceKey,
      );
      if (selectedConfig !== undefined)
        minimumHealthyLiquidityRaw = selectedConfig.minimumLiquidityRaw;
      const outlierInput: OutlierInput = {
        observation: selection.selected,
        previousPriceRaw: null,
        stablecoinTargetRaw: null,
        windowVolumeRaw: null,
        previousWindowVolumeRaw: null,
        walletVolumeRaw: null,
        postGraduationDexPriceRaw: null,
      };
      outlierReasons = detectOutliers(outlierInput).reasons;
    }

    const trades = await this.pinnedTrades(input.chainId, tokenAddress, input.sourceBlock);
    const manipulationContext: ManipulationContext = {
      liquidityRaw,
      minimumHealthyLiquidityRaw,
      tinyTradeThresholdRaw: 0n,
      priceImpactBps,
      sybilClusterWallets: [],
      launchpad: false,
    };
    const manipulation = analyzeManipulation(trades, manipulationContext);

    return {
      sourceBlock: input.sourceBlock,
      priceAvailable,
      activeSourceCount: observations.length,
      disagreementWarnings,
      outlierReasons,
      primaryReasons,
      tradesAvailable: true,
      tradeCount: trades.length,
      manipulation: {
        methodologyVersion: manipulation.methodologyVersion,
        signals: manipulation.signals,
      },
    };
  }

  private async pinnedBlockTimestamp(chainId: number, blockNumber: bigint): Promise<string> {
    const rows = await this.database.db
      .select({ timestamp: schema.blocks.timestamp })
      .from(schema.blocks)
      .where(
        and(
          eq(schema.blocks.chainId, BigInt(chainId)),
          eq(schema.blocks.number, blockNumber),
          eq(schema.blocks.canonical, true),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) throw new Error('MARKET_INTEGRITY_SOURCE_BLOCK_NOT_CANONICAL');
    return row.timestamp.toISOString();
  }

  private async pinnedObservation(
    chainId: number,
    tokenAddress: Address,
    config: PriceSourceConfig,
    sourceBlock: bigint,
  ): Promise<PriceObservation | null> {
    const rows = await this.database.db
      .select()
      .from(schema.deterministicPriceObservations)
      .where(
        and(
          eq(schema.deterministicPriceObservations.chain_id, chainId),
          eq(schema.deterministicPriceObservations.token_address, tokenAddress.toLowerCase()),
          eq(
            schema.deterministicPriceObservations.quote_asset_address,
            config.quoteAssetAddress.toLowerCase(),
          ),
          eq(schema.deterministicPriceObservations.source_key, config.sourceKey),
          eq(schema.deterministicPriceObservations.canonical, true),
          isNotNull(schema.deterministicPriceObservations.price_raw),
          isNotNull(schema.deterministicPriceObservations.source_block_number),
          lte(schema.deterministicPriceObservations.source_block_number, sourceBlock),
        ),
      )
      .orderBy(
        desc(schema.deterministicPriceObservations.source_block_number),
        desc(schema.deterministicPriceObservations.observed_at),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toPriceObservation(row);
  }

  private async pinnedTrades(
    chainId: number,
    tokenAddress: Address,
    sourceBlock: bigint,
  ): Promise<readonly DiscoveryTrade[]> {
    const tokenKey = tokenAddress.toLowerCase();
    const rows = await this.database.db
      .select({
        transactionHash: schema.swaps.transaction_hash,
        blockNumber: schema.swaps.block_number,
        blockHash: schema.swaps.block_hash,
        logIndex: schema.swaps.log_index,
        senderAddress: schema.swaps.sender_address,
        recipientAddress: schema.swaps.recipient_address,
        tokenInAddress: schema.swaps.token_in_address,
        tokenOutAddress: schema.swaps.token_out_address,
        amountInRaw: schema.swaps.amount_in_raw,
        amountOutRaw: schema.swaps.amount_out_raw,
        canonical: schema.swaps.canonical,
        timestamp: schema.blocks.timestamp,
      })
      .from(schema.swaps)
      .innerJoin(
        schema.blocks,
        and(
          eq(schema.blocks.chainId, BigInt(chainId)),
          eq(schema.blocks.number, schema.swaps.block_number),
          eq(schema.blocks.hash, schema.swaps.block_hash),
          eq(schema.blocks.canonical, true),
        ),
      )
      .where(
        and(
          eq(schema.swaps.chain_id, chainId),
          eq(schema.swaps.canonical, true),
          lte(schema.swaps.block_number, sourceBlock),
          or(
            eq(schema.swaps.token_in_address, tokenKey),
            eq(schema.swaps.token_out_address, tokenKey),
          ),
        ),
      )
      .orderBy(asc(schema.swaps.block_number), asc(schema.swaps.log_index));

    return rows.flatMap((row): readonly DiscoveryTrade[] => {
      const trader = row.senderAddress ?? row.recipientAddress;
      if (trader === null || !isAddress(trader)) return [];
      const isSell = row.tokenInAddress.toLowerCase() === tokenKey;
      const quoteAmountRaw = BigInt(isSell ? row.amountOutRaw : row.amountInRaw);
      const counterpartyAddress =
        row.senderAddress !== null && row.recipientAddress !== null
          ? getAddress(row.recipientAddress)
          : null;
      return [
        {
          transactionHash: toHash(row.transactionHash),
          blockNumber: row.blockNumber,
          blockHash: toHash(row.blockHash),
          logIndex: row.logIndex,
          timestamp: row.timestamp.toISOString(),
          senderAddress: row.senderAddress === null ? null : getAddress(row.senderAddress),
          recipientAddress: row.recipientAddress === null ? null : getAddress(row.recipientAddress),
          traderAddress: getAddress(trader),
          counterpartyAddress,
          side: isSell ? 'sell' : 'buy',
          quoteAmountRaw,
          canonical: row.canonical,
        },
      ];
    });
  }
}
