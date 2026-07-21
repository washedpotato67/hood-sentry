import type {
  BalanceRepository,
  ContractRepository,
  IntelligenceRepository,
  ProtocolRepository,
  RiskFinding,
  RiskRepository,
  RiskScanRun,
  RiskScore,
  TokenRepository,
} from '@hood-sentry/db';
import type { BlockscoutHoldersClient, MarketDataSource } from '@hood-sentry/providers';
import type { RedisCache } from '@hood-sentry/queue';
import { NotFoundError, toChecksumAddress } from '@hood-sentry/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { computeLiveRiskFindings, serializeLiveRisk } from '../live-risk.js';
import { aggregatorToken } from '../token-page.js';

const chainIdSchema = z.union([z.literal(4663), z.literal(46630)]);
// Validate the shape here rather than letting the checksum helper throw: an
// address that is not an address is the caller's mistake, and an unrecognised
// throw surfaces as a 500, which blames the server and buries real faults.
const addressParamsSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 20-byte hex address'),
});
const readQuerySchema = z.object({
  chainId: z.coerce.number().pipe(chainIdSchema).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type IntelligenceRouteOptions = {
  defaultChainId: 4663 | 46630;
  tokens: TokenRepository;
  contracts: ContractRepository;
  balances: BalanceRepository;
  protocols: ProtocolRepository;
  risk: RiskRepository;
  intelligence: IntelligenceRepository;
  nativeBalance: (address: `0x${string}`) => Promise<bigint>;
  riskScoresEnabled: boolean;
  /**
   * Live sources used when the indexed table has no record, which in the
   * serve-don't-store model is always: token metadata and pools from the
   * aggregator, holders and supply from the block explorer.
   */
  market?: MarketDataSource;
  holders?: BlockscoutHoldersClient;
  readCache?: RedisCache;
};

function target(request: { params: unknown; query: unknown }, defaultChainId: 4663 | 46630) {
  const params = addressParamsSchema.parse(request.params);
  const query = readQuerySchema.parse(request.query);
  const checksum = toChecksumAddress(params.address);
  return {
    chainId: query.chainId ?? defaultChainId,
    checksum,
    identity: checksum.toLowerCase(),
    limit: query.limit,
  };
}

function riskFinding(finding: RiskFinding) {
  return {
    id: finding.id,
    ruleId: finding.ruleId,
    ruleVersion: finding.ruleVersion,
    status: finding.status,
    category: finding.category,
    severity: finding.severity,
    confidence: finding.confidence,
    confidenceDetail: finding.confidenceDetail,
    title: finding.title,
    explanation: finding.explanation,
    evidence: finding.evidence,
    remediation: finding.remediation,
    sourceProvenance: finding.sourceProvenance,
    sourceBlock: finding.sourceBlock?.toString() ?? null,
    sourceBlockHash: finding.sourceBlockHash,
    fingerprint: finding.fingerprint,
  };
}

async function riskReport(
  repository: RiskRepository,
  chainId: number,
  address: string,
): Promise<
  | { status: 'unavailable'; reason: 'NO_COMPLETED_SCAN' }
  | {
      status: 'available' | 'partial';
      scan: RiskScanRun;
      score: RiskScore | null;
      findings: readonly RiskFinding[];
    }
> {
  const scan = await repository.getLatestScan(chainId, address);
  if (scan === null || !['completed', 'partial'].includes(scan.status)) {
    return { status: 'unavailable', reason: 'NO_COMPLETED_SCAN' };
  }
  const [score, findings] = await Promise.all([
    repository.getScoreByScan(scan.id),
    repository.getFindingsByScan(scan.id),
  ]);
  return {
    status: scan.partial || scan.status === 'partial' ? 'partial' : 'available',
    scan,
    score,
    findings: findings.filter((finding) => !finding.suppressed),
  };
}

/**
 * `completeness` measures the rules that ran, not the rules the methodology declares, so a
 * ruleset covering only part of RISK_CATEGORIES still reports `complete` and grades a token.
 * Until blocker 4 closes, `riskScoresEnabled` withholds the aggregate. Findings stay: each one
 * is an evidence-backed fact about a rule that did run, which no missing rule family can falsify.
 */
export function serializeRisk(
  report: Awaited<ReturnType<typeof riskReport>>,
  riskScoresEnabled: boolean,
): Record<string, unknown> {
  if (report.status === 'unavailable') return report;
  if (!riskScoresEnabled) {
    return {
      status: report.status,
      scanId: report.scan.id,
      targetType: report.scan.targetType,
      engineVersion: report.scan.engineVersion,
      rulesetVersion: report.scan.rulesetVersion,
      methodologyVersion: report.scan.methodologyVersion,
      sourceBlock: report.scan.sourceBlock.toString(),
      sourceBlockHash: report.scan.sourceBlockHash,
      completedAt: report.scan.completedAt?.toISOString() ?? null,
      score: null,
      scoreStatus: 'WITHHELD_PENDING_RULE_COVERAGE',
      findings: report.findings.map(riskFinding),
      notice:
        'Risk scoring is not yet published. Individual signals are evidence-based and do not constitute an audit or financial advice.',
    };
  }
  return {
    status: report.status,
    scanId: report.scan.id,
    targetType: report.scan.targetType,
    engineVersion: report.scan.engineVersion,
    rulesetVersion: report.scan.rulesetVersion,
    methodologyVersion: report.scan.methodologyVersion,
    sourceBlock: report.scan.sourceBlock.toString(),
    sourceBlockHash: report.scan.sourceBlockHash,
    completedAt: report.scan.completedAt?.toISOString() ?? null,
    score:
      report.score === null
        ? null
        : {
            value: report.score.score,
            grade: report.score.grade,
            categoryScores: report.score.categoryScores,
            completenessPercent: report.score.completenessPercent,
            unresolvedDataWarnings: report.score.unresolvedDataWarnings,
            completenessDetail: report.score.completenessDetail,
          },
    findings: report.findings.map(riskFinding),
    notice: 'Risk signals are evidence-based and do not constitute an audit or financial advice.',
  };
}

function tokenData(token: NonNullable<Awaited<ReturnType<TokenRepository['getToken']>>>) {
  return {
    chainId: token.chainId,
    address: toChecksumAddress(token.address),
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    totalSupplyRaw: token.totalSupplyRaw,
    tokenType: token.tokenType,
    canonicalAssetKey: token.canonicalAssetKey,
    logoUri: token.logoUri,
    metadataStatus: token.metadataStatus,
    spamStatus: token.spamStatus,
    firstSeenBlock: token.firstSeenBlock?.toString() ?? null,
    indexedAt: token.updatedAt.toISOString(),
  };
}

function serialize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  );
}

