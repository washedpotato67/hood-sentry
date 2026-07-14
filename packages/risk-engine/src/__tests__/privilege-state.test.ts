import {
  type Address,
  type Hash,
  type Hex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  stringToHex,
} from 'viem';
import { describe, expect, it } from 'vitest';
import { PrivilegeStateReader } from '../privilege-state.js';
import type { ProxyAnalysisClient } from '../proxy-types.js';

const CONTRACT = getAddress('0x1000000000000000000000000000000000000001');
const OWNER = getAddress('0x2000000000000000000000000000000000000002');
const MINTER = getAddress('0x3000000000000000000000000000000000000003');
const MINTER_ROLE = keccak256(stringToHex('MINTER_ROLE'));
const OWNER_ABI = parseAbi(['function owner() view returns (address)']);
const ROLE_ABI = parseAbi([
  'function getRoleMemberCount(bytes32 role) view returns (uint256)',
  'function getRoleMember(bytes32 role,uint256 index) view returns (address)',
]);

class StateClient implements ProxyAnalysisClient {
  readonly calls = new Map<string, Hex>();

  setCall(data: Hex, result: Hex): void {
    this.calls.set(data.toLowerCase(), result);
  }

  async getCode(address: Address): Promise<Hex> {
    return Promise.resolve(address === CONTRACT ? '0x6001' : '0x');
  }

  async getStorageAt(_address: Address, _slot: Hash): Promise<Hex> {
    return Promise.resolve('0x');
  }

  async call(params: { to: Address; data: Hex }): Promise<Hex> {
    if (params.to !== CONTRACT) throw new Error('authority call unavailable');
    const result = this.calls.get(params.data.toLowerCase());
    if (result === undefined) throw new Error('fixture call unavailable');
    return Promise.resolve(result);
  }

  async getLogs(): Promise<[]> {
    return Promise.resolve([]);
  }
}

describe('privilege state reader', () => {
  it('reads Ownable and enumerable AccessControl holders at the pinned block', async () => {
    const client = new StateClient();
    client.setCall(
      encodeFunctionData({ abi: OWNER_ABI, functionName: 'owner' }),
      encodeAbiParameters([{ type: 'address' }], [OWNER]),
    );
    client.setCall(
      encodeFunctionData({
        abi: ROLE_ABI,
        functionName: 'getRoleMemberCount',
        args: [MINTER_ROLE],
      }),
      encodeAbiParameters([{ type: 'uint256' }], [1n]),
    );
    client.setCall(
      encodeFunctionData({
        abi: ROLE_ABI,
        functionName: 'getRoleMember',
        args: [MINTER_ROLE, 0n],
      }),
      encodeAbiParameters([{ type: 'address' }], [MINTER]),
    );

    const controllers = await new PrivilegeStateReader(client).readControllers({
      contractAddress: CONTRACT,
      sourceBlock: 100n,
      roles: [{ name: 'MINTER_ROLE', id: MINTER_ROLE }],
      provenanceKey: 'chain_privilege_state',
    });

    expect(controllers.map((controller) => [controller.role, controller.holder])).toEqual([
      ['owner', OWNER],
      ['MINTER_ROLE', MINTER],
    ]);
    expect(controllers.every((controller) => controller.authority.kind === 'eoa')).toBe(true);
  });
});
