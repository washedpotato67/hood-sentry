import type { Abi, Address, Hash, Hex } from 'viem';

export const PROTOCOL_REGISTRY_VERSION = '2.0.0';
export const FEE_DENOMINATOR = 1_000_000n;

export type ProtocolContractRole =
  | 'factory'
  | 'router'
  | 'quoter'
  | 'positionManager'
  | 'permit2'
  | 'bondingCurve'
  | 'tokenFactory'
  | 'migration'
  | 'feeCollector';

export type ProtocolKind = 'dex' | 'launchpad';

export interface ProtocolContractConfig {
  protocolKey: string;
  protocolName: string;
  protocolVersion: string;
  chainId: number;
  contractRole: ProtocolContractRole;
  address: Address;
  officialSourceUrl: string;
  explorerUrl: string;
  verifiedAt: string;
  runtimeBytecodeHash: Hash;
  proxyType?: string;
  implementationAddress?: Address;
  adminAddress?: Address;
  enabled: boolean;
  notes?: string;
}

export interface ProtocolDefinition {
  protocolKey: string;
  protocolName: string;
  protocolVersion: string;
  chainId: number;
  kind: ProtocolKind;
  enabled: boolean;
  contracts: readonly ProtocolContractConfig[];
}

export interface VersionedProtocolRegistry {
  name: string;
  version: string;
  createdAt: string;
  protocols: readonly ProtocolDefinition[];
}

export type ProtocolValidationFailureCode =
  | 'invalid-configuration'
  | 'wrong-chain'
  | 'provider-outage'
  | 'missing-bytecode'
  | 'bytecode-mismatch'
  | 'proxy-mismatch'
  | 'duplicate-role'
  | 'unsupported-adapter';

export interface ProtocolContractValidation {
  config: ProtocolContractConfig;
  valid: boolean;
  observedRuntimeBytecodeHash: Hash | null;
  observedImplementationAddress: Address | null;
  observedAdminAddress: Address | null;
  errors: readonly string[];
}

export interface ProtocolValidationResult {
  protocolKey: string;
  protocolName: string;
  protocolVersion: string;
  chainId: number;
  kind: ProtocolKind;
  active: boolean;
  checkedAt: string;
  expiresAt: string;
  failureCode: ProtocolValidationFailureCode | null;
  errors: readonly string[];
  contracts: readonly ProtocolContractValidation[];
}

export interface ProtocolOperationalAlert {
  severity: 'warning' | 'critical';
  code: ProtocolValidationFailureCode;
  protocolKey: string;
  protocolVersion: string;
  chainId: number;
  message: string;
  observedAt: string;
}

export interface ProtocolValidationClient {
  getChainId(): Promise<number>;
  getBytecode(address: Address, blockNumber?: bigint): Promise<Hex | undefined>;
  getStorageAt(address: Address, slot: Hash, blockNumber?: bigint): Promise<Hex | undefined>;
}

export interface ProtocolReadRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  blockNumber?: bigint;
}

export interface ProtocolSimulationRequest {
  account: Address;
  to: Address;
  data: Hex;
  value: bigint;
}

export interface ProtocolReadClient extends ProtocolValidationClient {
  getBlockNumber(): Promise<bigint>;
  getBlockTimestamp(): Promise<bigint>;
  readContract(request: ProtocolReadRequest): Promise<unknown>;
}

export interface ProtocolExecutionClient extends ProtocolReadClient {
  simulateTransaction(request: ProtocolSimulationRequest): Promise<ProtocolSimulationResult>;
}

export interface ProtocolSimulationResult {
  success: boolean;
  gasUsed: bigint;
  returnValue: Hex;
  error?: string;
}

export interface RawChainLog {
  chainId: number;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  transactionIndex: number;
  logIndex: number;
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  removed: boolean;
  canonical: boolean;
}

export interface BlockProvenance {
  chainId: number;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  transactionIndex: number;
  logIndex: number;
  canonical: boolean;
}

export type ProtocolEventKind =
  | 'poolCreated'
  | 'swap'
  | 'liquidityAdded'
  | 'liquidityRemoved'
  | 'lpMinted'
  | 'lpBurned'
  | 'positionCreated'
  | 'positionIncreased'
  | 'positionDecreased'
  | 'feesCollected'
  | 'launchpadTokenCreated'
  | 'bondingCurveBuy'
  | 'bondingCurveSell'
  | 'launchpadGraduated'
  | 'launchpadMigrated';

export interface ProtocolEventDefinition {
  kind: ProtocolEventKind;
  contractRole: ProtocolContractRole | 'pool';
  signature: string;
  topic0: Hash;
}

