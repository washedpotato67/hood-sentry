import type { Address, Hash, Hex } from 'viem';

export type SimulationAction =
  | 'name'
  | 'symbol'
  | 'decimals'
  | 'totalSupply'
  | 'transfer'
  | 'approve'
  | 'transferFrom'
  | 'zeroValueTransfer'
  | 'buy'
  | 'sell'
  | 'transferAfterBuy'
  | 'sellAfterTransfer'
  | 'repeatedTrade'
  | 'permit'
  | 'bondingCurveBuy'
  | 'bondingCurveSell'
  | 'postGraduationSwap';

export interface ForkConfiguration {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly blockNumber: bigint;
  readonly port: number;
  readonly host: '127.0.0.1';
  readonly timeoutMs: number;
  readonly methodologyVersion: string;
}

export interface SimulationRoute {
  readonly protocolKey: string;
  readonly protocolVersion: string;
  readonly poolAddresses: readonly Address[];
  readonly quoteAsset: Address | null;
  readonly verified: boolean;
}

export interface SimulationRequest {
  readonly chainId: number;
  readonly tokenAddress: Address;
  readonly sourceBlock: bigint;
  readonly sender: Address;
  readonly recipient?: Address;
  readonly action: SimulationAction;
  readonly amountInRaw?: bigint;
  readonly amountOutExpectedRaw?: bigint;
  readonly route?: SimulationRoute;
  readonly target: Address;
  readonly calldata: Hex;
  readonly valueRaw?: bigint;
  readonly allowanceOwner?: Address;
  readonly allowanceSpender?: Address;
  readonly tradeSizeLabel?: string;
  readonly hypotheticalStateOverride?: Readonly<Record<string, unknown>>;
  readonly balanceProbes?: readonly Address[];
  readonly allowanceProbe?: {
    readonly owner: Address;
    readonly spender: Address;
    readonly asset: Address;
  };
}

export interface BalanceChange {
  readonly address: Address;
  readonly asset: Address;
  readonly beforeRaw: bigint | null;
  readonly afterRaw: bigint | null;
  readonly deltaRaw: bigint | null;
  readonly hypothetical: boolean;
}

export interface AllowanceChange {
  readonly owner: Address;
  readonly spender: Address;
  readonly asset: Address;
  readonly beforeRaw: bigint | null;
  readonly afterRaw: bigint | null;
  readonly deltaRaw: bigint | null;
  readonly hypothetical: boolean;
}

export interface SimulationResult {
  readonly success: boolean;
  readonly returnData: Hex;
  readonly revertData: Hex | null;
  readonly decodedError: string | null;
  readonly gasUsed: bigint | null;
  readonly actualOutputRaw: bigint | null;
  readonly balanceChanges: readonly BalanceChange[];
  readonly allowanceChanges: readonly AllowanceChange[];
  readonly effectiveFeeRaw: bigint | null;
}

export interface SimulationExecution {
  readonly simulationId: string;
  readonly tokenAddress: Address;
  readonly chainId: number;
  readonly sourceBlock: bigint;
  readonly sourceBlockHash: Hash;
  readonly fork: ForkConfiguration;
  readonly calldata: Hex;
  readonly target: Address;
  readonly sender: Address;
  readonly route: SimulationRoute | null;
  readonly action: SimulationAction;
  readonly result: SimulationResult;
  readonly expectedOutputRaw: bigint | null;
  readonly warnings: readonly string[];
  readonly hypothetical: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
}

export type SimulationFindingCode =
  | 'BUY_SUCCEEDS_SELL_FAILS'
  | 'ORDINARY_TRANSFER_FAILS'
  | 'PRIVILEGED_SELL_ONLY'
  | 'EXTREME_BUY_TAX'
  | 'EXTREME_SELL_TAX'
  | 'ADDRESS_DEPENDENT_TAX'
  | 'HIDDEN_MAX_WALLET'
  | 'HIDDEN_MAX_TRANSACTION'
  | 'QUOTE_OUTPUT_DIVERGENCE'
  | 'UNEXPECTED_BALANCE_CHANGE'
  | 'LAUNCHPAD_CURVE_STATE_INCONSISTENCY';

export interface SimulationFinding {
  readonly code: SimulationFindingCode;
  readonly status: 'warning' | 'fail' | 'unknown';
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly explanation: string;
  readonly evidence: readonly SimulationExecution[];
  readonly confidence: 'low' | 'medium' | 'high' | 'confirmed';
}

export interface SimulationBatchResult {
  readonly tokenAddress: Address;
  readonly sourceBlock: bigint;
  readonly sourceBlockHash: Hash;
  readonly executions: readonly SimulationExecution[];
  readonly findings: readonly SimulationFinding[];
  readonly status: 'complete' | 'partial' | 'cancelled' | 'quarantined';
  readonly warnings: readonly string[];
}

export interface AnvilForkProcess {
  readonly endpoint: string;
  readonly pid: number | null;
  stop(): Promise<void>;
}

export interface AnvilForkLauncher {
  start(configuration: ForkConfiguration): Promise<AnvilForkProcess>;
}

export interface SimulationProvider {
  getBlockHash(blockNumber: bigint, endpoint?: string): Promise<Hash>;
  execute(request: SimulationRequest, endpoint: string): Promise<SimulationResult>;
  reset(): Promise<void>;
}

export interface DisposableAccountAllocator {
  allocate(count: number): readonly Address[];
}
