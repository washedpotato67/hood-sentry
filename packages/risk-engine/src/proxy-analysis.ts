import {
  type Address,
  type Hash,
  type Hex,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  stringToHex,
  toHex,
  zeroAddress,
} from 'viem';
import type {
  AddressAuthority,
  ExplorerProxyClaim,
  ProxyAnalysisClient,
  ProxyAnalysisFinding,
  ProxyAnalysisInput,
  ProxyAnalysisResult,
  ProxyKind,
  ProxyLayer,
  ProxyMetadataConflict,
  SourceVerificationClaim,
  StorageSlotEvidence,
  UpgradeEventEvidence,
} from './proxy-types.js';

function eip1967Slot(label: string): Hash {
  return toHex(BigInt(keccak256(stringToHex(label))) - 1n, { size: 32 });
}

export const EIP1967_IMPLEMENTATION_SLOT = eip1967Slot('eip1967.proxy.implementation');
export const EIP1967_ADMIN_SLOT = eip1967Slot('eip1967.proxy.admin');
export const EIP1967_BEACON_SLOT = eip1967Slot('eip1967.proxy.beacon');

const OWNER_ABI = parseAbi(['function owner() view returns (address)']);
const SAFE_THRESHOLD_ABI = parseAbi(['function getThreshold() view returns (uint256)']);
const SAFE_OWNERS_ABI = parseAbi(['function getOwners() view returns (address[])']);
const TIMELOCK_ABI = parseAbi(['function getMinDelay() view returns (uint256)']);
const BEACON_ABI = parseAbi(['function implementation() view returns (address)']);
const PROXIABLE_ABI = parseAbi(['function proxiableUUID() view returns (bytes32)']);
const DIAMOND_ABI = parseAbi([
  'function facetAddresses() view returns (address[])',
  'function diamondCut((address,uint8,bytes4[])[],address,bytes)',
]);

const UPGRADED_TOPIC = keccak256(stringToHex('Upgraded(address)'));
const ADMIN_CHANGED_TOPIC = keccak256(stringToHex('AdminChanged(address,address)'));
const BEACON_UPGRADED_TOPIC = keccak256(stringToHex('BeaconUpgraded(address)'));
const DIAMOND_CUT_TOPIC = keccak256(
  stringToHex('DiamondCut((address,uint8,bytes4[])[],address,bytes)'),
);

const EMPTY_CODE = '0x';

function selectorFromHex(value: string, label: string): Hex {
  if (!isHex(value)) throw new Error(`Failed to derive selector for ${label}`);
  return value;
}

function isEmptyCode(code: Hex): boolean {
  return code === EMPTY_CODE || /^0x0*$/.test(code);
}

function storageAddress(value: Hex): Address | null {
  if (value === '0x' || /^0x0*$/.test(value)) return null;
  const candidate = `0x${value.slice(-40)}`;
  if (!isAddress(candidate) || candidate.toLowerCase() === zeroAddress) return null;
  return getAddress(candidate);
}

function slotEvidence(slot: Hash, rawValue: Hex): StorageSlotEvidence {
  return { slot, rawValue, resolvedAddress: storageAddress(rawValue) };
}

function normalizeExplorerAddress(value: string | null | undefined): Address | null {
  if (value === null || value === undefined || !isAddress(value)) return null;
  if (value.toLowerCase() === zeroAddress) return null;
  return getAddress(value);
}

function addressesEqual(left: Address | null, right: Address | null): boolean {
  return left?.toLowerCase() === right?.toLowerCase();
}

function normalizedProxyClaim(value: string | null): ProxyKind | null {
  if (value === null) return null;
  const normalized = value.toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  if (normalized.includes('transparent')) return 'transparent';
  if (normalized.includes('uups')) return 'uups';
  if (normalized.includes('beacon')) return 'beacon';
  if (normalized.includes('minimal') || normalized.includes('clone')) return 'minimal_clone';
  if (normalized.includes('diamond')) return 'diamond';
  return 'unknown';
}

