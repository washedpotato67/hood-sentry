import { randomUUID } from 'node:crypto';
import { canonicalAssetRegistry } from '@hood-sentry/chain';
import { schema } from '@hood-sentry/db';
import type { DerivedJobPayload } from '@hood-sentry/queue';
import { and, asc, desc, eq, lte, or } from 'drizzle-orm';
import { getAddress, isAddress, isHash } from 'viem';
import { z } from 'zod';
import type { ProcessorContext } from './types.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const METHODOLOGY = 'fifo-canonical-swaps-and-transfers-v1';
const LOT_METHODOLOGY = 'fifo';

const addressSchema = z
  .string()
  .refine(isAddress, 'expected a 20-byte address')
  .transform((value) => getAddress(value));
const hashSchema = z.string().refine(isHash, 'expected a 32-byte hash');
const baseEventSchema = z.object({
  transactionHash: hashSchema,
  logIndex: z.number().int().nonnegative(),
  eventType: z.enum(['swap', 'tokenTransfer']),
});
const swapEventSchema = baseEventSchema.extend({
  eventType: z.literal('swap'),
  poolAddress: addressSchema,
});
const transferEventSchema = baseEventSchema.extend({
  eventType: z.literal('tokenTransfer'),
  tokenAddress: addressSchema,
  fromAddress: addressSchema,
  toAddress: addressSchema,
});
const walletEventSchema = z.discriminatedUnion('eventType', [swapEventSchema, transferEventSchema]);

type ProjectionTarget = {
  walletAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  quoteAddress: `0x${string}`;
};

type TradeRow = {
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  senderAddress: string | null;
  recipientAddress: string | null;
  tokenInAddress: string;
  tokenOutAddress: string;
  amountInRaw: string;
  amountOutRaw: string;
};

type TransferRow = {
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
};

type Lot = {
  acquisitionTxHash: string;
  acquisitionBlock: bigint;
  acquisitionBlockHash: string;
  acquisitionLogIndex: number;
  amountRaw: bigint;
  remainingAmountRaw: bigint;
  totalCostRaw: bigint | null;
};

type CashFlow = {
  transactionHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  flowType: 'inflow' | 'outflow';
  amountRaw: bigint;
};

function canonicalQuoteAddresses(chainId: number): readonly `0x${string}`[] {
  return canonicalAssetRegistry.entries
    .filter((entry) => entry.chainId === chainId && entry.enabled)
    .sort((left, right) => {
      const rank = (key: string) => (key === 'usdg' ? 0 : key === 'weth' ? 1 : 2);
      return rank(left.key) - rank(right.key);
    })
    .map((entry) => entry.address);
}

function pairForSwap(
  chainId: number,
  tokenInAddress: string,
  tokenOutAddress: string,
): { tokenAddress: `0x${string}`; quoteAddress: `0x${string}` } | null {
  const quotes = new Set(canonicalQuoteAddresses(chainId).map((address) => address.toLowerCase()));
  const tokenIn = getAddress(tokenInAddress);
  const tokenOut = getAddress(tokenOutAddress);
  const inputIsQuote = quotes.has(tokenIn.toLowerCase());
  const outputIsQuote = quotes.has(tokenOut.toLowerCase());
  if (inputIsQuote === outputIsQuote) return null;
  return inputIsQuote
    ? { tokenAddress: tokenOut, quoteAddress: tokenIn }
    : { tokenAddress: tokenIn, quoteAddress: tokenOut };
}

function walletForTrade(
  trade: Pick<TradeRow, 'tokenInAddress' | 'senderAddress' | 'recipientAddress'>,
  quoteAddress: `0x${string}`,
): `0x${string}` | null {
  const value =
    trade.tokenInAddress.toLowerCase() === quoteAddress.toLowerCase()
      ? (trade.recipientAddress ?? trade.senderAddress)
      : (trade.senderAddress ?? trade.recipientAddress);
  return value !== null && isAddress(value) ? getAddress(value) : null;
}

