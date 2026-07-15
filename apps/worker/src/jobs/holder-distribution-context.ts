import {
  HOLDER_BALANCES_SOURCE,
  type HolderClassification,
  type RiskDataSource,
  type RiskScanContext,
  analyzeHolders,
} from '@hood-sentry/risk-engine';
import { getAddress } from 'viem';
import type { RiskContextLoader, RiskScanJobInput } from './risk-scan.js';

/** Burn sinks whose balances are never part of circulating supply. */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';

export interface IndexedBalance {
  address: `0x${string}`;
  balanceRaw: bigint;
  /** Block at which this balance was last written by the indexer. */
  asOfBlock: bigint;
}

/**
 * The narrow slice of storage the holder context needs. Kept as a port so the
 * pinning and availability logic can be tested without a database.
 */
export interface HolderBalanceSource {
  /** Every positive balance recorded for the token. */
  listBalances(chainId: number, tokenAddress: string): Promise<readonly IndexedBalance[]>;
  /** Highest block at or below `atBlock` carrying a transfer of the token, if any. */
  latestTransferBlock(
    chainId: number,
    tokenAddress: string,
    atBlock: bigint,
  ): Promise<bigint | null>;
  /** Total supply if it has been established, otherwise null. */
  totalSupply(chainId: number, tokenAddress: string): Promise<bigint | null>;
  /** Canonical pool addresses holding the token, which are not insider positions. */
  listPoolAddresses(chainId: number, tokenAddress: string): Promise<readonly `0x${string}`[]>;
}

type Availability = { status: RiskDataSource['status']; reason: string | null };

/**
 * Decides whether the recorded balances describe the token at the scan block.
 *
 * The balance table holds current state, not history, so it is only pinned to the
 * scan block when the indexer has carried it that far and no later transfer has
 * moved it. Anything else is reported as not available rather than scored.
 */
export function balanceAvailability(input: {
  balances: readonly IndexedBalance[];
  latestTransferBlock: bigint | null;
  sourceBlock: bigint;
}): Availability {
  if (input.balances.length === 0) {
    // An unindexed token has no holders on record. That is not the same as a token
    // with no holders, and must never be scored as though the distribution were flat.
    return { status: 'unavailable', reason: 'HOLDER_BALANCES_NOT_INDEXED' };
  }

  const highestAsOf = input.balances.reduce(
    (highest, balance) => (balance.asOfBlock > highest ? balance.asOfBlock : highest),
    0n,
  );

  if (highestAsOf > input.sourceBlock) {
    // Balances written past the scan block describe a different chain state.
    return { status: 'error', reason: 'HOLDER_BALANCES_AHEAD_OF_SCAN_BLOCK' };
  }

  if (input.latestTransferBlock !== null && input.latestTransferBlock > highestAsOf) {
    // Transfers landed between the last balance write and the scan block, so the
    // recorded balances are known to be out of date at this block.
    return { status: 'stale', reason: 'HOLDER_BALANCES_BEHIND_SCAN_BLOCK' };
  }

  return { status: 'available', reason: null };
}

/**
 * Addresses whose holdings are structural rather than insider positions. Excluding
 * them is what makes adjusted concentration mean "supply a few people control":
 * without this, every token with a liquidity pool would look concentrated.
 */
function classifications(poolAddresses: readonly `0x${string}`[]): HolderClassification[] {
  const burns: HolderClassification[] = [ZERO_ADDRESS, DEAD_ADDRESS].map((address) => ({
    address: getAddress(address),
    addressClass: 'zero_burn',
    verified: true,
    reason: 'Burn sink',
    provenance: 'protocol_constant',
  }));

  const pools: HolderClassification[] = poolAddresses.map((address) => ({
    address: getAddress(address),
    addressClass: 'pool',
    verified: true,
    reason: 'Indexed canonical pool for this token',
    provenance: 'indexed_pool_registry',
  }));

  return [...burns, ...pools];
}

function dataSource(context: RiskScanContext, availability: Availability): RiskDataSource {
  return {
    key: HOLDER_BALANCES_SOURCE,
    kind: 'chain',
    provider: 'hood_sentry_indexer',
    status: availability.status,
    sourceBlock: context.sourceBlock,
    sourceBlockHash: context.sourceBlockHash,
    fetchedAt: null,
    reason: availability.reason,
  };
}

function mergeSources(
  current: readonly RiskDataSource[],
  addition: RiskDataSource,
): RiskDataSource[] {
  const sources = new Map(current.map((source) => [source.key, source]));
  sources.set(addition.key, addition);
  return [...sources.values()].sort((left, right) => left.key.localeCompare(right.key));
}

const HOLDER_TARGETS = new Set(['token', 'launchpad_token']);

/**
 * Supplies the pinned holder snapshot the holder distribution rules consume.
 *
 * The snapshot is only marked available when the recorded balances demonstrably
 * describe the token at the scan block; otherwise the rules report unknown and the
 * scan is reported as incomplete.
 */
export class HolderDistributionContextLoader implements RiskContextLoader {
  constructor(
    private readonly baseLoader: RiskContextLoader,
    private readonly source: HolderBalanceSource,
  ) {}

  async loadContext(input: RiskScanJobInput, methodologyVersion: string): Promise<RiskScanContext> {
    const context = await this.baseLoader.loadContext(input, methodologyVersion);
    if (!HOLDER_TARGETS.has(context.target.type)) return context;

    const { chainId, address } = context.target;
    const balances = await this.source.listBalances(chainId, address);
    const latestTransferBlock = await this.source.latestTransferBlock(
      chainId,
      address,
      context.sourceBlock,
    );
    const availability = balanceAvailability({
      balances,
      latestTransferBlock,
      sourceBlock: context.sourceBlock,
    });

    if (availability.status !== 'available') {
      // Nothing trustworthy to analyse: leave the data absent and let the declared
      // source status drive the rules to unknown.
      return {
        ...context,
        dataSources: mergeSources(context.dataSources, dataSource(context, availability)),
      };
    }

    const [totalSupplyRaw, poolAddresses] = await Promise.all([
      this.source.totalSupply(chainId, address),
      this.source.listPoolAddresses(chainId, address),
    ]);

    const holderAnalysis = analyzeHolders({
      chainId,
      tokenAddress: getAddress(address),
      sourceBlock: context.sourceBlock,
      sourceBlockHash: context.sourceBlockHash as `0x${string}`,
      totalSupplyRaw,
      balances: balances.map((balance) => ({
        address: getAddress(balance.address),
        balanceRaw: balance.balanceRaw,
      })),
      classifications: classifications(poolAddresses),
      methodologyVersion,
    });

    return {
      ...context,
      data: { ...context.data, holderAnalysis },
      dataSources: mergeSources(context.dataSources, dataSource(context, availability)),
    };
  }
}
