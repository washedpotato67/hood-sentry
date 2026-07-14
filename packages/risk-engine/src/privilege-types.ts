import type { Address, Hash, Hex } from 'viem';
import type { AddressAuthority, InitializationEvidence } from './proxy-types.js';

export type PrivilegeCapability =
  | 'mint'
  | 'unbounded_mint'
  | 'capped_mint'
  | 'burn_authority'
  | 'pause'
  | 'blacklist'
  | 'whitelist'
  | 'forced_transfer'
  | 'confiscation'
  | 'transfer_fees'
  | 'mutable_fees'
  | 'fee_limits'
  | 'fee_exemptions'
  | 'max_transaction'
  | 'max_wallet'
  | 'trading_toggle'
  | 'mutable_router'
  | 'mutable_pair'
  | 'rescue'
  | 'owner_withdrawal'
  | 'arbitrary_call'
  | 'delegatecall'
  | 'role_administration'
  | 'upgrade_authorization'
  | 'rebase'
  | 'reflection'
  | 'mutable_metadata'
  | 'permit'
  | 'self_destruct';

export interface AttributedSourceFile {
  readonly path: string;
  readonly source: string;
  readonly provider: string;
  readonly fetchedAt: string;
  readonly sourceHash: Hex;
}

export interface ContractAbiParameter {
  readonly name?: string;
  readonly type: string;
  readonly internalType?: string;
  readonly components?: readonly ContractAbiParameter[];
}

export interface ContractAbiItem {
  readonly type: 'constructor' | 'error' | 'event' | 'fallback' | 'function' | 'receive';
  readonly name?: string;
  readonly stateMutability?: 'pure' | 'view' | 'nonpayable' | 'payable';
  readonly inputs?: readonly ContractAbiParameter[];
  readonly outputs?: readonly ContractAbiParameter[];
}

export interface CurrentRoleController {
  readonly role: string;
  readonly holder: Address | null;
  readonly authority: AddressAuthority;
  readonly active: boolean;
  readonly provenanceKey: string;
}

export interface PrivilegeAnalysisInput {
  readonly chainId: number;
  readonly address: Address;
  readonly sourceBlock: bigint;
  readonly sourceBlockHash: Hash;
  readonly contractName?: string;
  readonly sourceVerified: boolean;
  readonly sourceFiles?: readonly AttributedSourceFile[];
  readonly abi?: readonly ContractAbiItem[] | null;
  readonly runtimeBytecode: Hex;
  readonly controllers: readonly CurrentRoleController[];
}

export interface SolidityStateVariable {
  readonly contractName: string;
  readonly name: string;
  readonly type: string;
  readonly visibility: string | null;
  readonly constant: boolean;
  readonly immutable: boolean;
  readonly declaration: string;
  readonly sourcePath: string;
  readonly line: number;
}

export interface SolidityModifier {
  readonly contractName: string;
  readonly name: string;
  readonly parameters: readonly string[];
  readonly body: string;
  readonly sourcePath: string;
  readonly line: number;
}

export interface SolidityFunction {
  readonly contractName: string;
  readonly name: string;
  readonly signature: string;
  readonly selector: Hex | null;
  readonly visibility: 'public' | 'external' | 'internal' | 'private' | null;
  readonly stateMutability: 'pure' | 'view' | 'payable' | 'nonpayable';
  readonly modifiers: readonly string[];
  readonly parameterNames: readonly string[];
  readonly body: string;
  readonly declaration: string;
  readonly sourcePath: string;
  readonly line: number;
  readonly kind: 'function' | 'constructor' | 'fallback' | 'receive';
}

export interface SolidityContractAst {
  readonly name: string;
  readonly kind: 'contract' | 'interface' | 'library';
  readonly abstract: boolean;
  readonly inherits: readonly string[];
  readonly stateVariables: readonly SolidityStateVariable[];
  readonly modifiers: readonly SolidityModifier[];
  readonly functions: readonly SolidityFunction[];
  readonly sourcePath: string;
}

export interface SoliditySourceAst {
  readonly contracts: readonly SolidityContractAst[];
  readonly parseWarnings: readonly string[];
}

export interface PrivilegeBound {
  readonly kind: 'constant' | 'state_variable' | 'requirement' | 'none' | 'unknown';
  readonly expression: string | null;
  readonly stateVariable: string | null;
}

export interface PrivilegeEvidence {
  readonly kind: 'source_ast' | 'abi' | 'bytecode_selector';
  readonly sourcePath: string | null;
  readonly line: number | null;
  readonly functionName: string | null;
  readonly selector: Hex | null;
  readonly excerpt: string;
  readonly provider: string | null;
  readonly fetchedAt: string | null;
  readonly sourceHash: Hex | null;
  readonly provenanceKeys: readonly string[];
}

export interface PrivilegeFinding {
  readonly capability: PrivilegeCapability;
  readonly functionName: string | null;
  readonly selector: Hex | null;
  readonly role: string;
  readonly currentControllers: readonly CurrentRoleController[];
  readonly bounds: PrivilegeBound;
  readonly controlledStateVariables: readonly SolidityStateVariable[];
  readonly timelock: boolean | null;
  readonly multisig: boolean | null;
  readonly eoaControlled: boolean | null;
  readonly renounced: boolean;
  readonly confidence: 'low' | 'medium' | 'high' | 'confirmed';
  readonly conclusion: 'confirmed' | 'indicated' | 'unknown';
  readonly explanation: string;
  readonly evidence: readonly PrivilegeEvidence[];
}

export interface ExternalCallSurface {
  readonly functionName: string;
  readonly selector: Hex | null;
  readonly callType: 'call' | 'delegatecall' | 'staticcall' | 'transfer' | 'send';
  readonly targetExpression: string;
  readonly sourcePath: string;
  readonly line: number;
}

export interface PrivilegeAnalysisResult {
  readonly chainId: number;
  readonly address: Address;
  readonly sourceBlock: bigint;
  readonly sourceBlockHash: Hash;
  readonly sourceVerified: boolean;
  readonly ast: SoliditySourceAst | null;
  readonly inheritance: Readonly<Record<string, readonly string[]>>;
  readonly modifiers: readonly SolidityModifier[];
  readonly stateVariables: readonly SolidityStateVariable[];
  readonly externalCallSurfaces: readonly ExternalCallSurface[];
  readonly findings: readonly PrivilegeFinding[];
  readonly initializationEvidence: InitializationEvidence;
  readonly warnings: readonly string[];
}
