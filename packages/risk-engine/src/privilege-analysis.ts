import { type Hex, isHex, keccak256, stringToHex } from 'viem';
import type {
  AttributedSourceFile,
  ContractAbiItem,
  CurrentRoleController,
  ExternalCallSurface,
  PrivilegeAnalysisInput,
  PrivilegeAnalysisResult,
  PrivilegeBound,
  PrivilegeCapability,
  PrivilegeEvidence,
  PrivilegeFinding,
  SolidityContractAst,
  SolidityFunction,
  SoliditySourceAst,
  SolidityStateVariable,
} from './privilege-types.js';
import { parseSoliditySources } from './solidity-parser.js';

interface CapabilityMatch {
  readonly capability: PrivilegeCapability;
  readonly reason: string;
}

const KNOWN_HEURISTIC_SIGNATURES: Readonly<
  Record<string, readonly { capability: PrivilegeCapability; signature: string }[]>
> = {
  mint: [
    { capability: 'mint', signature: 'mint(address,uint256)' },
    { capability: 'mint', signature: 'mint(uint256)' },
  ],
  pause: [
    { capability: 'pause', signature: 'pause()' },
    { capability: 'pause', signature: 'unpause()' },
  ],
  blacklist: [
    { capability: 'blacklist', signature: 'setBlacklist(address,bool)' },
    { capability: 'blacklist', signature: 'blacklist(address)' },
  ],
  fee: [
    { capability: 'mutable_fees', signature: 'setFee(uint256)' },
    { capability: 'mutable_fees', signature: 'setFees(uint256,uint256)' },
  ],
  router: [{ capability: 'mutable_router', signature: 'setRouter(address)' }],
  arbitrary: [
    { capability: 'arbitrary_call', signature: 'execute(address,uint256,bytes)' },
    { capability: 'arbitrary_call', signature: 'multicall(bytes[])' },
  ],
  upgrade: [
    { capability: 'upgrade_authorization', signature: 'upgradeToAndCall(address,bytes)' },
    { capability: 'upgrade_authorization', signature: 'upgradeTo(address)' },
  ],
  role: [
    { capability: 'role_administration', signature: 'grantRole(bytes32,address)' },
    { capability: 'role_administration', signature: 'revokeRole(bytes32,address)' },
  ],
  confiscation: [
    { capability: 'confiscation', signature: 'confiscate(address,uint256)' },
    { capability: 'forced_transfer', signature: 'forceTransfer(address,address,uint256)' },
  ],
  rebase: [{ capability: 'rebase', signature: 'rebase(uint256,uint256)' }],
  rescue: [
    { capability: 'rescue', signature: 'rescueTokens(address,address,uint256)' },
    { capability: 'owner_withdrawal', signature: 'withdraw(address,uint256)' },
  ],
};

const ALL_HEURISTIC_SIGNATURES = Object.values(KNOWN_HEURISTIC_SIGNATURES).flat();

function selectorFor(signature: string): Hex {
  const selector = keccak256(stringToHex(signature)).slice(0, 10);
  if (!isHex(selector)) throw new Error(`Failed to derive selector for ${signature}`);
  return selector;
}

function isExternalCallType(value: string): value is ExternalCallSurface['callType'] {
  return ['call', 'delegatecall', 'staticcall', 'transfer', 'send'].includes(value);
}

function hasSelector(bytecode: Hex, selector: Hex): boolean {
  const bytes = bytecode.slice(2).toLowerCase();
  const expected = selector.slice(2).toLowerCase();
  let offset = 0;
  while (offset * 2 < bytes.length) {
    const opcode = Number.parseInt(bytes.slice(offset * 2, offset * 2 + 2), 16);
    if (Number.isNaN(opcode)) return false;
    const pushLength = opcode >= 0x60 && opcode <= 0x7f ? opcode - 0x5f : 0;
    if (opcode === 0x63 && bytes.slice((offset + 1) * 2, (offset + 5) * 2) === expected) {
      return true;
    }
    offset += 1 + pushLength;
  }
  return false;
}

