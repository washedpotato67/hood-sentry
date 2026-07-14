import {
  type Address,
  type Hash,
  type Hex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  pad,
  parseAbi,
  stringToHex,
} from 'viem';
import { describe, expect, it } from 'vitest';
import {
  EIP1967_ADMIN_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  ProxyAnalyzer,
} from '../proxy-analysis.js';
import type { ProxyAnalysisClient, ProxyAnalysisInput, ProxyReadLog } from '../proxy-types.js';

const HASH = `0x${'11'.repeat(32)}` as Hash;
const PROXY = getAddress('0x1000000000000000000000000000000000000001');
const IMPLEMENTATION = getAddress('0x2000000000000000000000000000000000000002');
const SECOND_IMPLEMENTATION = getAddress('0x3000000000000000000000000000000000000003');
const ADMIN = getAddress('0x4000000000000000000000000000000000000004');
const BEACON = getAddress('0x5000000000000000000000000000000000000005');
const OWNER = getAddress('0x6000000000000000000000000000000000000006');
const SAFE_OWNER = getAddress('0x7000000000000000000000000000000000000007');
const FACTORY = getAddress('0x8000000000000000000000000000000000000008');

const OWNER_ABI = parseAbi(['function owner() view returns (address)']);
const PROXIABLE_ABI = parseAbi(['function proxiableUUID() view returns (bytes32)']);
const BEACON_ABI = parseAbi(['function implementation() view returns (address)']);
const SAFE_THRESHOLD_ABI = parseAbi(['function getThreshold() view returns (uint256)']);
const SAFE_OWNERS_ABI = parseAbi(['function getOwners() view returns (address[])']);
const TIMELOCK_ABI = parseAbi(['function getMinDelay() view returns (uint256)']);
const FACET_ABI = parseAbi(['function facetAddresses() view returns (address[])']);

function storageValue(address: Address): Hex {
  return pad(address, { size: 32 });
}

function callKey(address: Address, data: Hex): string {
  return `${address.toLowerCase()}:${data.toLowerCase()}`;
}

class FixtureClient implements ProxyAnalysisClient {
  readonly code = new Map<string, Hex>();
  readonly storage = new Map<string, Hex>();
  readonly calls = new Map<string, Hex | Error>();
  logs: readonly ProxyReadLog[] = [];

  setCode(address: Address, code: Hex): void {
    this.code.set(address.toLowerCase(), code);
  }

  setStorage(address: Address, slot: Hash, value: Hex): void {
    this.storage.set(`${address.toLowerCase()}:${slot.toLowerCase()}`, value);
  }

  setCall(address: Address, data: Hex, value: Hex): void {
    this.calls.set(callKey(address, data), value);
  }

  async getCode(address: Address): Promise<Hex> {
    return Promise.resolve(this.code.get(address.toLowerCase()) ?? '0x');
  }

  async getStorageAt(address: Address, slot: Hash): Promise<Hex> {
    return Promise.resolve(
      this.storage.get(`${address.toLowerCase()}:${slot.toLowerCase()}`) ?? '0x',
    );
  }

  async call(params: { to: Address; data: Hex }): Promise<Hex> {
    const value = this.calls.get(callKey(params.to, params.data));
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error('call unavailable');
    return Promise.resolve(value);
  }

  async getLogs(): Promise<readonly ProxyReadLog[]> {
    return Promise.resolve(this.logs);
  }
}

function baseInput(overrides: Partial<ProxyAnalysisInput> = {}): ProxyAnalysisInput {
  return {
    chainId: 46630,
    address: PROXY,
    sourceBlock: 100_000n,
    sourceBlockHash: HASH,
    ...overrides,
  };
}

function setOwnerCall(client: FixtureClient, address: Address, owner: Address): void {
  client.setCall(
    address,
    encodeFunctionData({ abi: OWNER_ABI, functionName: 'owner' }),
    encodeAbiParameters([{ type: 'address' }], [owner]),
  );
}

function transparentFixture(): FixtureClient {
  const client = new FixtureClient();
  client.setCode(PROXY, '0x6001600055');
  client.setCode(IMPLEMENTATION, '0x6002600055');
  client.setStorage(PROXY, EIP1967_IMPLEMENTATION_SLOT, storageValue(IMPLEMENTATION));
  client.setStorage(PROXY, EIP1967_ADMIN_SLOT, storageValue(ADMIN));
  return client;
}