async function safeCall(
  client: ProxyAnalysisClient,
  address: Address,
  data: Hex,
  blockNumber: bigint,
): Promise<Hex | null> {
  try {
    const result = await client.call({ to: address, data, blockNumber });
    return result === '0x' ? null : result;
  } catch {
    return null;
  }
}

export async function readContractOwner(
  client: ProxyAnalysisClient,
  address: Address,
  blockNumber: bigint,
): Promise<Address | null> {
  const result = await safeCall(
    client,
    address,
    encodeFunctionData({ abi: OWNER_ABI, functionName: 'owner' }),
    blockNumber,
  );
  if (result === null) return null;
  try {
    return decodeFunctionResult({ abi: OWNER_ABI, functionName: 'owner', data: result });
  } catch {
    return null;
  }
}

export async function classifyAddressAuthority(
  client: ProxyAnalysisClient,
  address: Address | null,
  blockNumber: bigint,
): Promise<AddressAuthority> {
  if (address === null || address.toLowerCase() === zeroAddress) {
    return {
      address: null,
      kind: 'renounced',
      ownerAddress: null,
      safeThreshold: null,
      safeOwners: [],
      timelockDelaySeconds: null,
      hasCode: false,
      evidence: ['No active upgrade authority address resolved'],
    };
  }

  const code = await client.getCode(address, blockNumber);
  if (isEmptyCode(code)) {
    return {
      address,
      kind: 'eoa',
      ownerAddress: null,
      safeThreshold: null,
      safeOwners: [],
      timelockDelaySeconds: null,
      hasCode: false,
      evidence: ['Direct code read returned empty runtime bytecode'],
    };
  }

  const thresholdData = await safeCall(
    client,
    address,
    encodeFunctionData({ abi: SAFE_THRESHOLD_ABI, functionName: 'getThreshold' }),
    blockNumber,
  );
  const ownersData = await safeCall(
    client,
    address,
    encodeFunctionData({ abi: SAFE_OWNERS_ABI, functionName: 'getOwners' }),
    blockNumber,
  );
  if (thresholdData !== null && ownersData !== null) {
    try {
      const threshold = decodeFunctionResult({
        abi: SAFE_THRESHOLD_ABI,
        functionName: 'getThreshold',
        data: thresholdData,
      });
      const owners = decodeFunctionResult({
        abi: SAFE_OWNERS_ABI,
        functionName: 'getOwners',
        data: ownersData,
      });
      if (threshold > 0n && owners.length >= Number(threshold)) {
        return {
          address,
          kind: 'safe',
          ownerAddress: null,
          safeThreshold: threshold,
          safeOwners: owners,
          timelockDelaySeconds: null,
          hasCode: true,
          evidence: [
            `Safe threshold ${threshold.toString()} across ${owners.length.toString()} owners`,
          ],
        };
      }
    } catch {
      // Continue with other direct authority checks.
    }
  }

  const delayData = await safeCall(
    client,
    address,
    encodeFunctionData({ abi: TIMELOCK_ABI, functionName: 'getMinDelay' }),
    blockNumber,
  );
  if (delayData !== null) {
    try {
      const delay = decodeFunctionResult({
        abi: TIMELOCK_ABI,
        functionName: 'getMinDelay',
        data: delayData,
      });
      return {
        address,
        kind: 'timelock',
        ownerAddress: await readContractOwner(client, address, blockNumber),
        safeThreshold: null,
        safeOwners: [],
        timelockDelaySeconds: delay,
        hasCode: true,
        evidence: [`Timelock minimum delay is ${delay.toString()} seconds`],
      };
    } catch {
      // Continue with contract ownership detection.
    }
  }

  const ownerAddress = await readContractOwner(client, address, blockNumber);
  return {
    address,
    kind: 'contract',
    ownerAddress,
    safeThreshold: null,
    safeOwners: [],
    timelockDelaySeconds: null,
    hasCode: true,
    evidence:
      ownerAddress === null
        ? ['Authority has contract code']
        : [`Authority owner is ${ownerAddress}`],
  };
}

