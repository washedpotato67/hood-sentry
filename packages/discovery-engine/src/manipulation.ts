import { type Address, type Hash, getAddress } from 'viem';
import { clampBps, ratioBps } from './arithmetic.js';
import {
  type DiscoveryTrade,
  MANIPULATION_METHODOLOGY_VERSION,
  type ManipulationAssessment,
  type ManipulationContext,
  type ManipulationEvidence,
  type ManipulationSignalCode,
} from './types.js';

interface MutableEvidence {
  transactions: Set<Hash>;
  wallets: Set<Address>;
  facts: Record<string, string>;
}

type WalletTradeMap = ReadonlyMap<string, readonly DiscoveryTrade[]>;

function emptyEvidence(): MutableEvidence {
  return { transactions: new Set<Hash>(), wallets: new Set<Address>(), facts: {} };
}

function signal(
  code: ManipulationSignalCode,
  observed: boolean,
  sufficient: boolean,
  confidenceBps: bigint,
  penaltyBps: bigint,
  evidence: MutableEvidence,
): ManipulationEvidence {
  return {
    code,
    status: sufficient ? (observed ? 'observed' : 'notObserved') : 'insufficientData',
    confidenceBps: sufficient ? clampBps(confidenceBps) : 0n,
    penaltyBps: observed && sufficient ? clampBps(penaltyBps) : 0n,
    transactionHashes: [...evidence.transactions].sort(),
    walletAddresses: [...evidence.wallets].sort((left, right) => left.localeCompare(right)),
    facts: evidence.facts,
  };
}

function canonicalTrades(input: readonly DiscoveryTrade[]): DiscoveryTrade[] {
  return input
    .filter((trade) => trade.canonical)
    .sort((left, right) => {
      if (left.blockNumber !== right.blockNumber)
        return left.blockNumber < right.blockNumber ? -1 : 1;
      return left.logIndex - right.logIndex;
    });
}

function groupTradesByWallet(trades: readonly DiscoveryTrade[]): WalletTradeMap {
  const groups = new Map<string, DiscoveryTrade[]>();
  for (const trade of trades) {
    const key = trade.traderAddress.toLowerCase();
    const group = groups.get(key) ?? [];
    group.push(trade);
    groups.set(key, group);
  }
  return groups;
}

function detectSelfTrading(trades: readonly DiscoveryTrade[]): ManipulationEvidence {
  const evidence = emptyEvidence();
  for (const trade of trades) {
    const sender = trade.senderAddress?.toLowerCase();
    const recipient = trade.recipientAddress?.toLowerCase();
    if (sender === undefined || recipient === undefined || sender !== recipient) continue;
    evidence.transactions.add(trade.transactionHash);
    if (trade.senderAddress !== null) evidence.wallets.add(trade.senderAddress);
  }
  evidence.facts.count = evidence.transactions.size.toString();
  return signal(
    'SELF_TRADING',
    evidence.transactions.size > 0,
    trades.length > 0,
    9_500n,
    1_800n,
    evidence,
  );
}

function detectRepeatedPairs(trades: readonly DiscoveryTrade[]): ManipulationEvidence {
  const evidence = emptyEvidence();
  const pairCounts = new Map<string, DiscoveryTrade[]>();
  for (const trade of trades) {
    if (trade.counterpartyAddress === null) continue;
    const pair = [trade.traderAddress.toLowerCase(), trade.counterpartyAddress.toLowerCase()]
      .sort()
      .join(':');
    const group = pairCounts.get(pair) ?? [];
    group.push(trade);
    pairCounts.set(pair, group);
  }
  for (const group of pairCounts.values()) {
    if (group.length < 4) continue;
    for (const trade of group) {
      evidence.transactions.add(trade.transactionHash);
      evidence.wallets.add(trade.traderAddress);
      if (trade.counterpartyAddress !== null) evidence.wallets.add(trade.counterpartyAddress);
    }
  }
  evidence.facts.repeatedTransactionCount = evidence.transactions.size.toString();
  return signal(
    'REPEATED_WALLET_PAIR',
    evidence.transactions.size > 0,
    trades.length >= 4,
    8_000n,
    900n,
    evidence,
  );
}

