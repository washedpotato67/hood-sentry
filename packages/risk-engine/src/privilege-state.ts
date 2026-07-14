import {
  type Address,
  type Hash,
  type Hex,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  stringToHex,
  toHex,
  zeroAddress,
} from 'viem';
import type { CurrentRoleController } from './privilege-types.js';
import type { SoliditySourceAst } from './privilege-types.js';
import { classifyAddressAuthority, readContractOwner } from './proxy-analysis.js';
import type { AddressAuthority, ProxyAnalysisClient } from './proxy-types.js';

const ACCESS_CONTROL_ENUMERABLE_ABI = parseAbi([
  'function getRoleMemberCount(bytes32 role) view returns (uint256)',
  'function getRoleMember(bytes32 role,uint256 index) view returns (address)',
  'function hasRole(bytes32 role,address account) view returns (bool)',
]);

export interface RoleDefinition {
  readonly name: string;
  readonly id: Hash;
  readonly candidateHolders?: readonly Address[];
}

export interface PrivilegeStateInput {
  readonly contractAddress: Address;
  readonly sourceBlock: bigint;
  readonly roles: readonly RoleDefinition[];
  readonly maxEnumerableRoleMembers?: number;
  readonly provenanceKey: string;
}

export function extractAccessControlRoles(ast: SoliditySourceAst): readonly RoleDefinition[] {
  const roles = new Map<string, RoleDefinition>();
  for (const variable of ast.contracts.flatMap((contract) => contract.stateVariables)) {
    if (variable.type !== 'bytes32' || !/(ROLE|role)/.test(variable.name)) continue;
    const literal = /keccak256\s*\(\s*("[^"]+"|'[^']+')\s*\)/.exec(variable.declaration)?.[1];
    const direct = /=\s*(0x[0-9a-fA-F]{1,64})/.exec(variable.declaration)?.[1];
    let id: Hash | null = null;
    if (literal !== undefined) id = keccak256(stringToHex(literal.slice(1, -1)));
    if (direct !== undefined) id = toHex(BigInt(direct), { size: 32 });
    if (id !== null) roles.set(variable.name, { name: variable.name, id });
  }
  return [...roles.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function safeCall(
  client: ProxyAnalysisClient,
  to: Address,
  data: Hex,
  blockNumber: bigint,
): Promise<Hex | null> {
  try {
    const result = await client.call({ to, data, blockNumber });
    return result === '0x' ? null : result;
  } catch {
    return null;
  }
}

function unknownAuthority(address: Address | null): AddressAuthority {
  return {
    address,
    kind: address === null ? 'renounced' : 'unknown',
    ownerAddress: null,
    safeThreshold: null,
    safeOwners: [],
    timelockDelaySeconds: null,
    hasCode: null,
    evidence: ['Controller classification was unavailable'],
  };
}

async function enumerableRoleHolders(
  client: ProxyAnalysisClient,
  input: PrivilegeStateInput,
  role: RoleDefinition,
): Promise<readonly Address[] | null> {
  const countResult = await safeCall(
    client,
    input.contractAddress,
    encodeFunctionData({
      abi: ACCESS_CONTROL_ENUMERABLE_ABI,
      functionName: 'getRoleMemberCount',
      args: [role.id],
    }),
    input.sourceBlock,
  );
  if (countResult === null) return null;
  try {
    const count = decodeFunctionResult({
      abi: ACCESS_CONTROL_ENUMERABLE_ABI,
      functionName: 'getRoleMemberCount',
      data: countResult,
    });
    const limit = BigInt(input.maxEnumerableRoleMembers ?? 128);
    if (count > limit) return null;
    const holders: Address[] = [];
    for (let index = 0n; index < count; index += 1n) {
      const memberResult = await safeCall(
        client,
        input.contractAddress,
        encodeFunctionData({
          abi: ACCESS_CONTROL_ENUMERABLE_ABI,
          functionName: 'getRoleMember',
          args: [role.id, index],
        }),
        input.sourceBlock,
      );
      if (memberResult === null) return null;
      holders.push(
        decodeFunctionResult({
          abi: ACCESS_CONTROL_ENUMERABLE_ABI,
          functionName: 'getRoleMember',
          data: memberResult,
        }),
      );
    }
    return holders;
  } catch {
    return null;
  }
}

async function activeCandidateHolders(
  client: ProxyAnalysisClient,
  input: PrivilegeStateInput,
  role: RoleDefinition,
): Promise<readonly Address[]> {
  const active: Address[] = [];
  for (const candidate of role.candidateHolders ?? []) {
    const result = await safeCall(
      client,
      input.contractAddress,
      encodeFunctionData({
        abi: ACCESS_CONTROL_ENUMERABLE_ABI,
        functionName: 'hasRole',
        args: [role.id, candidate],
      }),
      input.sourceBlock,
    );
    if (result === null) continue;
    try {
      if (
        decodeFunctionResult({
          abi: ACCESS_CONTROL_ENUMERABLE_ABI,
          functionName: 'hasRole',
          data: result,
        })
      ) {
        active.push(candidate);
      }
    } catch {
      // Malformed role responses remain absent from confirmed controller state.
    }
  }
  return active;
}

export class PrivilegeStateReader {
  constructor(private readonly client: ProxyAnalysisClient) {}

  async readControllers(input: PrivilegeStateInput): Promise<readonly CurrentRoleController[]> {
    const controllers: CurrentRoleController[] = [];
    const owner = await readContractOwner(this.client, input.contractAddress, input.sourceBlock);
    if (owner !== null && owner.toLowerCase() !== zeroAddress) {
      controllers.push({
        role: 'owner',
        holder: getAddress(owner),
        authority: await classifyAddressAuthority(this.client, owner, input.sourceBlock),
        active: true,
        provenanceKey: input.provenanceKey,
      });
    } else {
      controllers.push({
        role: 'owner',
        holder: null,
        authority: unknownAuthority(null),
        active: false,
        provenanceKey: input.provenanceKey,
      });
    }

    for (const role of [...input.roles].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const enumerable = await enumerableRoleHolders(this.client, input, role);
      const holders = enumerable ?? (await activeCandidateHolders(this.client, input, role));
      if (holders.length === 0) {
        controllers.push({
          role: role.name,
          holder: null,
          authority: unknownAuthority(null),
          active: false,
          provenanceKey: input.provenanceKey,
        });
        continue;
      }
      for (const holder of holders) {
        controllers.push({
          role: role.name,
          holder,
          authority: await classifyAddressAuthority(this.client, holder, input.sourceBlock),
          active: true,
          provenanceKey: input.provenanceKey,
        });
      }
    }
    return controllers;
  }
}
