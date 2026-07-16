import { and, desc, eq, gt, inArray, or } from 'drizzle-orm';
import type { Database } from '../../client.js';
import { tokenApprovals, tokenBalances, tokenTransfers } from '../../schema/contracts-tokens.js';
import { deterministicPriceObservations } from '../../schema/dex-market.js';
import {
  spenderClassifications,
  walletLabels,
  walletPnlSnapshots,
} from '../../schema/wallet-portfolio.js';
import type {
  ChainTransfer,
  HolderBalance,
  IntelligenceRepository,
  TokenPriceRecord,
  WalletAllowanceRecord,
  WalletLabelRecord,
  WalletPnlRecord,
} from '../interfaces/intelligence-repository.js';

function transfer(row: typeof tokenTransfers.$inferSelect): ChainTransfer {
  return {
    blockNumber: row.block_number,
    blockHash: row.block_hash,
    transactionHash: row.transaction_hash,
    logIndex: row.log_index,
    tokenAddress: row.token_address,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    amountRaw: row.amount_raw,
  };
}

export class DrizzleIntelligenceRepository implements IntelligenceRepository {
  constructor(private readonly db: Database['db']) {}

  async getTokenTransfers(
    chainId: number,
    tokenAddress: string,
    limit: number,
  ): Promise<readonly ChainTransfer[]> {
    const rows = await this.db
      .select()
      .from(tokenTransfers)
      .where(
        and(
          eq(tokenTransfers.chain_id, chainId),
          eq(tokenTransfers.token_address, tokenAddress.toLowerCase()),
          eq(tokenTransfers.canonical, true),
        ),
      )
      .orderBy(desc(tokenTransfers.block_number), desc(tokenTransfers.log_index))
      .limit(limit);
    return rows.map(transfer);
  }

  async getTokenHolders(
    chainId: number,
    tokenAddress: string,
    limit: number,
  ): Promise<readonly HolderBalance[]> {
    const rows = await this.db
      .select()
      .from(tokenBalances)
      .where(
        and(
          eq(tokenBalances.chain_id, chainId),
          eq(tokenBalances.token_address, tokenAddress.toLowerCase()),
          gt(tokenBalances.balance_raw, '0'),
        ),
      )
      .orderBy(desc(tokenBalances.balance_raw), tokenBalances.wallet_address)
      .limit(limit);
    return rows.map((row) => ({
      walletAddress: row.wallet_address,
      balanceRaw: row.balance_raw,
      asOfBlock: row.as_of_block,
    }));
  }

  async getWalletTransfers(
    chainId: number,
    walletAddress: string,
    limit: number,
  ): Promise<readonly ChainTransfer[]> {
    const address = walletAddress.toLowerCase();
    const rows = await this.db
      .select()
      .from(tokenTransfers)
      .where(
        and(
          eq(tokenTransfers.chain_id, chainId),
          eq(tokenTransfers.canonical, true),
          or(eq(tokenTransfers.from_address, address), eq(tokenTransfers.to_address, address)),
        ),
      )
      .orderBy(desc(tokenTransfers.block_number), desc(tokenTransfers.log_index))
      .limit(limit);
    return rows.map(transfer);
  }

  async getWalletLabels(
    chainId: number,
    walletAddress: string,
  ): Promise<readonly WalletLabelRecord[]> {
    const rows = await this.db
      .select()
      .from(walletLabels)
      .where(
        and(
          eq(walletLabels.chainId, chainId),
          eq(walletLabels.address, walletAddress.toLowerCase()),
        ),
      )
      .orderBy(desc(walletLabels.confidence), walletLabels.labelType);
    return rows.map((row) => ({
      labelType: row.labelType,
      labelValue: row.labelValue,
      source: row.source,
      confidence: row.confidence,
    }));
  }