async function quoteForToken(
  context: Pick<ProcessorContext, 'database'>,
  chainId: number,
  tokenAddress: `0x${string}`,
): Promise<`0x${string}` | null> {
  const quotes = canonicalQuoteAddresses(chainId);
  for (const quote of quotes) {
    const rows = await context.database.db
      .select({ address: schema.pools.address })
      .from(schema.pools)
      .innerJoin(schema.dexProtocols, eq(schema.pools.protocol_id, schema.dexProtocols.id))
      .where(
        and(
          eq(schema.pools.chain_id, chainId),
          eq(schema.pools.canonical, true),
          eq(schema.pools.active, true),
          eq(schema.dexProtocols.enabled, true),
          eq(schema.dexProtocols.validation_status, 'active'),
          or(
            and(
              eq(schema.pools.token0_address, tokenAddress.toLowerCase()),
              eq(schema.pools.token1_address, quote.toLowerCase()),
            ),
            and(
              eq(schema.pools.token0_address, quote.toLowerCase()),
              eq(schema.pools.token1_address, tokenAddress.toLowerCase()),
            ),
          ),
        ),
      )
      .limit(1);
    if (rows[0] !== undefined) return quote;
  }
  return null;
}

async function targetsForEvent(
  payload: DerivedJobPayload,
  context: Pick<ProcessorContext, 'database'>,
): Promise<readonly ProjectionTarget[]> {
  const data = walletEventSchema.parse(payload.data);
  const chainId = z.coerce.number().int().positive().safe().parse(payload.chainId);
  const blockNumber = z.coerce.bigint().nonnegative().parse(payload.blockNumber);
  if (data.eventType === 'swap') {
    const rows = await context.database.db
      .select()
      .from(schema.swaps)
      .where(
        and(
          eq(schema.swaps.chain_id, chainId),
          eq(schema.swaps.block_number, blockNumber),
          eq(schema.swaps.block_hash, payload.blockHash.toLowerCase()),
          eq(schema.swaps.transaction_hash, data.transactionHash.toLowerCase()),
          eq(schema.swaps.log_index, data.logIndex),
          eq(schema.swaps.pool_address, data.poolAddress.toLowerCase()),
          eq(schema.swaps.canonical, true),
        ),
      )
      .limit(1);
    const trade = rows[0];
    if (trade === undefined) throw new Error('CANONICAL_SWAP_NOT_READY_FOR_WALLET_PROJECTION');
    const pair = pairForSwap(chainId, trade.token_in_address, trade.token_out_address);
    if (pair === null) return [];
    const walletAddress = walletForTrade(
      {
        tokenInAddress: trade.token_in_address,
        senderAddress: trade.sender_address,
        recipientAddress: trade.recipient_address,
      },
      pair.quoteAddress,
    );
    return walletAddress === null ? [] : [{ walletAddress, ...pair }];
  }

  const transferRows = await context.database.db
    .select({ transactionHash: schema.tokenTransfers.transaction_hash })
    .from(schema.tokenTransfers)
    .where(
      and(
        eq(schema.tokenTransfers.chain_id, chainId),
        eq(schema.tokenTransfers.block_number, blockNumber),
        eq(schema.tokenTransfers.block_hash, payload.blockHash.toLowerCase()),
        eq(schema.tokenTransfers.transaction_hash, data.transactionHash.toLowerCase()),
        eq(schema.tokenTransfers.log_index, data.logIndex),
        eq(schema.tokenTransfers.token_address, data.tokenAddress.toLowerCase()),
        eq(schema.tokenTransfers.canonical, true),
      ),
    )
    .limit(1);
  if (transferRows[0] === undefined) {
    throw new Error('CANONICAL_TRANSFER_NOT_READY_FOR_WALLET_PROJECTION');
  }
  const quoteAddress = await quoteForToken(context, chainId, data.tokenAddress);
  if (quoteAddress === null) return [];
  const wallets = [data.fromAddress, data.toAddress]
    .filter((address) => address.toLowerCase() !== ZERO_ADDRESS)
    .filter((address, index, values) => values.indexOf(address) === index);
  return wallets.map((walletAddress) => ({
    walletAddress,
    tokenAddress: data.tokenAddress,
    quoteAddress,
  }));
}