export interface DecodedProtocolEvent {
  protocolKey: string;
  protocolName: string;
  protocolVersion: string;
  kind: ProtocolEventKind;
  emitterAddress: Address;
  provenance: BlockProvenance;
  fields: Readonly<
    Record<string, Address | Hash | Hex | bigint | number | string | boolean | null>
  >;
}

export type PoolType =
  | 'constantProduct'
  | 'concentratedLiquidity'
  | 'stableSwap'
  | 'bondingCurve'
  | 'rfq'
  | 'unknown';

export interface NormalizedPool {
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
  poolAddress: Address;
  factoryAddress: Address;
  token0Address: Address;
  token1Address: Address;
  feeTier?: bigint;
  tickSpacing?: number;
  poolType: PoolType;
  createdBlockNumber: bigint;
  createdBlockHash: Hash;
  creationTransactionHash: Hash;
  creationLogIndex: number;
  canonical: boolean;
}

export interface ConstantProductPoolState {
  poolType: 'constantProduct';
  reserve0Raw: bigint;
  reserve1Raw: bigint;
  lpTotalSupplyRaw: bigint;
}

export interface ConcentratedLiquidityPoolState {
  poolType: 'concentratedLiquidity';
  sqrtPriceX96: bigint;
  currentTick: number;
  activeLiquidityRaw: bigint;
}

export interface GenericPoolState {
  poolType: Exclude<PoolType, 'constantProduct' | 'concentratedLiquidity'>;
  liquidityRaw: bigint;
  state: Readonly<Record<string, string>>;
}

export type NormalizedPoolState =
  | ConstantProductPoolState
  | ConcentratedLiquidityPoolState
  | GenericPoolState;

export interface NormalizedSwap {
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
  poolAddress: Address;
  transactionHash: Hash;
  blockNumber: bigint;
  blockHash: Hash;
  logIndex: number;
  senderAddress?: Address;
  recipientAddress?: Address;
  tokenInAddress: Address;
  tokenOutAddress: Address;
  amountInRaw: bigint;
  amountOutRaw: bigint;
  feeRaw?: bigint;
  canonical: boolean;
}

export type NormalizedLiquidityEventType =
  | 'liquidityAdded'
  | 'liquidityRemoved'
  | 'lpMinted'
  | 'lpBurned'
  | 'positionCreated'
  | 'positionIncreased'
  | 'positionDecreased'
  | 'feesCollected'
  | 'bondingCurveLiquidity'
  | 'migrationLiquidity';

export interface NormalizedLiquidityEvent {
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
  eventType: NormalizedLiquidityEventType;
  poolAddress: Address;
  ownerAddress?: Address;
  providerAddress?: Address;
  recipientAddress?: Address;
  token0Address: Address;
  token1Address: Address;
  amount0Raw: bigint;
  amount1Raw: bigint;
  positionId?: bigint;
  tickLower?: number;
  tickUpper?: number;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  logIndex: number;
  canonical: boolean;
}

export interface NormalizedRouteStep {
  protocolKey: string;
  protocolVersion: string;
  poolAddress: Address;
  inputTokenAddress: Address;
  outputTokenAddress: Address;
  feeTier?: bigint;
}

export interface QuoteWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface QuoteRequest {
  chainId: number;
  protocolKey: string;
  inputTokenAddress: Address;
  outputTokenAddress: Address;
  amountInRaw: bigint;
  minimumAmountOutRaw: bigint;
  route: readonly NormalizedRouteStep[];
  ttlSeconds?: number;
}

export interface NormalizedQuote {
  quoteId: string;
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
  inputTokenAddress: Address;
  outputTokenAddress: Address;
  amountInRaw: bigint;
  expectedAmountOutRaw: bigint;
  minimumAmountOutRaw: bigint;
  estimatedGas?: bigint;
  priceImpactBps?: bigint;
  protocolFeeRaw?: bigint;
  route: readonly NormalizedRouteStep[];
  spenderAddress?: Address;
  transactionTarget: Address;
  transactionSelector: Hex;
  sourceBlockNumber: bigint;
  createdAt: string;
  expiresAt: string;
  warnings: readonly QuoteWarning[];
}

export interface ExpectedStateChange {
  assetAddress: Address;
  accountAddress: Address;
  direction: 'increase' | 'decrease';
  amountRaw: bigint;
}