function canonicalAbiType(parameter: {
  readonly type: string;
  readonly components?: readonly unknown[];
}): string {
  if (!parameter.type.startsWith('tuple')) return parameter.type;
  return parameter.type;
}

function abiSignature(item: ContractAbiItem): string | null {
  if (item.type !== 'function' || item.name === undefined) return null;
  return `${item.name}(${(item.inputs ?? []).map(canonicalAbiType).join(',')})`;
}

function functionRole(fn: SolidityFunction): string {
  const roleMatch = /onlyRole\s*\(\s*([A-Za-z0-9_$]+)/.exec(fn.declaration);
  if (roleMatch?.[1] !== undefined) return roleMatch[1];
  if (fn.modifiers.some((modifier) => modifier.toLowerCase() === 'onlyowner')) return 'owner';
  const named = fn.modifiers.find((modifier) =>
    /(admin|govern|operator|minter|manager|auth|controller)/i.test(modifier),
  );
  return named ?? 'unrestricted';
}

function controllersForRole(
  controllers: readonly CurrentRoleController[],
  role: string,
): readonly CurrentRoleController[] {
  if (role === 'unrestricted') return [];
  const normalized = role.toLowerCase();
  return controllers.filter((controller) => controller.role.toLowerCase() === normalized);
}

function authorityState(controllers: readonly CurrentRoleController[]): {
  readonly timelock: boolean | null;
  readonly multisig: boolean | null;
  readonly eoaControlled: boolean | null;
  readonly renounced: boolean;
} {
  if (controllers.length === 0) {
    return { timelock: null, multisig: null, eoaControlled: null, renounced: false };
  }
  const active = controllers.filter(
    (controller) => controller.active && controller.holder !== null,
  );
  return {
    timelock: active.some((controller) => controller.authority.kind === 'timelock'),
    multisig: active.some((controller) => controller.authority.kind === 'safe'),
    eoaControlled: active.some((controller) => controller.authority.kind === 'eoa'),
    renounced: active.length === 0,
  };
}

function boundsForFunction(
  fn: SolidityFunction,
  variables: readonly SolidityStateVariable[],
): PrivilegeBound {
  const body = fn.body;
  const comparison = /(require|if)\s*\([^;{}]*(<=|<)[^;{}]*\)/i.exec(body);
  if (comparison !== null) {
    return { kind: 'requirement', expression: comparison[0], stateVariable: null };
  }
  const related = variables.find(
    (variable) =>
      /(cap|max|limit|ceiling)/i.test(variable.name) &&
      (body.includes(variable.name) || fn.declaration.includes(variable.name)),
  );
  if (related !== undefined) {
    return {
      kind: related.constant || related.immutable ? 'constant' : 'state_variable',
      expression: related.declaration,
      stateVariable: related.name,
    };
  }
  return { kind: 'none', expression: null, stateVariable: null };
}

function controlledStateVariables(
  fn: SolidityFunction,
  variables: readonly SolidityStateVariable[],
): readonly SolidityStateVariable[] {
  return variables.filter((variable) => {
    const escaped = variable.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const assignment = new RegExp(
      `\\b${escaped}\\b(?:\\s*\\[[^\\]]+\\])?\\s*(?:=|\\+=|-=|\\*=|/=|\\+\\+|--)`,
    );
    return assignment.test(fn.body);
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Capability checks stay explicit for evidence review.
function sourceCapabilityMatches(
  fn: SolidityFunction,
  variables: readonly SolidityStateVariable[],
): readonly CapabilityMatch[] {
  const name = fn.name.toLowerCase();
  const body = fn.body.toLowerCase();
  const declaration = fn.declaration.toLowerCase();
  const combined = `${name} ${body} ${declaration}`;
  const matches: CapabilityMatch[] = [];
  const add = (capability: PrivilegeCapability, reason: string): void => {
    if (!matches.some((item) => item.capability === capability))
      matches.push({ capability, reason });
  };

  if (/mint/.test(name) || /\b_mint\b/.test(body)) {
    add('mint', 'Function name or body invokes a mint surface');
    const bounds = boundsForFunction(fn, variables);
    add(
      bounds.kind === 'none' ? 'unbounded_mint' : 'capped_mint',
      bounds.kind === 'none'
        ? 'No source-level mint bound was found'
        : 'Source-level mint bound was found',
    );
  }
  if (/burn/.test(name) || /\b_burn\b/.test(body)) add('burn_authority', 'Burn surface is present');
  if (/pause|unpause/.test(name) || combined.includes('_pause'))
    add('pause', 'Pause control is present');
  if (/blacklist|blocklist|denylist/.test(combined))
    add('blacklist', 'Blacklist control is present');
  if (/whitelist|allowlist/.test(combined)) add('whitelist', 'Whitelist control is present');
  if (/forcetransfer|forcedtransfer/.test(name))
    add('forced_transfer', 'Forced transfer surface is present');
  if (/confiscat|seize|wipefrozen/.test(combined))
    add('confiscation', 'Confiscation surface is present');
  if (/transferfee|taxfee|buyfee|sellfee|feebps/.test(combined)) {
    add('transfer_fees', 'Transfer fee state or behavior is referenced');
  }
  if (/set.*fee|update.*fee|change.*fee/.test(name)) {
    add('mutable_fees', 'Fee setter is present');
    if (boundsForFunction(fn, variables).kind !== 'none') {
      add('fee_limits', 'Fee setter contains a source-level bound');
    }
  }
  if (/maxfee|feelimit|feeceiling/.test(combined)) add('fee_limits', 'Fee limit is referenced');
  if (/feeexempt|excludedfromfee|exclude.*fee/.test(combined)) {
    add('fee_exemptions', 'Fee exemption control is present');
  }
  if (/max(tx|transaction)/.test(combined))
    add('max_transaction', 'Maximum transaction control is present');
  if (/maxwallet|maxholding/.test(combined)) add('max_wallet', 'Maximum wallet control is present');
  if (/trading(enabled|open)|enabletrading|settrading/.test(combined)) {
    add('trading_toggle', 'Trading state control is present');
  }
  if (/set.*router|update.*router|router\s*=/.test(combined))
    add('mutable_router', 'Router setter is present');
  if (/set.*pair|update.*pair|pair\s*=/.test(combined))
    add('mutable_pair', 'Pair setter is present');
  if (/rescue|recover.*token|sweep/.test(name)) add('rescue', 'Asset rescue surface is present');
  if (/withdraw|withdrawal/.test(name) && functionRole(fn) !== 'unrestricted') {
    add('owner_withdrawal', 'Privileged withdrawal surface is present');
  }
  if (/\.\s*call\b/.test(body) && /(target|destination|to)\b/.test(combined)) {
    add('arbitrary_call', 'External call target is supplied or mutable');
  }
  if (/\.\s*delegatecall\s*\(/.test(body)) add('delegatecall', 'Delegatecall surface is present');
  if (/grantrole|revokerole|setroleadmin/.test(combined)) {
    add('role_administration', 'Role administration surface is present');
  }
  if (/authorizeupgrade|upgradeto|diamondcut/.test(combined)) {
    add('upgrade_authorization', 'Upgrade authorization surface is present');
  }
  if (/rebase|setscalingfactor|scalingsupply/.test(combined))
    add('rebase', 'Rebase surface is present');
  if (/reflection|reflect|rowned|towned|rfee/.test(combined))
    add('reflection', 'Reflection state is present');
  if (/set(name|symbol|tokenuri|baseuri)|updatemetadata/.test(name)) {
    add('mutable_metadata', 'Metadata setter is present');
  }
  if (name === 'permit' || combined.includes('_usecheckednonce'))
    add('permit', 'Permit surface is present');
  if (/selfdestruct|suicide/.test(body))
    add('self_destruct', 'Self-destruct opcode is invoked by source');
  return matches;
}

function sourceEvidence(
  fn: SolidityFunction,
  sourceFiles: ReadonlyMap<string, AttributedSourceFile>,
): PrivilegeEvidence {
  const source = sourceFiles.get(fn.sourcePath);
  return {
    kind: 'source_ast',
    sourcePath: fn.sourcePath,
    line: fn.line,
    functionName: fn.name,
    selector: fn.selector,
    excerpt: fn.declaration.slice(0, 400),
    provider: source?.provider ?? null,
    fetchedAt: source?.fetchedAt ?? null,
    sourceHash: source?.sourceHash ?? null,
    provenanceKeys: ['contract_source'],
  };
}

function makeSourceFinding(
  capability: CapabilityMatch,
  fn: SolidityFunction,
  variables: readonly SolidityStateVariable[],
  input: PrivilegeAnalysisInput,
  sourceFiles: ReadonlyMap<string, AttributedSourceFile>,
): PrivilegeFinding {
  const role = functionRole(fn);
  const controllers = controllersForRole(input.controllers, role);
  const authority = authorityState(controllers);
  return {
    capability: capability.capability,
    functionName: fn.name,
    selector: fn.selector,
    role,
    currentControllers: controllers,
    bounds: boundsForFunction(fn, variables),
    controlledStateVariables: controlledStateVariables(fn, variables),
    ...authority,
    confidence: 'high',
    conclusion: 'confirmed',
    explanation: `${capability.reason}. Verified source ties the capability to ${fn.signature}.`,
    evidence: [sourceEvidence(fn, sourceFiles)],
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ABI names map to distinct reduced-confidence capabilities.
function abiCapability(name: string): PrivilegeCapability | null {
  const normalized = name.toLowerCase();
  if (normalized.includes('mint')) return 'mint';
  if (/pause|unpause/.test(normalized)) return 'pause';
  if (/blacklist|blocklist|denylist/.test(normalized)) return 'blacklist';
  if (/whitelist|allowlist/.test(normalized)) return 'whitelist';
  if (/forcetransfer/.test(normalized)) return 'forced_transfer';
  if (/confiscat|seize/.test(normalized)) return 'confiscation';
  if (/set.*fee|update.*fee/.test(normalized)) return 'mutable_fees';
  if (/feeexempt|exclude.*fee/.test(normalized)) return 'fee_exemptions';
  if (/max(tx|transaction)/.test(normalized)) return 'max_transaction';
  if (/maxwallet/.test(normalized)) return 'max_wallet';
  if (/trading/.test(normalized)) return 'trading_toggle';
  if (/set.*router/.test(normalized)) return 'mutable_router';
  if (/set.*pair/.test(normalized)) return 'mutable_pair';
  if (/rescue|recover|sweep/.test(normalized)) return 'rescue';
  if (/withdraw/.test(normalized)) return 'owner_withdrawal';
  if (/execute|multicall/.test(normalized)) return 'arbitrary_call';
  if (/grantrole|revokerole|setroleadmin/.test(normalized)) return 'role_administration';
  if (/upgrade|diamondcut/.test(normalized)) return 'upgrade_authorization';
  if (/rebase/.test(normalized)) return 'rebase';
  if (/reflect/.test(normalized)) return 'reflection';
  if (/set(name|symbol|tokenuri|baseuri)/.test(normalized)) return 'mutable_metadata';
  if (normalized === 'permit') return 'permit';
  return null;
}

function abiFindings(input: PrivilegeAnalysisInput): readonly PrivilegeFinding[] {
  const findings: PrivilegeFinding[] = [];
  for (const item of input.abi ?? []) {
    const signature = abiSignature(item);
    if (signature === null || item.name === undefined) continue;
    const capability = abiCapability(item.name);
    if (capability === null) continue;
    const selector = selectorFor(signature);
    findings.push({
      capability,
      functionName: item.name,
      selector,
      role: 'unknown',
      currentControllers: [],
      bounds: { kind: 'unknown', expression: null, stateVariable: null },
      controlledStateVariables: [],
      timelock: null,
      multisig: null,
      eoaControlled: null,
      renounced: false,
      confidence: 'medium',
      conclusion: 'indicated',
      explanation: `ABI exposes ${signature}. Source-level authorization and bounds are unavailable.`,
      evidence: [
        {
          kind: 'abi',
          sourcePath: null,
          line: null,
          functionName: item.name,
          selector,
          excerpt: signature,
          provider: null,
          fetchedAt: null,
          sourceHash: null,
          provenanceKeys: ['contract_abi'],
        },
      ],
    });
  }
  return findings;
}

function bytecodeFindings(input: PrivilegeAnalysisInput): readonly PrivilegeFinding[] {
  const findings: PrivilegeFinding[] = [];
  for (const known of ALL_HEURISTIC_SIGNATURES) {
    const selector = selectorFor(known.signature);
    if (!hasSelector(input.runtimeBytecode, selector)) continue;
    findings.push({
      capability: known.capability,
      functionName: known.signature.slice(0, known.signature.indexOf('(')),
      selector,
      role: 'unknown',
      currentControllers: [],
      bounds: { kind: 'unknown', expression: null, stateVariable: null },
      controlledStateVariables: [],
      timelock: null,
      multisig: null,
      eoaControlled: null,
      renounced: false,
      confidence: 'low',
      conclusion: 'indicated',
      explanation: `Runtime bytecode contains selector ${selector}, consistent with ${known.signature}. The selector does not prove behavior or authorization.`,
      evidence: [
        {
          kind: 'bytecode_selector',
          sourcePath: null,
          line: null,
          functionName: null,
          selector,
          excerpt: `PUSH4 ${selector}`,
          provider: null,
          fetchedAt: null,
          sourceHash: null,
          provenanceKeys: ['chain_runtime_bytecode'],
        },
      ],
    });
  }
  return findings;
}

function callSurfaces(ast: SoliditySourceAst): readonly ExternalCallSurface[] {
  const surfaces: ExternalCallSurface[] = [];
  const pattern = /\.\s*(delegatecall|staticcall|call|transfer|send)(?:\s*\{[^}]*\})?\s*\(/g;
  for (const contract of ast.contracts) {
    for (const fn of contract.functions) {
      for (const match of fn.body.matchAll(pattern)) {
        const callType = match[1];
        const matchIndex = match.index;
        if (callType === undefined || matchIndex === undefined || !isExternalCallType(callType)) {
          continue;
        }
        const target = fn.body.slice(Math.max(0, matchIndex - 80), matchIndex).trim();
        surfaces.push({
          functionName: fn.name,
          selector: fn.selector,
          callType,
          targetExpression: target,
          sourcePath: fn.sourcePath,
          line: fn.line,
        });
      }
    }
  }
  return surfaces.sort((left, right) =>
    left.sourcePath === right.sourcePath
      ? left.line - right.line
      : left.sourcePath.localeCompare(right.sourcePath),
  );
}

function contractClosure(
  ast: SoliditySourceAst,
  contractName: string | undefined,
): readonly SolidityContractAst[] {
  if (contractName === undefined) return ast.contracts;
  const byName = new Map(ast.contracts.map((contract) => [contract.name, contract]));
  const selected = new Map<string, SolidityContractAst>();
  const visit = (name: string): void => {
    if (selected.has(name)) return;
    const contract = byName.get(name);
    if (contract === undefined) return;
    selected.set(name, contract);
    for (const inherited of contract.inherits) visit(inherited);
  };
  visit(contractName);
  return [...selected.values()];
}

function findingIdentity(finding: PrivilegeFinding): string {
  return `${finding.capability}:${finding.selector ?? 'none'}:${finding.role}`;
}

function deduplicate(findings: readonly PrivilegeFinding[]): readonly PrivilegeFinding[] {
  const byIdentity = new Map<string, PrivilegeFinding>();
  const confidence = { low: 0, medium: 1, high: 2, confirmed: 3 } as const;
  for (const finding of findings) {
    const identity = findingIdentity(finding);
    const current = byIdentity.get(identity);
    if (current === undefined || confidence[finding.confidence] > confidence[current.confidence]) {
      byIdentity.set(identity, finding);
    }
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.capability === right.capability
      ? (left.selector ?? '').localeCompare(right.selector ?? '')
      : left.capability.localeCompare(right.capability),
  );
}

function initializationEvidence(
  contracts: readonly SolidityContractAst[] | null,
): PrivilegeAnalysisResult['initializationEvidence'] {
  if (contracts === null) {
    return {
      proxyInitialized: null,
      exposedInitializer: false,
      implementationInitializersDisabled: null,
      storageSlot: null,
      storageValue: null,
      provenanceKey: 'source_unavailable',
    };
  }
  const functions = contracts.flatMap((contract) => contract.functions);
  const exposedInitializer = functions.some(
    (fn) =>
      (fn.visibility === 'public' || fn.visibility === 'external') &&
      (fn.name.toLowerCase().includes('initialize') ||
        fn.modifiers.some((modifier) => /^(initializer|reinitializer)$/i.test(modifier))),
  );
  const constructors = functions.filter((fn) => fn.kind === 'constructor');
  const disabled = constructors.some((fn) => /_disableInitializers\s*\(/.test(fn.body));
  return {
    proxyInitialized: null,
    exposedInitializer,
    implementationInitializersDisabled:
      exposedInitializer || constructors.length > 0 ? disabled : null,
    storageSlot: null,
    storageValue: null,
    provenanceKey: 'verified_source_ast',
  };
}

export class ContractPrivilegeAnalyzer {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Analysis selects one evidence tier and preserves all attribution.
  analyze(input: PrivilegeAnalysisInput): PrivilegeAnalysisResult {
    const sourceFiles = input.sourceVerified ? (input.sourceFiles ?? []) : [];
    const ast = sourceFiles.length > 0 ? parseSoliditySources(sourceFiles) : null;
    const contracts = ast === null ? null : contractClosure(ast, input.contractName);
    const sourcesByPath = new Map(sourceFiles.map((file) => [file.path, file]));
    const stateVariables = contracts?.flatMap((contract) => contract.stateVariables) ?? [];
    const sourceFindings =
      contracts?.flatMap((contract) =>
        contract.functions.flatMap((fn) =>
          sourceCapabilityMatches(fn, stateVariables).map((capability) =>
            makeSourceFinding(capability, fn, stateVariables, input, sourcesByPath),
          ),
        ),
      ) ?? [];
    const fallbackFindings =
      sourceFindings.length > 0
        ? []
        : input.abi !== null && input.abi !== undefined
          ? abiFindings(input)
          : bytecodeFindings(input);
    const modifiers = contracts?.flatMap((contract) => contract.modifiers) ?? [];
    const inheritance = Object.fromEntries(
      (ast?.contracts ?? []).map((contract) => [contract.name, contract.inherits]),
    );
    const warnings = [...(ast?.parseWarnings ?? [])];
    if (!input.sourceVerified) {
      warnings.push(
        'Verified source is unavailable. ABI and bytecode conclusions have reduced confidence.',
      );
    } else if (sourceFiles.length === 0) {
      warnings.push(
        'Source verification is reported but no attributed source files were supplied.',
      );
    }
    const ownerRenounced = input.controllers.some(
      (controller) => controller.role.toLowerCase() === 'owner' && !controller.active,
    );
    const otherActiveRole = input.controllers.some(
      (controller) => controller.role.toLowerCase() !== 'owner' && controller.active,
    );
    if (ownerRenounced && otherActiveRole) {
      warnings.push('Owner is renounced while another privileged role remains active.');
    }
    return {
      chainId: input.chainId,
      address: input.address,
      sourceBlock: input.sourceBlock,
      sourceBlockHash: input.sourceBlockHash,
      sourceVerified: input.sourceVerified,
      ast,
      inheritance,
      modifiers,
      stateVariables,
      externalCallSurfaces:
        contracts === null
          ? []
          : callSurfaces({ contracts, parseWarnings: ast?.parseWarnings ?? [] }),
      findings: deduplicate([...sourceFindings, ...fallbackFindings]),
      initializationEvidence: initializationEvidence(contracts),
      warnings: warnings.sort(),
    };
  }
}