describe('proxy and upgradeability analysis', () => {
  it('resolves transparent proxy slots and an EOA admin from direct chain state', async () => {
    const client = transparentFixture();
    const result = await new ProxyAnalyzer(client).analyze(baseInput());

    expect(result.proxyKind).toBe('transparent');
    expect(result.implementationAddress).toBe(IMPLEMENTATION);
    expect(result.adminAddress).toBe(ADMIN);
    expect(result.upgradeAuthority.kind).toBe('eoa');
    expect(result.layers[0]?.implementationSlot.slot).toBe(EIP1967_IMPLEMENTATION_SLOT);
    expect(result.findings.map((finding) => finding.code)).toContain('EOA_CONTROLLED_UPGRADES');
  });

  it('resolves a UUPS proxy and its owner authority', async () => {
    const client = new FixtureClient();
    client.setCode(PROXY, '0x6001600055');
    client.setCode(IMPLEMENTATION, '0x6002600055');
    client.setStorage(PROXY, EIP1967_IMPLEMENTATION_SLOT, storageValue(IMPLEMENTATION));
    client.setCall(
      IMPLEMENTATION,
      encodeFunctionData({ abi: PROXIABLE_ABI, functionName: 'proxiableUUID' }),
      encodeAbiParameters([{ type: 'bytes32' }], [EIP1967_IMPLEMENTATION_SLOT]),
    );
    setOwnerCall(client, PROXY, OWNER);

    const result = await new ProxyAnalyzer(client).analyze(baseInput());
    expect(result.proxyKind).toBe('uups');
    expect(result.currentOwner).toBe(OWNER);
    expect(result.upgradeAuthority.kind).toBe('eoa');
  });

  it('resolves a beacon proxy and beacon implementation', async () => {
    const client = new FixtureClient();
    client.setCode(PROXY, '0x6001600055');
    client.setCode(BEACON, '0x6002600055');
    client.setCode(IMPLEMENTATION, '0x6003600055');
    client.setStorage(PROXY, EIP1967_BEACON_SLOT, storageValue(BEACON));
    client.setCall(
      BEACON,
      encodeFunctionData({ abi: BEACON_ABI, functionName: 'implementation' }),
      encodeAbiParameters([{ type: 'address' }], [IMPLEMENTATION]),
    );

    const result = await new ProxyAnalyzer(client).analyze(baseInput());
    expect(result.proxyKind).toBe('beacon');
    expect(result.beaconAddress).toBe(BEACON);
    expect(result.implementationAddress).toBe(IMPLEMENTATION);
  });

  it('detects a minimal clone and a common clone factory surface', async () => {
    const client = new FixtureClient();
    client.setCode(
      PROXY,
      `0x363d3d373d3d3d363d73${IMPLEMENTATION.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`,
    );
    client.setCode(IMPLEMENTATION, '0x6001600055');
    const cloneSelector = keccak256(stringToHex('clone(address)')).slice(2, 10);
    client.setCode(FACTORY, `0x63${cloneSelector}600052`);

    const result = await new ProxyAnalyzer(client).analyze(
      baseInput({ cloneFactoryAddress: FACTORY }),
    );
    expect(result.proxyKind).toBe('minimal_clone');
    expect(result.implementationAddress).toBe(IMPLEMENTATION);
    expect(result.layers[0]?.indicators).toContain(
      'Creation factory exposes a common clone deployment selector',
    );
  });

  it('records nested proxy layers', async () => {
    const client = transparentFixture();
    client.setStorage(
      IMPLEMENTATION,
      EIP1967_IMPLEMENTATION_SLOT,
      storageValue(SECOND_IMPLEMENTATION),
    );
    client.setCode(SECOND_IMPLEMENTATION, '0x6003600055');
    client.setCall(
      SECOND_IMPLEMENTATION,
      encodeFunctionData({ abi: PROXIABLE_ABI, functionName: 'proxiableUUID' }),
      encodeAbiParameters([{ type: 'bytes32' }], [EIP1967_IMPLEMENTATION_SLOT]),
    );

    const result = await new ProxyAnalyzer(client).analyze(baseInput());
    expect(result.layers).toHaveLength(2);
    expect(result.layers[1]?.kind).toBe('uups');
    expect(result.findings.map((finding) => finding.code)).toContain('NESTED_PROXY_COMPLEXITY');
  });

  it('detects a common diamond surface', async () => {
    const client = new FixtureClient();
    client.setCode(PROXY, '0x6001600055f4');
    client.setCall(
      PROXY,
      encodeFunctionData({ abi: FACET_ABI, functionName: 'facetAddresses' }),
      encodeAbiParameters([{ type: 'address[]' }], [[IMPLEMENTATION]]),
    );

    const result = await new ProxyAnalyzer(client).analyze(baseInput());
    expect(result.proxyKind).toBe('diamond');
  });

  it('separates non-proxies from unknown delegatecall proxies', async () => {
    const ordinary = new FixtureClient();
    ordinary.setCode(PROXY, '0x6001600055');
    const nonProxy = await new ProxyAnalyzer(ordinary).analyze(baseInput());
    expect(nonProxy.proxyKind).toBe('none');

    const delegate = new FixtureClient();
    delegate.setCode(PROXY, '0x60006000f4');
    const unknown = await new ProxyAnalyzer(delegate).analyze(baseInput());
    expect(unknown.proxyKind).toBe('unknown_delegatecall');
    expect(unknown.findings.map((finding) => finding.code)).toContain('SUSPICIOUS_DELEGATECALL');
  });

  it('reports an implementation slot whose target has no code', async () => {
    const client = transparentFixture();
    client.setCode(IMPLEMENTATION, '0x');
    const result = await new ProxyAnalyzer(client).analyze(baseInput());
    expect(result.implementationCodeHash).toBeNull();
    expect(result.findings.map((finding) => finding.code)).toContain('IMPLEMENTATION_WITHOUT_CODE');
  });

  it('classifies Safe and timelock admins by pinned direct calls', async () => {
    const safe = transparentFixture();
    safe.setCode(ADMIN, '0x6001600055');
    safe.setCall(
      ADMIN,
      encodeFunctionData({ abi: SAFE_THRESHOLD_ABI, functionName: 'getThreshold' }),
      encodeAbiParameters([{ type: 'uint256' }], [1n]),
    );
    safe.setCall(
      ADMIN,
      encodeFunctionData({ abi: SAFE_OWNERS_ABI, functionName: 'getOwners' }),
      encodeAbiParameters([{ type: 'address[]' }], [[SAFE_OWNER]]),
    );
    const safeResult = await new ProxyAnalyzer(safe).analyze(baseInput());
    expect(safeResult.upgradeAuthority.kind).toBe('safe');

    const timelock = transparentFixture();
    timelock.setCode(ADMIN, '0x6001600055');
    timelock.setCall(
      ADMIN,
      encodeFunctionData({ abi: TIMELOCK_ABI, functionName: 'getMinDelay' }),
      encodeAbiParameters([{ type: 'uint256' }], [172_800n]),
    );
    const timelockResult = await new ProxyAnalyzer(timelock).analyze(baseInput());
    expect(timelockResult.upgradeAuthority.kind).toBe('timelock');
    expect(timelockResult.upgradeAuthority.timelockDelaySeconds).toBe(172_800n);
    expect(timelockResult.findings.map((finding) => finding.code)).not.toContain('NO_TIMELOCK');
  });

  it('reports uninitialized state and exposed initializer evidence', async () => {
    const client = transparentFixture();
    const result = await new ProxyAnalyzer(client).analyze(
      baseInput({
        initialization: {
          proxyInitialized: false,
          exposedInitializer: true,
          implementationInitializersDisabled: false,
          storageSlot: HASH,
          storageValue: `0x${'00'.repeat(32)}`,
          provenanceKey: 'chain_initializable_storage',
        },
      }),
    );
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'UNINITIALIZED_PROXY',
        'EXPOSED_INITIALIZER',
        'IMPLEMENTATION_INITIALIZER_NOT_DISABLED',
      ]),
    );
  });

  it('preserves explorer disagreement while preferring direct chain state', async () => {
    const client = transparentFixture();
    const result = await new ProxyAnalyzer(client).analyze(
      baseInput({
        explorer: {
          provider: 'blockscout',
          fetchedAt: '2026-07-14T10:00:00.000Z',
          proxyType: 'UUPS',
          implementationAddresses: [SECOND_IMPLEMENTATION],
          adminAddress: OWNER,
        },
      }),
    );
    expect(result.implementationAddress).toBe(IMPLEMENTATION);
    expect(result.conflicts.map((conflict) => conflict.field)).toEqual(
      expect.arrayContaining(['implementation_address', 'admin_address', 'proxy_type']),
    );
    expect(result.findings.map((finding) => finding.code)).toContain('PROXY_METADATA_DISAGREEMENT');
  });
});
