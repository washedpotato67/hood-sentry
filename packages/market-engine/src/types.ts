import type { Address, Hash } from 'viem';

export type PriceSourceType =
  | 'chainlink'
  | 'launchpadBondingCurve'
  | 'stablecoinPool'
  | 'wethRoute'
  | 'directDex'
  | 'multihop'
  | 'externalProvider'
  | 'unavailable';

export type AssetClass = 'erc20' | 'wrappedEth' | 'stablecoin' | 'launchpad' | 'migratedLaunchpad';

export type PriceStatus = 'available' | 'lowConfidence' | 'unavailable';
export type MarketWindow = '1m' | '5m' | '15m' | '1h' | '6h' | '24h' | '7d' | '30d';

export interface ConfidenceRules {
  baseConfidenceBps: bigint;
  thinLiquidityPenaltyBps: bigint;
  stalePenaltyBps: bigint;
  disagreementThresholdBps: bigint;
  disagreementPenaltyBps: bigint;
  maximumPriceImpactBps: bigint;
  maximumSingleTransactionVolumeBps: bigint;
  maximumPriceJumpBps: bigint;
  stablecoinDepegThresholdBps: bigint;
  minimumAuthoritativeConfidenceBps: bigint;
}

export interface PriceRouteStep {
  protocolKey: string;
  protocolVersion: string;
  poolAddress: Address;
  inputTokenAddress: Address;
  outputTokenAddress: Address;
}

export interface PriceSourceConfig {
  sourceKey: string;
  sourceType: PriceSourceType;
  assetClass: AssetClass;
  chainId: number;
  sourceContractAddress: Address | null;
  sourceAssetAddress: Address;
  quoteAssetAddress: Address;
  verificationSourceUrl: string;
  verifiedAt: string;
  minimumLiquidityRaw: bigint;
  liquidityDecimals: number;
  maximumStalenessSeconds: number;
  enabled: boolean;
  priority: number;
  confidenceRules: ConfidenceRules;
  route: readonly PriceRouteStep[];
  methodologyVersion: string;
  /**
   * Official Chainlink feed heartbeat in seconds. Required for Chainlink sources so
   * the engine can distinguish stale answers from fresh ones.
   */
  oracleHeartbeatSeconds?: number;
  /**
   * Optional Chainlink sequencer uptime feed address. When provided, the engine checks
   * sequencer status before trusting the price answer.
   */
  sequencerFeedAddress?: Address | null;
}

export interface PriceEvidence {
  priceRaw: bigint | null;
  priceDecimals: number;
  sourceBlockNumber: bigint | null;
  sourceBlockHash: Hash | null;
  sourceTimestamp: string;
  observedAt: string;
  liquidityDepthRaw: bigint | null;
  liquidityDepthDecimals: number | null;
  priceImpactBps: bigint | null;
  singleTransactionVolumeBps: bigint | null;
  providerName: string | null;
  poolAddress: Address | null;
  route: readonly PriceRouteStep[];
  canonical: boolean;
  reasons: readonly string[];
}

export interface PriceObservation extends PriceEvidence {
  observationKey: string;
  chainId: number;
  tokenAddress: Address;
  quoteAssetAddress: Address;
  sourceKey: string;
  sourceType: PriceSourceType;
  sourceContractAddress: Address | null;
  confidenceBps: bigint;
  stale: boolean;
  status: PriceStatus;
  authoritative: boolean;
  methodologyVersion: string;
  /** Oracle round metadata, populated for Chainlink sources. */
  roundId?: bigint;
  answeredInRound?: bigint;
  oraclePaused?: boolean;
  sequencerUp?: boolean;
  sequencerRecoveredAt?: bigint;
}

export interface PoolPriceInput {
  tokenAddress: Address;
  quoteAssetAddress: Address;
  tokenDecimals: number;
  quoteDecimals: number;
  reserveTokenRaw: bigint;
  reserveQuoteRaw: bigint;
  protocolVerified: boolean;
  tokenAddressesVerified: boolean;
  poolStateFresh: boolean;
  priceImpactBps: bigint | null;
  singleTransactionVolumeBps: bigint | null;
}