export interface PreparedProtocolTransaction {
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
  to: Address;
  data: Hex;
  value: bigint;
  spenderAddress?: Address;
  functionSelector: Hex;
  deadline: bigint;
  quoteId: string;
  simulation: ProtocolSimulationResult;
  warnings: readonly QuoteWarning[];
  expectedStateChanges: readonly ExpectedStateChange[];
  intent: {
    inputTokenAddress: Address;
    outputTokenAddress: Address;
    amountInRaw: bigint;
    minimumAmountOutRaw: bigint;
    recipientAddress: Address;
    route: readonly NormalizedRouteStep[];
  };
}

export interface PriceImpactRequest {
  amountInRaw: bigint;
  amountOutRaw: bigint;
  reserveInRaw: bigint;
  reserveOutRaw: bigint;
}

export interface PriceImpactResult {
  priceImpactBps: bigint;
}

export interface LaunchpadTokenCreated {
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
  tokenAddress: Address;
  creatorAddress: Address;
  tokenImplementationAddress?: Address;
  initialSupplyRaw: bigint;
  bondingCurveAddress?: Address;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  logIndex: number;
  canonical: boolean;
}

export interface LaunchpadTrade {
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
  tokenAddress: Address;
  bondingCurveAddress: Address;
  traderAddress: Address;
  side: 'buy' | 'sell';
  tokenAmountRaw: bigint;
  paymentAmountRaw: bigint;
  creatorFeeRaw?: bigint;
  protocolFeeRaw?: bigint;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  logIndex: number;
  canonical: boolean;
}

export interface LaunchpadGraduation {
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
  tokenAddress: Address;
  bondingCurveAddress: Address;
  graduationThresholdRaw?: bigint;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  logIndex: number;
  canonical: boolean;
}

export interface LaunchpadMigration {
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
  tokenAddress: Address;
  migrationAddress: Address;
  destinationProtocolKey: string;
  destinationPoolAddress: Address;
  tokenLiquidityRaw?: bigint;
  pairedLiquidityRaw?: bigint;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  logIndex: number;
  canonical: boolean;
}

export interface LaunchpadTokenState {
  tokenAddress: Address;
  bondingCurveAddress?: Address;
  curveProgressBps?: bigint;
  graduationThresholdRaw?: bigint;
  graduated: boolean;
  destinationPoolAddress?: Address;
  sourceBlockNumber: bigint;
  available: boolean;
  unavailableReason?: string;
}

export type NormalizedProtocolEvent =
  | NormalizedPool
  | NormalizedSwap
  | NormalizedLiquidityEvent
  | LaunchpadTokenCreated
  | LaunchpadTrade
  | LaunchpadGraduation
  | LaunchpadMigration;

export interface ProtocolAdapter {
  readonly protocolKey: string;
  readonly protocolName: string;
  readonly version: string;
  readonly chainId: number;
  readonly kind: ProtocolKind;

  validateConfiguration(): Promise<ProtocolValidationResult>;
  getEventDefinitions(): readonly ProtocolEventDefinition[];
  supportsAddress(address: Address): boolean;
  decodeLog(log: RawChainLog): Promise<DecodedProtocolEvent | null>;
}

export interface DexAdapter extends ProtocolAdapter {
  readonly kind: 'dex';

  discoverPool(event: DecodedProtocolEvent): Promise<NormalizedPool | null>;
  readPoolState(poolAddress: Address, blockNumber?: bigint): Promise<NormalizedPoolState>;
  decodeSwap(log: RawChainLog): Promise<NormalizedSwap | null>;
  decodeLiquidityEvent(log: RawChainLog): Promise<NormalizedLiquidityEvent | null>;
  getQuote(request: QuoteRequest): Promise<NormalizedQuote>;
  prepareSwapTransaction(
    quote: NormalizedQuote,
    userAddress: Address,
  ): Promise<PreparedProtocolTransaction>;
  calculatePriceImpact(request: PriceImpactRequest): PriceImpactResult;
  registerPool(pool: NormalizedPool): void;
}

export interface LaunchpadAdapter extends ProtocolAdapter {
  readonly kind: 'launchpad';

  decodeTokenCreation(log: RawChainLog): Promise<LaunchpadTokenCreated | null>;
  decodeBondingCurveTrade(log: RawChainLog): Promise<LaunchpadTrade | null>;
  decodeGraduation(log: RawChainLog): Promise<LaunchpadGraduation | null>;
  decodeMigration(log: RawChainLog): Promise<LaunchpadMigration | null>;
  readLaunchState(tokenAddress: Address, blockNumber?: bigint): Promise<LaunchpadTokenState>;
}

export interface TransactionFeaturePolicy {
  assertTradingEnabled(chainId: number): Promise<void>;
}