async function resolveUpgradeAuthority(
  client: ProxyAnalysisClient,
  address: Address | null,
  blockNumber: bigint,
): Promise<AddressAuthority> {
  const direct = await classifyAddressAuthority(client, address, blockNumber);
  if (direct.kind !== 'contract' || direct.ownerAddress === null) return direct;
  const owner = await classifyAddressAuthority(client, direct.ownerAddress, blockNumber);
  return {
    ...owner,
    evidence: [...direct.evidence, ...owner.evidence],
  };
}

interface Opcode {
  readonly offset: number;
  readonly value: number;
  readonly pushData: string;
}

function decodeOpcodes(code: Hex): readonly Opcode[] {
  const bytes = code.slice(2);
  const opcodes: Opcode[] = [];
  let byteOffset = 0;
  while (byteOffset * 2 < bytes.length) {
    const encoded = bytes.slice(byteOffset * 2, byteOffset * 2 + 2);
    const value = Number.parseInt(encoded, 16);
    if (Number.isNaN(value)) break;
    const pushLength = value >= 0x60 && value <= 0x7f ? value - 0x5f : 0;
    const pushData = bytes.slice((byteOffset + 1) * 2, (byteOffset + 1 + pushLength) * 2);
    opcodes.push({ offset: byteOffset, value, pushData });
    byteOffset += 1 + pushLength;
  }
  return opcodes;
}

function containsOpcode(code: Hex, opcode: number): boolean {
  return decodeOpcodes(code).some((item) => item.value === opcode);
}

function containsSelector(code: Hex, selector: Hex): boolean {
  const needle = selector.slice(2).toLowerCase();
  return decodeOpcodes(code).some((item) => item.value === 0x63 && item.pushData === needle);
}

function minimalCloneImplementation(code: Hex): Address | null {
  const normalized = code.slice(2).toLowerCase();
  const patterns = [
    /^363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/,
    /^3d3d3d3d363d3d37363d73([0-9a-f]{40})5af43d3d93803e602a57fd5bf3$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    const address = match?.[1];
    if (address !== undefined) return getAddress(`0x${address}`);
  }
  return null;
}

async function isUupsImplementation(
  client: ProxyAnalysisClient,
  implementation: Address,
  blockNumber: bigint,
): Promise<boolean> {
  const result = await safeCall(
    client,
    implementation,
    encodeFunctionData({ abi: PROXIABLE_ABI, functionName: 'proxiableUUID' }),
    blockNumber,
  );
  if (result === null) return false;
  try {
    return (
      decodeFunctionResult({ abi: PROXIABLE_ABI, functionName: 'proxiableUUID', data: result }) ===
      EIP1967_IMPLEMENTATION_SLOT
    );
  } catch {
    return false;
  }
}

async function readBeaconImplementation(
  client: ProxyAnalysisClient,
  beacon: Address,
  blockNumber: bigint,
): Promise<Address | null> {
  const result = await safeCall(
    client,
    beacon,
    encodeFunctionData({ abi: BEACON_ABI, functionName: 'implementation' }),
    blockNumber,
  );
  if (result === null) return null;
  try {
    return decodeFunctionResult({ abi: BEACON_ABI, functionName: 'implementation', data: result });
  } catch {
    return null;
  }
}