function consumeLots(lots: Lot[], amountRaw: bigint): { costRaw: bigint; complete: boolean } {
  let remaining = amountRaw;
  let costRaw = 0n;
  let complete = true;
  for (const lot of lots) {
    if (remaining === 0n) break;
    if (lot.remainingAmountRaw === 0n) continue;
    const used = remaining < lot.remainingAmountRaw ? remaining : lot.remainingAmountRaw;
    if (lot.totalCostRaw === null) {
      complete = false;
    } else {
      costRaw += (lot.totalCostRaw * used) / lot.amountRaw;
    }
    lot.remainingAmountRaw -= used;
    remaining -= used;
  }
  return { costRaw, complete: complete && remaining === 0n };
}

async function projectTarget(
  payload: DerivedJobPayload,
  context: Pick<ProcessorContext, 'database'>,
  target: ProjectionTarget,
): Promise<void> {
  const chainId = z.coerce.number().int().positive().safe().parse(payload.chainId);
  const requestedBlock = z.coerce.bigint().nonnegative().parse(payload.blockNumber);
  const walletKey = target.walletAddress.toLowerCase();
  const tokenKey = target.tokenAddress.toLowerCase();
  const quoteKey = target.quoteAddress.toLowerCase();
  const trades = await context.database.db
    .select({
      blockNumber: schema.swaps.block_number,
      blockHash: schema.swaps.block_hash,
      transactionHash: schema.swaps.transaction_hash,
      logIndex: schema.swaps.log_index,
      senderAddress: schema.swaps.sender_address,
      recipientAddress: schema.swaps.recipient_address,
      tokenInAddress: schema.swaps.token_in_address,
      tokenOutAddress: schema.swaps.token_out_address,
      amountInRaw: schema.swaps.amount_in_raw,
      amountOutRaw: schema.swaps.amount_out_raw,
    })
    .from(schema.swaps)
    .innerJoin(
      schema.pools,
      and(
        eq(schema.swaps.chain_id, schema.pools.chain_id),
        eq(schema.swaps.pool_address, schema.pools.address),
      ),
    )
    .innerJoin(schema.dexProtocols, eq(schema.pools.protocol_id, schema.dexProtocols.id))
    .where(
      and(
        eq(schema.swaps.chain_id, chainId),
        eq(schema.swaps.canonical, true),
        eq(schema.pools.canonical, true),
        eq(schema.pools.active, true),
        eq(schema.dexProtocols.enabled, true),
        eq(schema.dexProtocols.validation_status, 'active'),
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
    )
    .orderBy(asc(schema.swaps.block_number), asc(schema.swaps.log_index));
  const walletTrades = trades.filter(
    (trade) => walletForTrade(trade, target.quoteAddress)?.toLowerCase() === walletKey,
  );
  const transfers = await context.database.db
    .select({
      blockNumber: schema.tokenTransfers.block_number,
      blockHash: schema.tokenTransfers.block_hash,
      transactionHash: schema.tokenTransfers.transaction_hash,
      logIndex: schema.tokenTransfers.log_index,
      fromAddress: schema.tokenTransfers.from_address,
      toAddress: schema.tokenTransfers.to_address,
      amountRaw: schema.tokenTransfers.amount_raw,
    })
    .from(schema.tokenTransfers)
    .where(
      and(
        eq(schema.tokenTransfers.chain_id, chainId),
        eq(schema.tokenTransfers.token_address, tokenKey),
        eq(schema.tokenTransfers.canonical, true),
        or(
          eq(schema.tokenTransfers.from_address, walletKey),
          eq(schema.tokenTransfers.to_address, walletKey),
        ),
      ),
    )
    .orderBy(asc(schema.tokenTransfers.block_number), asc(schema.tokenTransfers.log_index));
  const projectionBlock = [...walletTrades, ...transfers].reduce(
    (highest, event) => (event.blockNumber > highest ? event.blockNumber : highest),
    requestedBlock,
  );
  const blocks = await context.database.db
    .select({ hash: schema.blocks.hash })
    .from(schema.blocks)
    .where(
      and(
        eq(schema.blocks.chainId, BigInt(chainId)),
        eq(schema.blocks.number, projectionBlock),
        eq(schema.blocks.canonical, true),
      ),
    )
    .limit(1);
  const sourceBlockHash = blocks[0]?.hash;
  if (sourceBlockHash === undefined) throw new Error('WALLET_PROJECTION_SOURCE_BLOCK_NOT_READY');

  const tokenRows = await context.database.db
    .select({ address: schema.tokens.address, decimals: schema.tokens.decimals })
    .from(schema.tokens)
    .where(
      and(
        eq(schema.tokens.chain_id, chainId),
        or(eq(schema.tokens.address, tokenKey), eq(schema.tokens.address, quoteKey)),
      ),
    );
  const decimals = new Map(tokenRows.map((row) => [row.address, row.decimals] as const));
  const tokenDecimals = decimals.get(tokenKey);
  const quoteDecimals = decimals.get(quoteKey);
  if (
    tokenDecimals === null ||
    tokenDecimals === undefined ||
    quoteDecimals === null ||
    quoteDecimals === undefined
  ) {
    throw new Error('WALLET_PROJECTION_TOKEN_METADATA_NOT_READY');
  }

  const tradeTransactions = new Set(walletTrades.map((trade) => trade.transactionHash));
  const events: Array<
    | { kind: 'buy'; row: TradeRow }
    | { kind: 'sell'; row: TradeRow }
    | { kind: 'transferIn'; row: TransferRow }
    | { kind: 'transferOut'; row: TransferRow }
  > = [];
  for (const trade of walletTrades) {
    events.push({
      kind: trade.tokenInAddress.toLowerCase() === quoteKey ? 'buy' : 'sell',
      row: trade,
    });
  }
  for (const transfer of transfers) {
    if (tradeTransactions.has(transfer.transactionHash)) continue;
    if (transfer.fromAddress.toLowerCase() === transfer.toAddress.toLowerCase()) continue;
    events.push({
      kind: transfer.toAddress.toLowerCase() === walletKey ? 'transferIn' : 'transferOut',
      row: transfer,
    });
  }
  events.sort((left, right) => {
    if (left.row.blockNumber !== right.row.blockNumber) {
      return left.row.blockNumber < right.row.blockNumber ? -1 : 1;
    }
    return left.row.logIndex - right.row.logIndex;
  });

  const lots: Lot[] = [];
  const cashFlows: CashFlow[] = [];
  const warnings = new Set<string>();
  let realizedPnlRaw: bigint | null = 0n;
  for (const event of events) {
    if (event.kind === 'buy') {
      const amountRaw = BigInt(event.row.amountOutRaw);
      const totalCostRaw = BigInt(event.row.amountInRaw);
      lots.push({
        acquisitionTxHash: event.row.transactionHash,
        acquisitionBlock: event.row.blockNumber,
        acquisitionBlockHash: event.row.blockHash,
        acquisitionLogIndex: event.row.logIndex,
        amountRaw,
        remainingAmountRaw: amountRaw,
        totalCostRaw,
      });
      cashFlows.push({
        transactionHash: event.row.transactionHash,
        logIndex: event.row.logIndex,
        blockNumber: event.row.blockNumber,
        blockHash: event.row.blockHash,
        flowType: 'outflow',
        amountRaw: totalCostRaw,
      });
      continue;
    }
    if (event.kind === 'transferIn') {
      const amountRaw = BigInt(event.row.amountRaw);
      lots.push({
        acquisitionTxHash: event.row.transactionHash,
        acquisitionBlock: event.row.blockNumber,
        acquisitionBlockHash: event.row.blockHash,
        acquisitionLogIndex: event.row.logIndex,
        amountRaw,
        remainingAmountRaw: amountRaw,
        totalCostRaw: null,
      });
      warnings.add('TRANSFER_IN_COST_BASIS_UNKNOWN');
      continue;
    }
    if (event.kind === 'sell') {
      const consumed = consumeLots(lots, BigInt(event.row.amountInRaw));
      if (!consumed.complete) {
        warnings.add('INCOMPLETE_ACQUISITION_HISTORY');
        realizedPnlRaw = null;
      }
      const proceedsRaw = BigInt(event.row.amountOutRaw);
      if (realizedPnlRaw !== null) realizedPnlRaw += proceedsRaw - consumed.costRaw;
      cashFlows.push({
        transactionHash: event.row.transactionHash,
        logIndex: event.row.logIndex,
        blockNumber: event.row.blockNumber,
        blockHash: event.row.blockHash,
        flowType: 'inflow',
        amountRaw: proceedsRaw,
      });
      continue;
    }
    const consumed = consumeLots(lots, BigInt(event.row.amountRaw));
    if (!consumed.complete) {
      warnings.add('INCOMPLETE_ACQUISITION_HISTORY');
      realizedPnlRaw = null;
    }
  }

  const remainingLots = lots.filter((lot) => lot.remainingAmountRaw > 0n);
  const hasUnknownCost = remainingLots.some((lot) => lot.totalCostRaw === null);
  if (hasUnknownCost) warnings.add('OPEN_LOT_COST_BASIS_UNKNOWN');
  const costBasisRaw = hasUnknownCost
    ? null
    : remainingLots.reduce(
        (total, lot) => total + ((lot.totalCostRaw ?? 0n) * lot.remainingAmountRaw) / lot.amountRaw,
        0n,
      );
  const balanceRaw = remainingLots.reduce((total, lot) => total + lot.remainingAmountRaw, 0n);
  const priceRows = await context.database.db
    .select({
      priceRaw: schema.deterministicPriceObservations.price_raw,
      priceDecimals: schema.deterministicPriceObservations.price_decimals,
    })
    .from(schema.deterministicPriceObservations)
    .where(
      and(
        eq(schema.deterministicPriceObservations.chain_id, chainId),
        eq(schema.deterministicPriceObservations.token_address, tokenKey),
        eq(schema.deterministicPriceObservations.quote_asset_address, quoteKey),
        eq(schema.deterministicPriceObservations.canonical, true),
        eq(schema.deterministicPriceObservations.authoritative, true),
        eq(schema.deterministicPriceObservations.stale, false),
        lte(schema.deterministicPriceObservations.source_block_number, projectionBlock),
      ),
    )
    .orderBy(desc(schema.deterministicPriceObservations.source_block_number))
    .limit(1);
  const price = priceRows[0];
  if (price === undefined || price.priceRaw === null || price.priceDecimals !== quoteDecimals) {
    warnings.add('CURRENT_AUTHORITATIVE_PRICE_UNAVAILABLE');
  }
  const currentValueRaw =
    price === undefined || price.priceRaw === null || price.priceDecimals !== quoteDecimals
      ? null
      : (balanceRaw * BigInt(price.priceRaw)) / 10n ** BigInt(tokenDecimals);
  const unrealizedPnlRaw =
    currentValueRaw === null || costBasisRaw === null ? null : currentValueRaw - costBasisRaw;
  const incompleteHistory = warnings.has('INCOMPLETE_ACQUISITION_HISTORY') || hasUnknownCost;
  const confidence = incompleteHistory ? '0.50' : currentValueRaw === null ? '0.75' : '1.00';

  await context.database.db.transaction(async (tx) => {
    await tx
      .delete(schema.walletTokenLots)
      .where(
        and(
          eq(schema.walletTokenLots.chainId, chainId),
          eq(schema.walletTokenLots.walletAddress, walletKey),
          eq(schema.walletTokenLots.tokenAddress, tokenKey),
        ),
      );
    await tx
      .delete(schema.walletCashFlows)
      .where(
        and(
          eq(schema.walletCashFlows.chainId, chainId),
          eq(schema.walletCashFlows.walletAddress, walletKey),
          eq(schema.walletCashFlows.tokenAddress, tokenKey),
        ),
      );
    if (remainingLots.length > 0) {
      await tx.insert(schema.walletTokenLots).values(
        remainingLots.map((lot) => ({
          id: randomUUID(),
          chainId,
          walletAddress: walletKey,
          tokenAddress: tokenKey,
          acquisitionTxHash: lot.acquisitionTxHash,
          acquisitionBlock: lot.acquisitionBlock,
          acquisitionBlockHash: lot.acquisitionBlockHash,
          acquisitionLogIndex: lot.acquisitionLogIndex,
          amountRaw: lot.amountRaw.toString(),
          unitCostRaw:
            lot.totalCostRaw === null
              ? null
              : ((lot.totalCostRaw * 10n ** BigInt(tokenDecimals)) / lot.amountRaw).toString(),
          unitCostDecimals: quoteDecimals,
          totalCostRaw: lot.totalCostRaw?.toString() ?? null,
          quoteAssetAddress: quoteKey,
          remainingAmountRaw: lot.remainingAmountRaw.toString(),
          methodology: LOT_METHODOLOGY,
          sourceBlock: projectionBlock,
          sourceBlockHash,
          canonical: true,
        })),
      );
    }
    if (cashFlows.length > 0) {
      await tx.insert(schema.walletCashFlows).values(
        cashFlows.map((flow) => ({
          id: randomUUID(),
          chainId,
          walletAddress: walletKey,
          tokenAddress: tokenKey,
          txHash: flow.transactionHash,
          logIndex: flow.logIndex,
          blockHash: flow.blockHash,
          quoteAssetAddress: quoteKey,
          flowType: flow.flowType,
          amountRaw: flow.amountRaw.toString(),
          blockNumber: flow.blockNumber,
          canonical: true,
        })),
      );
    }
    await tx
      .insert(schema.walletPnlSnapshots)
      .values({
        id: randomUUID(),
        chainId,
        walletAddress: walletKey,
        tokenAddress: tokenKey,
        snapshotBlock: projectionBlock,
        balanceRaw: balanceRaw.toString(),
        costBasisRaw: costBasisRaw?.toString() ?? null,
        realizedPnlRaw: realizedPnlRaw?.toString() ?? null,
        unrealizedPnlRaw: unrealizedPnlRaw?.toString() ?? null,
        quoteAssetAddress: quoteKey,
        quoteDecimals,
        confidence,
        methodology: METHODOLOGY,
        incompleteHistory,
        warnings: [...warnings].sort(),
        sourceBlockHash,
        canonical: true,
      })
      .onConflictDoUpdate({
        target: [
          schema.walletPnlSnapshots.chainId,
          schema.walletPnlSnapshots.walletAddress,
          schema.walletPnlSnapshots.tokenAddress,
          schema.walletPnlSnapshots.snapshotBlock,
        ],
        set: {
          balanceRaw: balanceRaw.toString(),
          costBasisRaw: costBasisRaw?.toString() ?? null,
          realizedPnlRaw: realizedPnlRaw?.toString() ?? null,
          unrealizedPnlRaw: unrealizedPnlRaw?.toString() ?? null,
          quoteAssetAddress: quoteKey,
          quoteDecimals,
          confidence,
          methodology: METHODOLOGY,
          incompleteHistory,
          warnings: [...warnings].sort(),
          sourceBlockHash,
          canonical: true,
          updatedAt: new Date(),
        },
      });
  });
}

export async function processWalletActivity(
  payload: DerivedJobPayload,
  context: Pick<ProcessorContext, 'database'>,
): Promise<void> {
  if (!isHash(payload.blockHash)) throw new Error('Wallet activity block hash is malformed');
  const targets = await targetsForEvent(payload, context);
  for (const target of targets) await projectTarget(payload, context, target);
}