function detectVolumeConcentration(
  trades: readonly DiscoveryTrade[],
  totalVolume: bigint,
): ManipulationEvidence {
  const evidence = emptyEvidence();
  const walletVolumes = new Map<string, { address: Address; volume: bigint; hashes: Hash[] }>();
  for (const trade of trades) {
    const key = trade.traderAddress.toLowerCase();
    const current = walletVolumes.get(key) ?? {
      address: trade.traderAddress,
      volume: 0n,
      hashes: [],
    };
    current.volume += trade.quoteAmountRaw;
    current.hashes.push(trade.transactionHash);
    walletVolumes.set(key, current);
  }
  const top = [...walletVolumes.values()].sort((left, right) =>
    left.volume === right.volume ? 0 : left.volume > right.volume ? -1 : 1,
  )[0];
  const concentrationBps = top === undefined ? 0n : ratioBps(top.volume, totalVolume);
  if (top !== undefined && concentrationBps >= 7_500n) {
    evidence.wallets.add(top.address);
    for (const hash of top.hashes) evidence.transactions.add(hash);
  }
  evidence.facts.topWalletVolumeBps = concentrationBps.toString();
  return signal(
    'ONE_WALLET_VOLUME_CONCENTRATION',
    concentrationBps >= 7_500n,
    trades.length >= 3 && totalVolume > 0n,
    9_000n,
    (concentrationBps * 2_000n) / 10_000n,
    evidence,
  );
}

function detectRapidLoops(
  trades: readonly DiscoveryTrade[],
  groups: WalletTradeMap,
): ManipulationEvidence {
  const evidence = emptyEvidence();
  for (const walletTrades of groups.values()) {
    for (let index = 1; index < walletTrades.length; index += 1) {
      const previous = walletTrades[index - 1];
      const current = walletTrades[index];
      if (previous === undefined || current === undefined || previous.side === current.side)
        continue;
      const difference = Date.parse(current.timestamp) - Date.parse(previous.timestamp);
      if (!Number.isFinite(difference) || difference < 0 || difference > 120_000) continue;
      evidence.transactions.add(previous.transactionHash);
      evidence.transactions.add(current.transactionHash);
      evidence.wallets.add(current.traderAddress);
    }
  }
  evidence.facts.loopTransactionCount = evidence.transactions.size.toString();
  return signal(
    'RAPID_BUY_SELL_LOOP',
    evidence.transactions.size >= 2,
    trades.length >= 2,
    8_500n,
    1_200n,
    evidence,
  );
}

function detectTinyTrades(
  trades: readonly DiscoveryTrade[],
  threshold: bigint,
): ManipulationEvidence {
  const evidence = emptyEvidence();
  for (const trade of trades) {
    if (trade.quoteAmountRaw > threshold) continue;
    evidence.transactions.add(trade.transactionHash);
    evidence.wallets.add(trade.traderAddress);
  }
  const shareBps = ratioBps(BigInt(evidence.transactions.size), BigInt(trades.length));
  evidence.facts.tradeShareBps = shareBps.toString();
  return signal(
    'TINY_TRADE_COUNT_INFLATION',
    shareBps >= 6_000n,
    trades.length >= 5,
    8_000n,
    (shareBps * 1_500n) / 10_000n,
    evidence,
  );
}

function detectThinPool(context: ManipulationContext): ManipulationEvidence {
  const evidence = emptyEvidence();
  const liquidityThin =
    context.liquidityRaw !== null && context.liquidityRaw < context.minimumHealthyLiquidityRaw;
  const impactHigh = context.priceImpactBps !== null && context.priceImpactBps >= 1_000n;
  evidence.facts.liquidityRaw = context.liquidityRaw?.toString() ?? 'unavailable';
  evidence.facts.priceImpactBps = context.priceImpactBps?.toString() ?? 'unavailable';
  return signal(
    'THIN_POOL_PRICE_MANIPULATION',
    liquidityThin && impactHigh,
    context.liquidityRaw !== null && context.priceImpactBps !== null,
    9_000n,
    1_800n,
    evidence,
  );
}