/**
 * The indexed token first; the live aggregator when the table is empty, which
 * under serve-don't-store is the normal path. Preserving the table lookup keeps
 * the route working either way.
 */
async function resolveToken(
  options: IntelligenceRouteOptions,
  chainId: number,
  checksum: `0x${string}`,
  identity: string,
): Promise<Awaited<ReturnType<TokenRepository['getToken']>>> {
  const indexed = await options.tokens.getToken(chainId, identity);
  if (indexed !== null) return indexed;
  if (
    options.market === undefined ||
    options.holders === undefined ||
    options.readCache === undefined
  ) {
    return null;
  }
  return aggregatorToken(chainId, checksum, options.market, options.holders, options.readCache);
}

async function resolvePoolCount(
  options: IntelligenceRouteOptions,
  chainId: number,
  checksum: `0x${string}`,
): Promise<number> {
  const indexed = await options.protocols.getPoolsByToken(chainId, checksum);
  if (indexed.length > 0 || options.market === undefined) return indexed.length;
  return (await options.market.pools(chainId, checksum)).length;
}

type LiveRiskResult = {
  risk: Record<string, unknown>;
  contract: { verified: boolean; isProxy: boolean } | null;
};

/**
 * The lean risk report from live facts, used when no indexed scan exists (the
 * normal path under serve-don't-store). Gathers liquidity/volume from the
 * aggregator, holders and supply from the explorer, and contract verification,
 * then computes deterministic findings. Cached briefly so a page's reads and
 * repeat views make one set of upstream calls. Null when live sources are absent.
 */
