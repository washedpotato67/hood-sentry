import type {
  LaunchpadGraduation,
  LaunchpadMigration,
  LaunchpadTokenCreated,
  LaunchpadTrade,
  NormalizedLiquidityEvent,
  NormalizedPool,
  NormalizedPoolState,
  NormalizedQuote,
  NormalizedSwap,
  ProtocolDefinition,
  ProtocolKind,
  ProtocolValidationResult,
} from '@hood-sentry/chain';
import type { Hash } from 'viem';

export interface ProtocolSummary {
  chainId: number;
  protocolKey: string;
  protocolName: string;
  protocolVersion: string;
  kind: ProtocolKind;
  enabled: boolean;
  validationStatus: 'active' | 'disabled' | 'failed';
  validatedAt: Date | null;
  validationExpiresAt: Date | null;
}

export interface ProtocolVerificationRecord {
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
  contractRole: string;
  address: string;
  expectedRuntimeBytecodeHash: string;
  observedRuntimeBytecodeHash: string | null;
  valid: boolean;
  failureCode: string | null;
  errors: readonly string[];
  checkedAt: Date;
  expiresAt: Date;
}

export interface ProtocolRepository {
  saveProtocolValidation(
    definition: ProtocolDefinition,
    result: ProtocolValidationResult,
    registryVersion: string,
  ): Promise<void>;
  upsertPool(pool: NormalizedPool): Promise<void>;
  upsertPoolTokens(pool: NormalizedPool): Promise<void>;
  updatePoolState(
    chainId: number,
    poolAddress: string,
    state: NormalizedPoolState,
    blockNumber: bigint,
    blockHash: Hash,
  ): Promise<void>;
  insertSwap(swap: NormalizedSwap): Promise<void>;
  insertLiquidityEvent(event: NormalizedLiquidityEvent): Promise<void>;
  insertLaunchpadToken(event: LaunchpadTokenCreated): Promise<void>;
  insertLaunchpadTrade(event: LaunchpadTrade): Promise<void>;
  insertCreatorFeeEvent(event: LaunchpadTrade): Promise<void>;
  insertGraduation(event: LaunchpadGraduation): Promise<void>;
  insertMigration(event: LaunchpadMigration): Promise<void>;
  saveQuote(quote: NormalizedQuote): Promise<void>;
  markDerivedNonCanonical(chainId: number, fromBlock: bigint, toBlock: bigint): Promise<void>;
  listProtocols(chainId: number, kind?: ProtocolKind): Promise<readonly ProtocolSummary[]>;
  listProtocolVerifications(chainId: number): Promise<readonly ProtocolVerificationRecord[]>;
  getActivePools(chainId: number): Promise<readonly NormalizedPool[]>;
  getPool(chainId: number, poolAddress: string, atBlock?: bigint): Promise<NormalizedPool | null>;
  getPoolsByToken(
    chainId: number,
    tokenAddress: string,
    atBlock?: bigint,
  ): Promise<readonly NormalizedPool[]>;
  getSwapsByPool(chainId: number, poolAddress: string): Promise<readonly NormalizedSwap[]>;
  getLiquidityHistory(
    chainId: number,
    poolAddress: string,
    atBlock?: bigint,
  ): Promise<readonly NormalizedLiquidityEvent[]>;
  getLaunchpadToken(chainId: number, tokenAddress: string): Promise<LaunchpadTokenCreated | null>;
  getGraduation(chainId: number, tokenAddress: string): Promise<LaunchpadGraduation | null>;
  getMigration(
    chainId: number,
    tokenAddress: string,
    atBlock?: bigint,
  ): Promise<LaunchpadMigration | null>;
}

export type Pool = NormalizedPool;
export type Swap = NormalizedSwap;
export type PoolRepository = ProtocolRepository;
export type SwapRepository = ProtocolRepository;
