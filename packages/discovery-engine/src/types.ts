import type { Address, Hash } from 'viem';

export const TRENDING_METHODOLOGY_VERSION = 'trending-v1';
export const MANIPULATION_METHODOLOGY_VERSION = 'manipulation-v1';

export type DiscoveryFeed =
  | 'newTokens'
  | 'newPools'
  | 'trending'
  | 'volumeGainers'
  | 'liquidityGainers'
  | 'holderGainers'
  | 'transactionActivityGainers'
  | 'newlyGraduated'
  | 'recentlyMigrated'
  | 'recentlyVerifiedProjects'
  | 'recentlyScanned'
  | 'recentCriticalRisk'
  | 'canonicalStockTokens'
  | 'canonicalEtfTokens'
  | 'mostWatched'
  | 'mostAlerted';

export type DiscoveryTokenType = 'erc20' | 'stockToken' | 'etfToken' | 'unknown';
export type CanonicalState = 'canonical' | 'nonCanonical' | 'unknown';
export type LaunchpadState = 'none' | 'bondingCurve' | 'graduated' | 'migrated';
export type PriceStatus = 'available' | 'lowConfidence' | 'unavailable';
export type RiskGrade = 'A' | 'B' | 'C' | 'D' | 'F' | 'unavailable';

export interface DiscoveryTrade {
  transactionHash: Hash;
  blockNumber: bigint;
  blockHash: Hash;
  logIndex: number;
  timestamp: string;
  senderAddress: Address | null;
  recipientAddress: Address | null;
  traderAddress: Address;
  counterpartyAddress: Address | null;
  side: 'buy' | 'sell';
  quoteAmountRaw: bigint;
  canonical: boolean;
}

export interface ManipulationContext {
  liquidityRaw: bigint | null;
  minimumHealthyLiquidityRaw: bigint;
  tinyTradeThresholdRaw: bigint;
  priceImpactBps: bigint | null;
  sybilClusterWallets: readonly (readonly Address[])[];
  launchpad: boolean;
}

export type ManipulationSignalCode =
  | 'SELF_TRADING'
  | 'REPEATED_WALLET_PAIR'
  | 'ONE_WALLET_VOLUME_CONCENTRATION'
  | 'CIRCULAR_WALLET_VOLUME'
  | 'RAPID_BUY_SELL_LOOP'
  | 'TINY_TRADE_COUNT_INFLATION'
  | 'THIN_POOL_PRICE_MANIPULATION'
  | 'SYBIL_LIKE_WALLET_CLUSTER'
  | 'LAUNCHPAD_BOT_ACTIVITY';

export interface ManipulationEvidence {
  code: ManipulationSignalCode;
  status: 'observed' | 'notObserved' | 'insufficientData';
  confidenceBps: bigint;
  penaltyBps: bigint;
  transactionHashes: readonly Hash[];
  walletAddresses: readonly Address[];
  facts: Readonly<Record<string, string>>;
}

export interface ManipulationAssessment {
  methodologyVersion: string;
  confidenceBps: bigint;
  totalPenaltyBps: bigint;
  signals: readonly ManipulationEvidence[];
}

export type TrendingComponentKey =
  | 'logScaledVolume'
  | 'uniqueTraders'
  | 'transactionAcceleration'
  | 'holderGrowth'
  | 'liquidity'
  | 'liquidityGrowth'
  | 'poolAge'
  | 'tokenAge'
  | 'watchlistGrowth'
  | 'alertCreationGrowth'
  | 'launchpadCurveProgress'
  | 'graduationStatus'
  | 'riskCompleteness'
  | 'washTradingPenalty'
  | 'holderConcentrationPenalty'
  | 'lowLiquidityPenalty'
  | 'suspiciousDeployerPenalty'
  | 'duplicateSymbolPenalty'
  | 'dataQualityPenalty';

export interface TrendingComponent {
  key: TrendingComponentKey;
  kind: 'positive' | 'penalty';
  rawValue: bigint | null;
  normalizedBps: bigint;
  weightBps: bigint;
  contributionBps: bigint;
  available: boolean;
  reasons: readonly string[];
}

export interface TrendingScore {
  methodologyVersion: string;
  scoreBps: bigint;
  confidenceBps: bigint;
  components: readonly TrendingComponent[];
  manipulation: ManipulationAssessment;
}