async function looksLikeDiamond(
  client: ProxyAnalysisClient,
  address: Address,
  code: Hex,
  blockNumber: bigint,
): Promise<boolean> {
  const facetSelector = selectorFromHex(
    encodeFunctionData({ abi: DIAMOND_ABI, functionName: 'facetAddresses' }).slice(0, 10),
    'facetAddresses()',
  );
  const diamondCutSelector = selectorFromHex(
    encodeFunctionData({
      abi: DIAMOND_ABI,
      functionName: 'diamondCut',
      args: [[], zeroAddress, '0x'],
    }).slice(0, 10),
    'diamondCut',
  );
  if (containsSelector(code, facetSelector) && containsSelector(code, diamondCutSelector))
    return true;
  const result = await safeCall(
    client,
    address,
    encodeFunctionData({ abi: DIAMOND_ABI, functionName: 'facetAddresses' }),
    blockNumber,
  );
  return result !== null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Proxy families need ordered, mutually exclusive detection.
async function buildLayer(
  client: ProxyAnalysisClient,
  address: Address,
  blockNumber: bigint,
  depth: number,
  cloneFactoryAddress: Address | undefined,
): Promise<ProxyLayer> {
  const [code, implementationRaw, adminRaw, beaconRaw] = await Promise.all([
    client.getCode(address, blockNumber),
    client.getStorageAt(address, EIP1967_IMPLEMENTATION_SLOT, blockNumber),
    client.getStorageAt(address, EIP1967_ADMIN_SLOT, blockNumber),
    client.getStorageAt(address, EIP1967_BEACON_SLOT, blockNumber),
  ]);
  const implementationSlot = slotEvidence(EIP1967_IMPLEMENTATION_SLOT, implementationRaw);
  const adminSlot = slotEvidence(EIP1967_ADMIN_SLOT, adminRaw);
  const beaconSlot = slotEvidence(EIP1967_BEACON_SLOT, beaconRaw);
  const cloneImplementation = minimalCloneImplementation(code);
  let implementationAddress = implementationSlot.resolvedAddress ?? cloneImplementation;
  const indicators: string[] = [];
  let kind: ProxyKind = 'none';

  if (beaconSlot.resolvedAddress !== null) {
    kind = 'beacon';
    implementationAddress = await readBeaconImplementation(
      client,
      beaconSlot.resolvedAddress,
      blockNumber,
    );
    indicators.push('EIP-1967 beacon slot is populated');
  } else if (cloneImplementation !== null) {
    kind = 'minimal_clone';
    indicators.push('Runtime bytecode matches a supported EIP-1167 clone template');
  } else if (implementationSlot.resolvedAddress !== null && adminSlot.resolvedAddress !== null) {
    kind = 'transparent';
    indicators.push('EIP-1967 implementation and admin slots are populated');
  } else if (
    implementationSlot.resolvedAddress !== null &&
    (await isUupsImplementation(client, implementationSlot.resolvedAddress, blockNumber))
  ) {
    kind = 'uups';
    indicators.push('Implementation proxiableUUID resolves to the EIP-1967 implementation slot');
  } else if (await looksLikeDiamond(client, address, code, blockNumber)) {
    kind = 'diamond';
    indicators.push('Diamond loupe and cut surfaces are present');
  } else if (implementationSlot.resolvedAddress !== null) {
    kind = 'unknown';
    indicators.push('Implementation slot is populated without a recognized proxy control pattern');
  } else if (containsOpcode(code, 0xf4)) {
    kind = 'unknown_delegatecall';
    indicators.push('Runtime bytecode executes DELEGATECALL without a recognized proxy pattern');
  }

  if (cloneFactoryAddress !== undefined) {
    const factoryCode = await client.getCode(cloneFactoryAddress, blockNumber);
    const cloneSelector = selectorFromHex(
      keccak256(stringToHex('clone(address)')).slice(0, 10),
      'clone(address)',
    );
    const deterministicSelector = selectorFromHex(
      keccak256(stringToHex('cloneDeterministic(address,bytes32)')).slice(0, 10),
      'cloneDeterministic(address,bytes32)',
    );
    if (
      containsSelector(factoryCode, cloneSelector) ||
      containsSelector(factoryCode, deterministicSelector)
    ) {
      indicators.push('Creation factory exposes a common clone deployment selector');
    }
  }

  let implementationCodeHash: Hex | null = null;
  if (implementationAddress !== null) {
    const implementationCode = await client.getCode(implementationAddress, blockNumber);
    implementationCodeHash = isEmptyCode(implementationCode) ? null : keccak256(implementationCode);
  }

  return {
    depth,
    proxyAddress: address,
    kind,
    runtimeCodeHash: keccak256(code),
    implementationAddress,
    implementationCodeHash,
    beaconAddress: beaconSlot.resolvedAddress,
    adminAddress: adminSlot.resolvedAddress,
    implementationSlot,
    adminSlot,
    beaconSlot,
    minimalCloneFactoryAddress: cloneFactoryAddress ?? null,
    indicators,
  };
}

async function readLayers(
  client: ProxyAnalysisClient,
  input: ProxyAnalysisInput,
): Promise<readonly ProxyLayer[]> {
  const layers: ProxyLayer[] = [];
  const visited = new Set<string>();
  const maxDepth = input.maxNestedDepth ?? 4;
  let current = input.address;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const identity = current.toLowerCase();
    if (visited.has(identity)) break;
    visited.add(identity);
    const layer = await buildLayer(
      client,
      current,
      input.sourceBlock,
      depth,
      depth === 0 ? input.cloneFactoryAddress : undefined,
    );
    layers.push(layer);
    if (layer.implementationAddress === null || layer.kind === 'none') break;
    const next = await buildLayer(
      client,
      layer.implementationAddress,
      input.sourceBlock,
      depth + 1,
      undefined,
    );
    if (next.kind === 'none') break;
    current = layer.implementationAddress;
  }
  return layers;
}

