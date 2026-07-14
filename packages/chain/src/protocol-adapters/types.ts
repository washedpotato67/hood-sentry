import type { Abi, Address, Hash, Hex } from 'viem';

export const FEE_DENOMINATOR = 1_000_000n;

export type ProtocolContractRole = 'factory' | 'router' | 'quoter' | 'position-manager' | 'permit2';

export interface VerifiedProtocolContract {
  role: ProtocolContractRole;
  address: Address;
  runtimeBytecodeHash: Hash;
  source: string;
  verifiedAt: string;
}

export interface ProtocolEventSignatures {
  poolCreated: string;
  swap: string;
  liquidityAdded: string;
  liquidityRemoved: string;
}

export interface ProtocolAdapterManifest {
  chainId: number;
  protocol: string;
  version: string;
  factory: VerifiedProtocolContract;
  router: VerifiedProtocolContract | null;
  quoter: VerifiedProtocolContract | null;
  positionManager: VerifiedProtocolContract | null;
  permit2: VerifiedProtocolContract | null;
  supportedFeeTiers: readonly number[];
  eventSignatures: ProtocolEventSignatures;
  source: string;
  bytecodeHashes: Readonly<Record<ProtocolContractRole, Hash | null>>;
}

export interface BlockProvenance {
  chainId: number;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  logIndex: number;
}

export interface ProtocolLog extends BlockProvenance {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
}

export interface ConstantProductState {
  model: 'constant-product';
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
}

export interface ConcentratedLiquidityState {
  model: 'concentrated-liquidity';
  sqrtPriceX96: bigint;
  tick: number;
  activeLiquidity: bigint;
}

export type NormalizedPoolState = ConstantProductState | ConcentratedLiquidityState;

export interface NormalizedPool {
  protocol: string;
  version: string;
  factory: Address;
  address: Address;
  token0: Address;
  token1: Address;
  fee: number;
  liquidity: bigint;
  state: NormalizedPoolState;
  provenance: BlockProvenance;
}

export type SwapDirection = 'token0-to-token1' | 'token1-to-token0';

export interface NormalizedSwap {
  kind: 'swap';
  protocol: string;
  version: string;
  poolAddress: Address;
  token0: Address;
  token1: Address;
  fee: number;
  direction: SwapDirection;
  amountIn: bigint;
  amountOut: bigint;
  sender: Address;
  recipient: Address;
  provenance: BlockProvenance;
}

export interface NormalizedLiquidityChange {
  kind: 'liquidity-addition' | 'liquidity-removal';
  protocol: string;
  version: string;
  poolAddress: Address;
  token0: Address;
  token1: Address;
  amount0: bigint;
  amount1: bigint;
  sender: Address;
  recipient: Address | null;
  provenance: BlockProvenance;
}

export interface RouteLeg {
  protocol: string;
  version: string;
  poolAddress: Address;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
}

export interface ProtocolRoute {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  legs: readonly RouteLeg[];
}

export interface QuoteRequest {
  route: ProtocolRoute;
  amountIn: bigint;
}

export interface ProtocolQuote {
  route: ProtocolRoute;
  amountIn: bigint;
  amountOut: bigint;
  blockNumber: bigint;
  provider: string;
}

export interface PriceImpactRequest {
  amountIn: bigint;
  amountOut: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
}

export interface PriceImpactResult {
  impactBps: bigint;
}

export interface TransactionPreparationRequest {
  sender: Address;
  recipient: Address;
  route: ProtocolRoute;
  amountIn: bigint;
  minimumAmountOut: bigint;
  deadline: bigint;
}

export interface PreparedProtocolTransaction {
  chainId: number;
  to: Address;
  data: Hex;
  value: bigint;
  deadline: bigint;
  intent: {
    protocol: string;
    version: string;
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    minimumAmountOut: bigint;
    recipient: Address;
  };
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

export interface ProtocolReadClient {
  getChainId(): Promise<number>;
  getBytecode(address: Address): Promise<Hex | undefined>;
  getBlockNumber(): Promise<bigint>;
  getBlockTimestamp(): Promise<bigint>;
  readContract(request: ProtocolReadRequest): Promise<unknown>;
}

export interface ProtocolExecutionClient extends ProtocolReadClient {
  simulateTransaction(
    request: ProtocolSimulationRequest,
  ): Promise<{ success: boolean; error?: string }>;
}

export interface FactoryEventDiscovery {
  discoverPool(log: ProtocolLog): NormalizedPool | null;
}

export interface PoolMetadataReader {
  readPoolMetadata(
    client: ProtocolReadClient,
    poolAddress: Address,
    provenance: BlockProvenance,
  ): Promise<NormalizedPool>;
}

export interface PoolStateReader {
  readPoolState(
    client: ProtocolReadClient,
    poolAddress: Address,
    blockNumber?: bigint,
  ): Promise<NormalizedPoolState>;
}

export interface SwapEventDecoder {
  decodeSwap(log: ProtocolLog, pool: NormalizedPool): NormalizedSwap | null;
}

export interface LiquidityAdditionDecoder {
  decodeLiquidityAddition(log: ProtocolLog, pool: NormalizedPool): NormalizedLiquidityChange | null;
}

export interface LiquidityRemovalDecoder {
  decodeLiquidityRemoval(log: ProtocolLog, pool: NormalizedPool): NormalizedLiquidityChange | null;
}

export interface QuoteProvider {
  quote(client: ProtocolReadClient, request: QuoteRequest): Promise<ProtocolQuote>;
}

export interface TransactionPreparer {
  prepareTransaction(
    client: ProtocolExecutionClient,
    request: TransactionPreparationRequest,
  ): Promise<PreparedProtocolTransaction>;
}

export interface PriceImpactCalculator {
  calculatePriceImpact(request: PriceImpactRequest): PriceImpactResult;
}

export interface ProtocolAdapter
  extends FactoryEventDiscovery,
    PoolMetadataReader,
    PoolStateReader,
    SwapEventDecoder,
    LiquidityAdditionDecoder,
    LiquidityRemovalDecoder,
    QuoteProvider,
    TransactionPreparer,
    PriceImpactCalculator {
  readonly manifest: ProtocolAdapterManifest;
  assertSupportedFeeTier(fee: number): void;
}

export type NormalizedProtocolEvent = NormalizedSwap | NormalizedLiquidityChange;