export interface DiscoveryCandidate {
  chainId: number;
  address: Address;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  tokenType: DiscoveryTokenType;
  canonicalState: CanonicalState;
  canonicalTicker: string | null;
  stockTokenCategory: string | null;
  etfCategory: string | null;
  projectName: string | null;
  projectSlug: string | null;
  projectVerified: boolean;
  projectVerifiedAt: string | null;
  deployerAddress: Address | null;
  primaryPoolAddress: Address | null;
  poolAddresses: readonly Address[];
  protocolKey: string | null;
  launchpadKey: string | null;
  quoteAssetAddress: Address | null;
  firstSeenBlockNumber: bigint;
  firstSeenAt: string | null;
  poolCreatedBlockNumber: bigint | null;
  poolCreatedAt: string | null;
  priceRaw: bigint | null;
  priceDecimals: number | null;
  priceStatus: PriceStatus;
  priceObservedAt: string | null;
  liquidityRaw: bigint | null;
  liquidityDecimals: number | null;
  volumeRaw: bigint | null;
  volumeDecimals: number | null;
  volumeChangeBps: bigint | null;
  liquidityChangeBps: bigint | null;
  holderCount: bigint | null;
  holderGrowth: bigint | null;
  holderConcentrationBps: bigint | null;
  transactionCount: bigint | null;
  transactionGrowthBps: bigint | null;
  uniqueTraders: bigint | null;
  watchlistCount: bigint;
  watchlistGrowth: bigint | null;
  alertCount: bigint;
  alertCreationGrowth: bigint | null;
  launchpadState: LaunchpadState;
  launchpadCurveProgressBps: bigint | null;
  graduatedAt: string | null;
  migratedAt: string | null;
  riskGrade: RiskGrade;
  riskCompletenessBps: bigint | null;
  suspiciousDeployerEvidence: readonly string[];
  duplicateSymbolAddresses: readonly Address[];
  dataQualityWarnings: readonly string[];
  lastScannedAt: string | null;
  latestCriticalFindingAt: string | null;
  sourceBlockNumber: bigint;
  sourceBlockHash: Hash;
  sourceTimestamp: string;
  observedAt: string;
  canonical: boolean;
  recentTrades: readonly DiscoveryTrade[];
  manipulationContext: ManipulationContext;
}

export interface DiscoveryItem
  extends Omit<DiscoveryCandidate, 'recentTrades' | 'manipulationContext'> {
  relatedWalletAddresses: readonly Address[];
  trending: TrendingScore;
  dataFreshnessSeconds: bigint;
  warnings: readonly string[];
}

export interface DiscoveryFilters {
  maximumTokenAgeSeconds?: bigint;
  maximumPoolAgeSeconds?: bigint;
  minimumLiquidityRaw?: bigint;
  minimumVolumeRaw?: bigint;
  minimumHolders?: bigint;
  riskGrades?: readonly RiskGrade[];
  minimumRiskCompletenessBps?: bigint;
  projectVerified?: boolean;
  canonicalState?: CanonicalState;
  protocolKey?: string;
  launchpadKey?: string;
  quoteAssetAddress?: Address;
  migrationStatus?: 'migrated' | 'notMigrated';
  graduationStatus?: 'graduated' | 'notGraduated';
  stockTokenCategory?: string;
  etfCategory?: string;
  maximumDataAgeSeconds?: bigint;
}

export interface SponsoredPlacement {
  placementId: string;
  chainId: number;
  tokenAddress: Address;
  feed: DiscoveryFeed;
  priority: number;
  startsAt: string;
  endsAt: string;
  label: 'Sponsored';
  disclosure: string;
  createdAt: string;
  createdBy: string;
}

export interface SponsoredDiscoveryItem {
  placement: SponsoredPlacement;
  item: DiscoveryItem;
}

export interface DiscoveryPage<T> {
  data: readonly T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface DiscoveryFeedPage {
  organic: DiscoveryPage<DiscoveryItem>;
  sponsored: DiscoveryPage<SponsoredDiscoveryItem>;
}

export interface SearchResult {
  item: DiscoveryItem;
  rank: number;
  matchedFields: readonly string[];
  duplicateSymbolWarning: boolean;
  duplicateSymbolAddresses: readonly Address[];
}