function eventKind(topic: Hex): UpgradeEventEvidence['kind'] | null {
  if (topic === UPGRADED_TOPIC) return 'implementation';
  if (topic === ADMIN_CHANGED_TOPIC) return 'admin';
  if (topic === BEACON_UPGRADED_TOPIC) return 'beacon';
  if (topic === DIAMOND_CUT_TOPIC) return 'diamond';
  return null;
}

async function readRecentUpgradeEvents(
  client: ProxyAnalysisClient,
  input: ProxyAnalysisInput,
): Promise<readonly UpgradeEventEvidence[]> {
  const window = input.recentUpgradeWindowBlocks ?? 50_000n;
  const fromBlock = input.sourceBlock > window ? input.sourceBlock - window : 0n;
  try {
    const logs = await client.getLogs({
      address: input.address,
      fromBlock,
      toBlock: input.sourceBlock,
      topics: [[UPGRADED_TOPIC, ADMIN_CHANGED_TOPIC, BEACON_UPGRADED_TOPIC, DIAMOND_CUT_TOPIC]],
    });
    const events: UpgradeEventEvidence[] = [];
    for (const log of logs) {
      const topic0 = log.topics[0];
      const kind = topic0 === undefined ? null : eventKind(topic0);
      if (
        topic0 !== undefined &&
        kind !== null &&
        log.blockNumber !== null &&
        log.blockHash !== null &&
        log.transactionHash !== null &&
        log.logIndex !== null
      ) {
        events.push({
          kind,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          topic0,
        });
      }
    }
    return events.sort((left, right) =>
      left.blockNumber === right.blockNumber
        ? left.logIndex - right.logIndex
        : left.blockNumber < right.blockNumber
          ? -1
          : 1,
    );
  } catch {
    return [];
  }
}

function sourceVerified(
  claims: readonly SourceVerificationClaim[] | undefined,
  address: Address | null,
): boolean | null {
  if (address === null || claims === undefined) return null;
  const claim = claims.find((item) => item.address.toLowerCase() === address.toLowerCase());
  return claim?.verified ?? null;
}