export interface ChainlinkPriceInput {
  answer: bigint;
  decimals: number;
  roundId: bigint;
  answeredInRound: bigint;
  updatedAt: string;
  sequencerUp: boolean;
  sequencerGracePeriodElapsed: boolean;
  oraclePaused: boolean;
}

export interface BondingCurvePriceInput {
  numeratorRaw: bigint;
  denominatorRaw: bigint;
  priceDecimals: number;
  formulaKey: string;
  formulaParametersHash: Hash;
  contractVerified: boolean;
  supplyStateVerified: boolean;
  graduated: boolean;
  migrated: boolean;
}

export interface ExternalPriceInput {
  priceRaw: bigint;
  priceDecimals: number;
  providerName: string;
  providerTimestamp: string;
}

export interface TradeMetricInput {
  transactionHash: Hash;
  traderAddress: Address;
  side: 'buy' | 'sell';
  tokenAmountRaw: bigint;
  quoteAmountRaw: bigint;
  timestamp: string;
  canonical: boolean;
  whale: boolean;
}

export interface SupplyInput {
  totalSupplyRaw: bigint | null;
  circulatingSupplyRaw: bigint | null;
  supplyDecimals: number;
  circulatingSupplyReliable: boolean;
  circulatingSupplyMethodology: string | null;
  circulatingSupplyExclusions: readonly Address[];
}

export interface MetricContext {
  liquidityRaw: bigint | null;
  liquidityDecimals: number | null;
  previousClosePriceRaw: bigint | null;
  previousVolumeRaw: bigint | null;
  previousLiquidityRaw: bigint | null;
  holderCount: bigint | null;
  previousHolderCount: bigint | null;
  previousTransactionCount: bigint | null;
  priceImpactByOrderSize: Readonly<Record<string, bigint | null>>;
}

export interface MarketCandle {
  chainId: number;
  tokenAddress: Address;
  quoteAssetAddress: Address;
  window: MarketWindow;
  bucketStart: string;
  priceDecimals: number;
  openPriceRaw: bigint;
  highPriceRaw: bigint;
  lowPriceRaw: bigint;
  closePriceRaw: bigint;
  sourceObservationCount: bigint;
  canonical: boolean;
  methodologyVersion: string;
}

export interface MarketMetrics {
  chainId: number;
  tokenAddress: Address;
  quoteAssetAddress: Address;
  window: MarketWindow;
  bucketStart: string;
  quoteDecimals: number;
  spotPriceRaw: bigint | null;
  spotPriceDecimals: number | null;
  volumeRaw: bigint;
  buyVolumeRaw: bigint;
  sellVolumeRaw: bigint;
  buyCount: bigint;
  sellCount: bigint;
  uniqueTraders: bigint;
  liquidityRaw: bigint | null;
  liquidityDecimals: number | null;
  marketCapitalizationRaw: bigint | null;
  fullyDilutedValuationRaw: bigint | null;
  valuationDecimals: number | null;
  circulatingSupplyRaw: bigint | null;
  circulatingSupplyMethodology: string | null;
  circulatingSupplyExclusions: readonly Address[];
  priceChangeBps: bigint | null;
  volumeChangeBps: bigint | null;
  liquidityChangeBps: bigint | null;
  holderChange: bigint | null;
  transactionGrowthBps: bigint | null;
  averageTradeSizeRaw: bigint | null;
  medianTradeSizeRaw: bigint | null;
  whaleVolumeRaw: bigint;
  priceImpactByOrderSize: Readonly<Record<string, bigint | null>>;
  canonical: boolean;
  methodologyVersion: string;
}

export interface SourceSelectionResult {
  selected: PriceObservation;
  evaluated: readonly PriceObservation[];
  disagreementWarnings: readonly string[];
}

export interface OutlierInput {
  observation: PriceObservation;
  previousPriceRaw: bigint | null;
  stablecoinTargetRaw: bigint | null;
  windowVolumeRaw: bigint | null;
  previousWindowVolumeRaw: bigint | null;
  walletVolumeRaw: bigint | null;
  postGraduationDexPriceRaw: bigint | null;
}

export interface OutlierResult {
  available: boolean;
  confidenceBps: bigint;
  reasons: readonly string[];
}