function detectSybilClusters(
  trades: readonly DiscoveryTrade[],
  clusters: readonly (readonly Address[])[],
): ManipulationEvidence {
  const evidence = emptyEvidence();
  const activeWallets = new Set(trades.map((trade) => trade.traderAddress.toLowerCase()));
  for (const cluster of clusters) {
    const activeCluster = cluster.filter((wallet) => activeWallets.has(wallet.toLowerCase()));
    if (activeCluster.length < 3) continue;
    for (const wallet of activeCluster) evidence.wallets.add(wallet);
  }
  evidence.facts.clusteredWalletCount = evidence.wallets.size.toString();
  return signal(
    'SYBIL_LIKE_WALLET_CLUSTER',
    evidence.wallets.size >= 3,
    clusters.length > 0,
    7_500n,
    1_000n,
    evidence,
  );
}

function detectCircularVolume(trades: readonly DiscoveryTrade[]): ManipulationEvidence {
  const evidence = emptyEvidence();
  const edges = new Map<string, Set<string>>();
  for (const trade of trades) {
    if (trade.counterpartyAddress === null) continue;
    const from = trade.traderAddress.toLowerCase();
    const targets = edges.get(from) ?? new Set<string>();
    targets.add(trade.counterpartyAddress.toLowerCase());
    edges.set(from, targets);
  }
  for (const [first, secondSet] of edges) {
    for (const second of secondSet) {
      for (const third of edges.get(second) ?? []) {
        if (edges.get(third)?.has(first) !== true) continue;
        evidence.wallets.add(getAddress(first));
        evidence.wallets.add(getAddress(second));
        evidence.wallets.add(getAddress(third));
      }
    }
  }
  evidence.facts.cycleWalletCount = evidence.wallets.size.toString();
  return signal(
    'CIRCULAR_WALLET_VOLUME',
    evidence.wallets.size >= 3,
    trades.length >= 3,
    7_500n,
    1_000n,
    evidence,
  );
}

function isLaunchpadBurst(walletTrades: readonly DiscoveryTrade[]): boolean {
  if (walletTrades.length < 5) return false;
  const first = walletTrades[0];
  const last = walletTrades[walletTrades.length - 1];
  if (first === undefined || last === undefined) return false;
  const span = Date.parse(last.timestamp) - Date.parse(first.timestamp);
  return Number.isFinite(span) && span >= 0 && span <= 60_000;
}

function detectLaunchpadBots(
  trades: readonly DiscoveryTrade[],
  groups: WalletTradeMap,
  launchpad: boolean,
): ManipulationEvidence {
  const evidence = emptyEvidence();
  if (launchpad) {
    for (const walletTrades of groups.values()) {
      if (!isLaunchpadBurst(walletTrades)) continue;
      for (const trade of walletTrades) {
        evidence.transactions.add(trade.transactionHash);
        evidence.wallets.add(trade.traderAddress);
      }
    }
  }
  evidence.facts.burstTransactionCount = evidence.transactions.size.toString();
  return signal(
    'LAUNCHPAD_BOT_ACTIVITY',
    evidence.transactions.size >= 5,
    launchpad && trades.length >= 5,
    7_500n,
    900n,
    evidence,
  );
}

export function analyzeManipulation(
  inputTrades: readonly DiscoveryTrade[],
  context: ManipulationContext,
): ManipulationAssessment {
  const trades = canonicalTrades(inputTrades);
  const totalVolume = trades.reduce((sum, trade) => sum + trade.quoteAmountRaw, 0n);
  const groups = groupTradesByWallet(trades);
  const signals = [
    detectSelfTrading(trades),
    detectRepeatedPairs(trades),
    detectVolumeConcentration(trades, totalVolume),
    detectRapidLoops(trades, groups),
    detectTinyTrades(trades, context.tinyTradeThresholdRaw),
    detectThinPool(context),
    detectSybilClusters(trades, context.sybilClusterWallets),
    detectCircularVolume(trades),
    detectLaunchpadBots(trades, groups, context.launchpad),
  ];
  const observed = signals.filter((item) => item.status === 'observed');
  const assessed = signals.filter((item) => item.status !== 'insufficientData');
  return {
    methodologyVersion: MANIPULATION_METHODOLOGY_VERSION,
    confidenceBps: (BigInt(assessed.length) * 10_000n) / BigInt(signals.length),
    totalPenaltyBps: clampBps(observed.reduce((sum, item) => sum + item.penaltyBps, 0n)),
    signals,
  };
}