function reconcileExplorer(
  claim: ExplorerProxyClaim | undefined,
  layer: ProxyLayer,
): readonly ProxyMetadataConflict[] {
  if (claim === undefined) return [];
  const conflicts: ProxyMetadataConflict[] = [];
  const implementation = normalizeExplorerAddress(claim.implementationAddresses[0]);
  const admin = normalizeExplorerAddress(claim.adminAddress);
  const beacon = normalizeExplorerAddress(claim.beaconAddress);
  const explorerKind = normalizedProxyClaim(claim.proxyType);
  const add = (
    field: ProxyMetadataConflict['field'],
    chainValue: string | null,
    explorerValue: string | null,
  ): void => {
    if (explorerValue === null || chainValue?.toLowerCase() === explorerValue.toLowerCase()) return;
    conflicts.push({
      field,
      chainValue,
      explorerValue,
      provider: claim.provider,
      fetchedAt: claim.fetchedAt,
    });
  };
  if (!addressesEqual(layer.implementationAddress, implementation)) {
    add('implementation_address', layer.implementationAddress, implementation);
  }
  if (!addressesEqual(layer.adminAddress, admin)) add('admin_address', layer.adminAddress, admin);
  if (!addressesEqual(layer.beaconAddress, beacon))
    add('beacon_address', layer.beaconAddress, beacon);
  if (explorerKind !== null && explorerKind !== layer.kind) {
    add('proxy_type', layer.kind, explorerKind);
  }
  return conflicts;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Each independent proxy condition produces separate evidence.
function makeFindings(params: {
  layer: ProxyLayer;
  layers: readonly ProxyLayer[];
  authority: AddressAuthority;
  implementationVerified: boolean | null;
  events: readonly UpgradeEventEvidence[];
  input: ProxyAnalysisInput;
  conflicts: readonly ProxyMetadataConflict[];
}): readonly ProxyAnalysisFinding[] {
  const findings: ProxyAnalysisFinding[] = [];
  const slotEvidence = {
    implementationSlot: params.layer.implementationSlot,
    adminSlot: params.layer.adminSlot,
    beaconSlot: params.layer.beaconSlot,
  };
  const add = (finding: ProxyAnalysisFinding): void => {
    findings.push(finding);
  };
  if (params.layer.kind !== 'none') {
    add({
      code: 'UPGRADEABLE_CONTRACT',
      status: 'warning',
      severity: 'low',
      confidence: 'confirmed',
      summary: `Contract uses ${params.layer.kind} proxy behavior`,
      evidence: slotEvidence,
    });
  }
  if (params.authority.kind === 'eoa') {
    add({
      code: 'EOA_CONTROLLED_UPGRADES',
      status: 'fail',
      severity: 'high',
      confidence: 'confirmed',
      summary: 'An EOA directly controls upgrades',
      evidence: { authority: params.authority, ...slotEvidence },
    });
  }
  if (
    params.layer.kind !== 'none' &&
    params.authority.kind !== 'timelock' &&
    params.authority.kind !== 'renounced'
  ) {
    add({
      code: 'NO_TIMELOCK',
      status: 'warning',
      severity: 'medium',
      confidence: params.authority.kind === 'unknown' ? 'low' : 'high',
      summary: 'No direct timelock evidence protects the resolved upgrade authority',
      evidence: { authority: params.authority },
    });
  }
  if (params.layer.implementationAddress !== null && params.implementationVerified === false) {
    add({
      code: 'UNVERIFIED_IMPLEMENTATION',
      status: 'warning',
      severity: 'medium',
      confidence: 'high',
      summary: 'The current implementation source is unverified',
      evidence: { implementationAddress: params.layer.implementationAddress },
    });
  }
  if (params.layer.implementationAddress !== null && params.layer.implementationCodeHash === null) {
    add({
      code: 'IMPLEMENTATION_WITHOUT_CODE',
      status: 'fail',
      severity: 'high',
      confidence: 'confirmed',
      summary: 'The chain-resolved implementation address has no runtime code',
      evidence: { implementationAddress: params.layer.implementationAddress, ...slotEvidence },
    });
  }
  if (params.events.some((event) => event.kind === 'implementation')) {
    add({
      code: 'RECENT_IMPLEMENTATION_CHANGE',
      status: 'warning',
      severity: 'medium',
      confidence: 'confirmed',
      summary: 'An implementation upgrade event occurred in the configured recent window',
      evidence: { events: params.events },
    });
  }
  const initialization = params.input.initialization;
  if (initialization?.proxyInitialized === false) {
    add({
      code: 'UNINITIALIZED_PROXY',
      status: 'fail',
      severity: 'high',
      confidence: initialization.storageSlot === null ? 'medium' : 'confirmed',
      summary: 'Initialization evidence marks the proxy as uninitialized',
      evidence: { initialization },
    });
  }
  if (initialization?.exposedInitializer === true) {
    add({
      code: 'EXPOSED_INITIALIZER',
      status: initialization.proxyInitialized === false ? 'fail' : 'warning',
      severity: initialization.proxyInitialized === false ? 'high' : 'medium',
      confidence: 'high',
      summary: 'A public or external initializer is present',
      evidence: { initialization },
    });
  }
  if (initialization?.implementationInitializersDisabled === false) {
    add({
      code: 'IMPLEMENTATION_INITIALIZER_NOT_DISABLED',
      status: 'warning',
      severity: 'medium',
      confidence: 'high',
      summary: 'The implementation does not disable its initializer in constructor evidence',
      evidence: { initialization, implementationAddress: params.layer.implementationAddress },
    });
  }
  if (params.layer.kind === 'unknown_delegatecall' || params.layer.kind === 'unknown') {
    add({
      code: 'SUSPICIOUS_DELEGATECALL',
      status: 'unknown',
      severity: 'medium',
      confidence: 'medium',
      summary: 'Delegatecall behavior does not match a supported proxy pattern',
      evidence: { indicators: params.layer.indicators, ...slotEvidence },
    });
  }
  if (params.layers.length > 1) {
    add({
      code: 'NESTED_PROXY_COMPLEXITY',
      status: 'warning',
      severity: 'medium',
      confidence: 'confirmed',
      summary: `Proxy resolution contains ${params.layers.length.toString()} proxy layers`,
      evidence: { layers: params.layers },
    });
  }
  if (params.conflicts.length > 0) {
    add({
      code: 'PROXY_METADATA_DISAGREEMENT',
      status: 'warning',
      severity: 'medium',
      confidence: 'confirmed',
      summary: 'Explorer proxy metadata conflicts with direct chain state',
      evidence: { conflicts: params.conflicts, chainState: slotEvidence },
    });
  }
  return findings.sort((left, right) => left.code.localeCompare(right.code));
}

export class ProxyAnalyzer {
  constructor(private readonly client: ProxyAnalysisClient) {}

  async analyze(input: ProxyAnalysisInput): Promise<ProxyAnalysisResult> {
    const layers = await readLayers(this.client, input);
    const layer = layers[0];
    if (layer === undefined) throw new Error('Proxy analysis did not produce a root layer');

    const authorityAddress = layer.adminAddress ?? layer.beaconAddress;
    let authority = await resolveUpgradeAuthority(this.client, authorityAddress, input.sourceBlock);
    let currentOwner = await readContractOwner(this.client, input.address, input.sourceBlock);
    if (currentOwner === null && authorityAddress !== null) {
      currentOwner = await readContractOwner(this.client, authorityAddress, input.sourceBlock);
    }
    if (
      authorityAddress === null &&
      (layer.kind === 'uups' || layer.kind === 'diamond') &&
      currentOwner !== null
    ) {
      authority = await resolveUpgradeAuthority(this.client, currentOwner, input.sourceBlock);
    }
    if (currentOwner === null && authority.ownerAddress !== null)
      currentOwner = authority.ownerAddress;

    const events = await readRecentUpgradeEvents(this.client, input);
    const conflicts = reconcileExplorer(input.explorer, layer);
    const implementationVerified = sourceVerified(
      input.sourceVerification,
      layer.implementationAddress,
    );
    const findings = makeFindings({
      layer,
      layers,
      authority,
      implementationVerified,
      events,
      input,
      conflicts,
    });
    return {
      chainId: input.chainId,
      proxyAddress: input.address,
      sourceBlock: input.sourceBlock,
      sourceBlockHash: input.sourceBlockHash,
      proxyKind: layer.kind,
      implementationAddress: layer.implementationAddress,
      implementationCodeHash: layer.implementationCodeHash,
      beaconAddress: layer.beaconAddress,
      adminAddress: layer.adminAddress,
      upgradeAuthority: authority,
      currentOwner,
      layers,
      recentUpgradeEvents: events,
      sourceVerified: sourceVerified(input.sourceVerification, input.address),
      implementationSourceVerified: implementationVerified,
      initialization: input.initialization ?? null,
      conflicts,
      findings,
      warnings: conflicts.map(
        (conflict) =>
          `${conflict.provider} ${conflict.field} disagrees with chain state at block ${input.sourceBlock.toString()}`,
      ),
    };
  }
}