  async getWalletPnl(chainId: number, walletAddress: string): Promise<readonly WalletPnlRecord[]> {
    const rows = await this.db
      .select()
      .from(walletPnlSnapshots)
      .where(
        and(
          eq(walletPnlSnapshots.chainId, chainId),
          eq(walletPnlSnapshots.walletAddress, walletAddress.toLowerCase()),
          eq(walletPnlSnapshots.canonical, true),
        ),
      )
      .orderBy(
        walletPnlSnapshots.tokenAddress,
        desc(walletPnlSnapshots.snapshotBlock),
        desc(walletPnlSnapshots.createdAt),
      );
    const latest = new Map<string, WalletPnlRecord>();
    for (const row of rows) {
      if (latest.has(row.tokenAddress)) continue;
      latest.set(row.tokenAddress, {
        tokenAddress: row.tokenAddress,
        snapshotBlock: row.snapshotBlock,
        balanceRaw: row.balanceRaw,
        costBasisRaw: row.costBasisRaw,
        realizedPnlRaw: row.realizedPnlRaw,
        unrealizedPnlRaw: row.unrealizedPnlRaw,
        quoteAssetAddress: row.quoteAssetAddress,
        quoteDecimals: row.quoteDecimals,
        confidence: row.confidence,
        methodology: row.methodology,
        incompleteHistory: row.incompleteHistory,
        warnings: row.warnings,
        sourceBlockHash: row.sourceBlockHash,
        observedAt: row.createdAt,
      });
    }
    return [...latest.values()];
  }

  async getWalletAllowances(
    chainId: number,
    walletAddress: string,
  ): Promise<readonly WalletAllowanceRecord[]> {
    const owner = walletAddress.toLowerCase();
    const approvals = await this.db
      .select()
      .from(tokenApprovals)
      .where(and(eq(tokenApprovals.chain_id, chainId), eq(tokenApprovals.owner_address, owner)))
      .orderBy(
        desc(tokenApprovals.last_updated_block),
        desc(tokenApprovals.last_updated_log_index),
      );
    const spenderAddresses = [...new Set(approvals.map((row) => row.spender_address))];
    const classifications =
      spenderAddresses.length === 0
        ? []
        : await this.db
            .select()
            .from(spenderClassifications)
            .where(
              and(
                eq(spenderClassifications.chainId, chainId),
                inArray(spenderClassifications.spenderAddress, spenderAddresses),
              ),
            )
            .orderBy(desc(spenderClassifications.verifiedAt));
    const bySpender = new Map<string, (typeof classifications)[number]>();
    for (const classification of classifications) {
      if (!bySpender.has(classification.spenderAddress)) {
        bySpender.set(classification.spenderAddress, classification);
      }
    }
    return approvals.map((row) => {
      const classification = bySpender.get(row.spender_address);
      return {
        tokenAddress: row.token_address,
        spenderAddress: row.spender_address,
        allowanceRaw: row.allowance_raw,
        lastUpdatedBlock: row.last_updated_block,
        lastUpdatedLogIndex: row.last_updated_log_index,
        spenderClassification: classification?.classificationValue ?? null,
        classificationSource: classification?.source ?? null,
      };
    });
  }

  async getLatestTokenPrices(
    chainId: number,
    tokenAddresses: readonly string[],
  ): Promise<ReadonlyMap<string, TokenPriceRecord>> {
    if (tokenAddresses.length === 0) return new Map();
    const addresses = [...new Set(tokenAddresses.map((address) => address.toLowerCase()))];
    const rows = await this.db
      .select()
      .from(deterministicPriceObservations)
      .where(
        and(
          eq(deterministicPriceObservations.chain_id, chainId),
          inArray(deterministicPriceObservations.token_address, addresses),
          eq(deterministicPriceObservations.canonical, true),
          eq(deterministicPriceObservations.authoritative, true),
          eq(deterministicPriceObservations.stale, false),
        ),
      )
      .orderBy(
        deterministicPriceObservations.token_address,
        desc(deterministicPriceObservations.observed_at),
      );
    const latest = new Map<string, TokenPriceRecord>();
    for (const row of rows) {
      if (row.price_raw === null || row.status === 'unavailable') continue;
      const key = row.token_address.toLowerCase();
      if (latest.has(key)) continue;
      latest.set(key, {
        tokenAddress: row.token_address,
        quoteAssetAddress: row.quote_asset_address,
        priceRaw: row.price_raw,
        priceDecimals: row.price_decimals,
        sourceKey: row.source_key,
        sourceType: row.source_type,
        sourceBlockNumber: row.source_block_number,
        sourceBlockHash: row.source_block_hash,
        observedAt: row.observed_at,
        confidenceBps: row.confidence_bps,
        methodologyVersion: row.methodology_version,
      });
    }
    return latest;
  }
}