async function liveRiskFor(
  options: IntelligenceRouteOptions,
  chainId: number,
  checksum: `0x${string}`,
  poolCount: number,
): Promise<LiveRiskResult | null> {
  const { market, holders, readCache } = options;
  if (market === undefined || holders === undefined || readCache === undefined) return null;
  const lower = checksum.toLowerCase() as `0x${string}`;
  return readCache.getOrCompute<LiveRiskResult>(
    `live-risk:v1:${chainId}:${lower}`,
    120,
    async () => {
      const [marketData, holderData, contract] = await Promise.all([
        market.tokenMarket(chainId, lower),
        holders.tokenHolders(lower),
        holders.contractInfo(lower),
      ]);
      const findings = computeLiveRiskFindings({
        liquidityUsd: marketData?.liquidityUsd ?? null,
        volume24hUsd: marketData?.volume24hUsd ?? null,
        poolCount,
        totalSupplyRaw: holderData.totalSupplyRaw,
        topHolders: holderData.holders,
        contract,
      });
      return { risk: serializeLiveRisk(findings), contract };
    },
  );
}

export async function intelligenceRoutes(app: FastifyInstance, options: IntelligenceRouteOptions) {
  app.get('/tokens/:address', async (request) => {
    const input = target(request, options.defaultChainId);
    const token = await resolveToken(options, input.chainId, input.checksum, input.identity);
    if (token === null) throw new NotFoundError('Token', input.checksum);
    const [contract, poolCount, report] = await Promise.all([
      options.contracts.getContract(input.chainId, input.identity),
      resolvePoolCount(options, input.chainId, input.checksum),
      riskReport(options.risk, input.chainId, input.identity),
    ]);
    let contractOut =
      contract === null ? null : { verified: contract.verified, isProxy: contract.isProxy };
    let risk = serializeRisk(report, options.riskScoresEnabled);
    // No indexed scan (the serve-don't-store default): compute a live risk report
    // from current facts, and fill contract verification from the same lookup.
    if (report.status === 'unavailable') {
      const live = await liveRiskFor(options, input.chainId, input.checksum, poolCount);
      if (live !== null) {
        risk = live.risk;
        if (contractOut === null && live.contract !== null) contractOut = live.contract;
      }
    }
    return {
      data: {
        ...tokenData(token),
        contract: contractOut,
        poolCount,
        risk,
      },
    };
  });

  app.get('/tokens/:address/holders', async (request) => {
    const input = target(request, options.defaultChainId);
    const indexed = await options.intelligence.getTokenHolders(
      input.chainId,
      input.identity,
      input.limit,
    );
    if (indexed.length > 0) {
      const token = await options.tokens.getToken(input.chainId, input.identity);
      const supply = token?.totalSupplyRaw == null ? null : BigInt(token.totalSupplyRaw);
      return {
        data: {
          tokenAddress: input.checksum,
          totalSupplyRaw: token?.totalSupplyRaw ?? null,
          holders: indexed.map((holder) => ({
            address: toChecksumAddress(holder.walletAddress),
            balanceRaw: holder.balanceRaw,
            supplyShareBps:
              supply === null || supply <= 0n
                ? null
                : ((BigInt(holder.balanceRaw) * 10_000n) / supply).toString(),
            asOfBlock: holder.asOfBlock.toString(),
          })),
        },
      };
    }

    // No indexed holders: read them live from the block explorer.
    if (options.holders === undefined) throw new NotFoundError('Token', input.checksum);
    const explorer = await options.holders.tokenHolders(input.checksum);
    if (explorer.holders.length === 0 && explorer.totalSupplyRaw === null) {
      throw new NotFoundError('Token', input.checksum);
    }
    const supply = explorer.totalSupplyRaw === null ? null : BigInt(explorer.totalSupplyRaw);
    return {
      data: {
        tokenAddress: input.checksum,
        totalSupplyRaw: explorer.totalSupplyRaw,
        holders: explorer.holders.map((holder) => ({
          address: toChecksumAddress(holder.address),
          balanceRaw: holder.balanceRaw,
          supplyShareBps:
            supply === null || supply <= 0n
              ? null
              : ((BigInt(holder.balanceRaw) * 10_000n) / supply).toString(),
          asOfBlock: null,
        })),
      },
    };
  });

  app.get('/tokens/:address/transfers', async (request) => {
    const input = target(request, options.defaultChainId);
    const transfers = await options.intelligence.getTokenTransfers(
      input.chainId,
      input.identity,
      input.limit,
    );
    return {
      data: transfers.map((transfer) => ({
        ...transfer,
        blockNumber: transfer.blockNumber.toString(),
        tokenAddress: toChecksumAddress(transfer.tokenAddress),
        fromAddress: toChecksumAddress(transfer.fromAddress),
        toAddress: toChecksumAddress(transfer.toAddress),
      })),
    };
  });

  app.get('/tokens/:address/pools', async (request) => {
    const input = target(request, options.defaultChainId);
    const pools = await options.protocols.getPoolsByToken(input.chainId, input.checksum);
    return { data: serialize(pools) };
  });

  app.get('/tokens/:address/risk', async (request) => {
    const input = target(request, options.defaultChainId);
    return {
      data: serializeRisk(
        await riskReport(options.risk, input.chainId, input.identity),
        options.riskScoresEnabled,
      ),
    };
  });

  app.get('/tokens/:address/contract', async (request) => {
    const input = target(request, options.defaultChainId);
    const contract = await options.contracts.getContract(input.chainId, input.identity);
    if (contract === null) throw new NotFoundError('Contract', input.checksum);
    return {
      data: {
        ...contract,
        address: toChecksumAddress(contract.address),
        creatorAddress:
          contract.creatorAddress === null ? null : toChecksumAddress(contract.creatorAddress),
        creationBlock: contract.creationBlock?.toString() ?? null,
        runtimeBytecode: undefined,
        sourceFetchedAt: contract.sourceFetchedAt?.toISOString() ?? null,
        createdAt: contract.createdAt.toISOString(),
        updatedAt: contract.updatedAt.toISOString(),
      },
    };
  });

  app.get('/tokens/:address/deployer', async (request) => {
    const input = target(request, options.defaultChainId);
    const contract = await options.contracts.getContract(input.chainId, input.identity);
    return {
      data: {
        tokenAddress: input.checksum,
        deployerAddress:
          contract?.creatorAddress === null || contract?.creatorAddress === undefined
            ? null
            : toChecksumAddress(contract.creatorAddress),
        creationTransactionHash: contract?.creationTxHash ?? null,
        creationBlock: contract?.creationBlock?.toString() ?? null,
        status:
          contract?.creatorAddress === null || contract === null ? 'unavailable' : 'available',
      },
    };
  });

  app.get('/tokens/:address/related', async (request) => {
    const input = target(request, options.defaultChainId);
    const contract = await options.contracts.getContract(input.chainId, input.identity);
    if (contract?.creatorAddress === null || contract === null) {
      return { data: { status: 'unavailable', reason: 'DEPLOYER_NOT_INDEXED', contracts: [] } };
    }
    const related = await options.contracts.getContractsByCreator(
      input.chainId,
      contract.creatorAddress,
      { limit: input.limit, orderBy: 'desc' },
    );
    return {
      data: {
        status: 'available',
        relationship: 'same_deployer',
        deployerAddress: toChecksumAddress(contract.creatorAddress),
        contracts: related.data.map((item) => ({
          address: toChecksumAddress(item.address),
          creationBlock: item.creationBlock?.toString() ?? null,
          creationTransactionHash: item.creationTxHash,
          verified: item.verified,
        })),
        nextCursor: related.nextCursor,
      },
    };
  });

  app.get('/wallets/:address/portfolio', async (request) => {
    const input = target(request, options.defaultChainId);
    const [nativeBalance, balances] = await Promise.all([
      options.nativeBalance(input.checksum),
      options.balances.getBalancesByWallet(input.chainId, input.identity),
    ]);
    const positive = balances.filter((balance) => BigInt(balance.balanceRaw) > 0n);
    const [tokens, prices] = await Promise.all([
      Promise.all(
        positive.map((balance) => options.tokens.getToken(input.chainId, balance.tokenAddress)),
      ),
      options.intelligence.getLatestTokenPrices(
        input.chainId,
        positive.map((balance) => balance.tokenAddress),
      ),
    ]);
    const holdings = positive.map((balance, index) => {
      const token = tokens[index] ?? null;
      const price = prices.get(balance.tokenAddress.toLowerCase()) ?? null;
      const decimals = token?.decimals ?? null;
      const estimatedValueRaw =
        price === null || decimals === null || decimals < 0 || decimals > 77
          ? null
          : (
              (BigInt(balance.balanceRaw) * BigInt(price.priceRaw)) /
              10n ** BigInt(decimals)
            ).toString();
      return {
        tokenAddress: toChecksumAddress(balance.tokenAddress),
        symbol: token?.symbol ?? null,
        name: token?.name ?? null,
        decimals,
        balanceRaw: balance.balanceRaw,
        asOfBlock: balance.asOfBlock.toString(),
        price:
          price === null
            ? null
            : {
                priceRaw: price.priceRaw,
                priceDecimals: price.priceDecimals,
                quoteAssetAddress: toChecksumAddress(price.quoteAssetAddress),
                source: price.sourceKey,
                sourceBlock: price.sourceBlockNumber?.toString() ?? null,
                sourceBlockHash: price.sourceBlockHash,
                observedAt: price.observedAt.toISOString(),
                confidenceBps: price.confidenceBps,
                methodologyVersion: price.methodologyVersion,
              },
        estimatedValueRaw,
        valueStatus: estimatedValueRaw === null ? 'unavailable' : 'estimated',
      };
    });
    const valued = holdings.filter(
      (holding) => holding.estimatedValueRaw !== null && holding.price !== null,
    );
    const commonQuote = valued[0]?.price ?? null;
    const comparable =
      valued.length > 0 &&
      valued.every(
        (holding) =>
          holding.price?.quoteAssetAddress === commonQuote?.quoteAssetAddress &&
          holding.price?.priceDecimals === commonQuote?.priceDecimals,
      );
    const totalEstimatedValueRaw = comparable
      ? valued
          .reduce((total, holding) => total + BigInt(holding.estimatedValueRaw ?? '0'), 0n)
          .toString()
      : null;
    return {
      data: {
        chainId: input.chainId,
        address: input.checksum,
        nativeBalance: { balanceRaw: nativeBalance.toString(), decimals: 18, status: 'exact' },
        holdings,
        valuation: {
          status:
            totalEstimatedValueRaw === null
              ? 'unavailable'
              : valued.length === holdings.length
                ? 'estimated'
                : 'partial',
          totalEstimatedValueRaw,
          decimals: commonQuote?.priceDecimals ?? null,
          quoteAssetAddress: commonQuote?.quoteAssetAddress ?? null,
          unpricedHoldingCount: holdings.length - valued.length,
        },
      },
    };
  });

  app.get('/wallets/:address/activity', async (request) => {
    const input = target(request, options.defaultChainId);
    const transfers = await options.intelligence.getWalletTransfers(
      input.chainId,
      input.identity,
      input.limit,
    );
    return {
      data: transfers.map((transfer) => ({
        ...transfer,
        direction: transfer.toAddress.toLowerCase() === input.identity ? 'in' : 'out',
        blockNumber: transfer.blockNumber.toString(),
        tokenAddress: toChecksumAddress(transfer.tokenAddress),
        fromAddress: toChecksumAddress(transfer.fromAddress),
        toAddress: toChecksumAddress(transfer.toAddress),
      })),
    };
  });

  app.get('/wallets/:address/pnl', async (request) => {
    const input = target(request, options.defaultChainId);
    const snapshots = await options.intelligence.getWalletPnl(input.chainId, input.identity);
    return {
      data: {
        status: snapshots.length === 0 ? 'unavailable' : 'estimated',
        methodology: 'fifo',
        positions: snapshots.map((snapshot) => ({
          ...snapshot,
          tokenAddress: toChecksumAddress(snapshot.tokenAddress),
          quoteAssetAddress: toChecksumAddress(snapshot.quoteAssetAddress),
          snapshotBlock: snapshot.snapshotBlock.toString(),
          observedAt: snapshot.observedAt.toISOString(),
        })),
      },
    };
  });

  app.get('/wallets/:address/allowances', async (request) => {
    const input = target(request, options.defaultChainId);
    const allowances = await options.intelligence.getWalletAllowances(
      input.chainId,
      input.identity,
    );
    return {
      data: allowances.map((allowance) => ({
        ...allowance,
        tokenAddress: toChecksumAddress(allowance.tokenAddress),
        spenderAddress: toChecksumAddress(allowance.spenderAddress),
        lastUpdatedBlock: allowance.lastUpdatedBlock.toString(),
        classificationStatus:
          allowance.allowanceRaw === '0'
            ? 'revoked'
            : allowance.spenderClassification === null
              ? 'unknown'
              : 'classified',
      })),
    };
  });

  app.get('/wallets/:address/risk', async (request) => {
    const input = target(request, options.defaultChainId);
    return {
      data: serializeRisk(
        await riskReport(options.risk, input.chainId, input.identity),
        options.riskScoresEnabled,
      ),
    };
  });

  app.get('/wallets/:address/labels', async (request) => {
    const input = target(request, options.defaultChainId);
    const labels = await options.intelligence.getWalletLabels(input.chainId, input.identity);
    return { data: { address: input.checksum, labels } };
  });
}
