import type { PrivilegeAnalysisResult, PrivilegeCapability } from './privilege-types.js';
import type { ProxyAnalysisFinding, ProxyAnalysisResult, ProxyFindingCode } from './proxy-types.js';
import type {
  RiskCategory,
  RiskConfidence,
  RiskRule,
  RiskRuleEvaluation,
  RiskScanContext,
  RiskSeverity,
} from './types.js';

const PROXY_FINDING_CODES: readonly ProxyFindingCode[] = [
  'UPGRADEABLE_CONTRACT',
  'EOA_CONTROLLED_UPGRADES',
  'NO_TIMELOCK',
  'UNVERIFIED_IMPLEMENTATION',
  'IMPLEMENTATION_WITHOUT_CODE',
  'RECENT_IMPLEMENTATION_CHANGE',
  'UNINITIALIZED_PROXY',
  'EXPOSED_INITIALIZER',
  'IMPLEMENTATION_INITIALIZER_NOT_DISABLED',
  'SUSPICIOUS_DELEGATECALL',
  'NESTED_PROXY_COMPLEXITY',
  'PROXY_METADATA_DISAGREEMENT',
];

const PRIVILEGE_CAPABILITIES: readonly PrivilegeCapability[] = [
  'mint',
  'unbounded_mint',
  'capped_mint',
  'burn_authority',
  'pause',
  'blacklist',
  'whitelist',
  'forced_transfer',
  'confiscation',
  'transfer_fees',
  'mutable_fees',
  'fee_limits',
  'fee_exemptions',
  'max_transaction',
  'max_wallet',
  'trading_toggle',
  'mutable_router',
  'mutable_pair',
  'rescue',
  'owner_withdrawal',
  'arbitrary_call',
  'delegatecall',
  'role_administration',
  'upgrade_authorization',
  'rebase',
  'reflection',
  'mutable_metadata',
  'permit',
  'self_destruct',
];

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function isProxyAnalysisResult(value: unknown): value is ProxyAnalysisResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    'findings' in value &&
    Array.isArray(value.findings) &&
    'layers' in value &&
    Array.isArray(value.layers) &&
    'sourceBlock' in value &&
    typeof value.sourceBlock === 'bigint' &&
    'proxyKind' in value &&
    typeof value.proxyKind === 'string'
  );
}

function isPrivilegeAnalysisResult(value: unknown): value is PrivilegeAnalysisResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    'findings' in value &&
    Array.isArray(value.findings) &&
    'sourceVerified' in value &&
    typeof value.sourceVerified === 'boolean' &&
    'warnings' in value &&
    Array.isArray(value.warnings)
  );
}

function proxyResult(context: Readonly<RiskScanContext>): ProxyAnalysisResult {
  const value = context.data.proxyAnalysis;
  if (!isProxyAnalysisResult(value)) throw new Error('Proxy analysis data is malformed');
  return value;
}

function privilegeResult(context: Readonly<RiskScanContext>): PrivilegeAnalysisResult {
  const value = context.data.privilegeAnalysis;
  if (!isPrivilegeAnalysisResult(value)) throw new Error('Privilege analysis data is malformed');
  return value;
}

function riskConfidence(level: ProxyAnalysisFinding['confidence']): RiskConfidence {
  const basisPoints = { low: 3_000, medium: 6_000, high: 8_500, confirmed: 10_000 }[level];
  return {
    level,
    basisPoints,
    rationale:
      'Confidence follows the direct storage, bytecode, source, ABI, or event evidence level.',
  };
}

function proxyEvaluation(
  code: ProxyFindingCode,
  context: Readonly<RiskScanContext>,
): RiskRuleEvaluation {
  const result = proxyResult(context);
  const finding = result.findings.find((candidate) => candidate.code === code);
  if (finding === undefined) {
    return {
      status: 'pass',
      severity: 'info',
      confidence: {
        level: 'high',
        basisPoints: 9_000,
        rationale: 'Pinned chain analysis did not find this proxy condition.',
      },
      title: `${titleCase(code)} not found`,
      explanation: `Proxy analysis at block ${result.sourceBlock.toString()} did not find ${code}.`,
      evidence: [
        {
          evidenceType: 'proxy_chain_state',
          summary: 'Direct chain proxy resolution completed',
          data: { proxyKind: result.proxyKind, layers: result.layers },
          provenanceKeys: ['chain_proxy_state'],
        },
      ],
      remediation: null,
      fingerprintSeed: code,
    };
  }
  return {
    status: finding.status,
    severity: finding.severity,
    confidence: riskConfidence(finding.confidence),
    title: titleCase(code),
    explanation: finding.summary,
    evidence: [
      {
        evidenceType: 'proxy_analysis',
        summary: finding.summary,
        data: { code, ...finding.evidence },
        provenanceKeys: [
          'chain_proxy_state',
          ...(code === 'PROXY_METADATA_DISAGREEMENT' ? ['explorer_contract_metadata'] : []),
          ...(code === 'UNVERIFIED_IMPLEMENTATION' ? ['contract_source'] : []),
        ],
      },
    ],
    remediation:
      finding.status === 'fail' || finding.status === 'warning'
        ? 'Review the resolved authority, implementation, and initialization evidence before interacting.'
        : null,
    fingerprintSeed: code,
  };
}

function privilegeCategory(capability: PrivilegeCapability): RiskCategory {
  if (['mint', 'unbounded_mint', 'capped_mint', 'rebase', 'reflection'].includes(capability)) {
    return 'Supply';
  }
  if (
    [
      'burn_authority',
      'pause',
      'blacklist',
      'whitelist',
      'forced_transfer',
      'confiscation',
      'transfer_fees',
      'mutable_fees',
      'fee_limits',
      'fee_exemptions',
      'max_transaction',
      'max_wallet',
      'trading_toggle',
    ].includes(capability)
  ) {
    return 'Transfer behavior';
  }
  if (capability === 'upgrade_authorization') return 'Upgradeability';
  if (capability === 'mutable_metadata' || capability === 'permit') return 'Metadata quality';
  return 'Contract control';
}

function privilegeSeverity(capability: PrivilegeCapability): RiskSeverity {
  if (
    [
      'unbounded_mint',
      'forced_transfer',
      'confiscation',
      'arbitrary_call',
      'delegatecall',
      'self_destruct',
    ].includes(capability)
  ) {
    return 'high';
  }
  if (
    [
      'blacklist',
      'mutable_fees',
      'trading_toggle',
      'mutable_router',
      'mutable_pair',
      'upgrade_authorization',
      'rebase',
    ].includes(capability)
  ) {
    return 'medium';
  }
  return 'low';
}

function privilegeEvaluation(
  capability: PrivilegeCapability,
  context: Readonly<RiskScanContext>,
): RiskRuleEvaluation {
  const result = privilegeResult(context);
  const findings = result.findings.filter((candidate) => candidate.capability === capability);
  if (findings.length === 0 && !result.sourceVerified) {
    return {
      status: 'unknown',
      severity: 'info',
      confidence: {
        level: 'unknown',
        basisPoints: 0,
        rationale: 'Verified source is unavailable and no supported selector supplied evidence.',
      },
      title: `${titleCase(capability)} unavailable`,
      explanation: `The analyzer lacks enough evidence to exclude ${capability}.`,
      evidence: [
        {
          evidenceType: 'privilege_analysis_gap',
          summary: 'Source evidence is unavailable',
          data: { capability, warnings: result.warnings },
          provenanceKeys: ['contract_source'],
        },
      ],
      remediation: 'Verify source and rescan the contract at a pinned block.',
      fingerprintSeed: capability,
    };
  }
  if (findings.length === 0) {
    return {
      status: 'pass',
      severity: 'info',
      confidence: {
        level: 'high',
        basisPoints: 8_500,
        rationale: 'Verified source analysis did not find this capability.',
      },
      title: `${titleCase(capability)} not found`,
      explanation: `Verified source analysis did not find ${capability}.`,
      evidence: [
        {
          evidenceType: 'source_ast',
          summary: 'Verified source analysis completed',
          data: { capability, inheritance: result.inheritance },
          provenanceKeys: ['contract_source'],
        },
      ],
      remediation: null,
      fingerprintSeed: capability,
    };
  }
  const active = findings.some(
    (finding) =>
      finding.role === 'unrestricted' || finding.currentControllers.some((item) => item.active),
  );
  const heuristicOnly = findings.every((finding) => finding.conclusion === 'indicated');
  const severity = privilegeSeverity(capability);
  const status = heuristicOnly ? 'unknown' : severity === 'high' && active ? 'fail' : 'warning';
  const confidenceLevel = heuristicOnly
    ? findings.some((finding) => finding.confidence === 'medium')
      ? 'medium'
      : 'low'
    : 'high';
  return {
    status,
    severity,
    confidence: {
      level: confidenceLevel,
      basisPoints:
        confidenceLevel === 'high' ? 8_500 : confidenceLevel === 'medium' ? 6_000 : 3_000,
      rationale: heuristicOnly
        ? 'ABI or bytecode evidence indicates a selector but does not prove behavior.'
        : 'Verified source ties the capability to a function and current controller evidence.',
    },
    title: titleCase(capability),
    explanation: findings.map((finding) => finding.explanation).join(' '),
    evidence: findings.flatMap((finding) =>
      finding.evidence.map((evidence) => ({
        evidenceType: evidence.kind,
        summary: `${capability} in ${finding.functionName ?? 'unknown function'}`,
        data: {
          capability,
          functionName: finding.functionName,
          selector: finding.selector,
          role: finding.role,
          currentControllers: finding.currentControllers,
          bounds: finding.bounds,
          controlledStateVariables: finding.controlledStateVariables,
          timelock: finding.timelock,
          multisig: finding.multisig,
          eoaControlled: finding.eoaControlled,
          renounced: finding.renounced,
          sourcePath: evidence.sourcePath,
          line: evidence.line,
          excerpt: evidence.excerpt,
          provider: evidence.provider,
          fetchedAt: evidence.fetchedAt,
          sourceHash: evidence.sourceHash,
        },
        provenanceKeys: [
          ...evidence.provenanceKeys,
          ...(finding.currentControllers.length > 0 ? ['chain_privilege_state'] : []),
        ],
      })),
    ),
    remediation: active
      ? 'Review each current controller, authority bound, and delay before relying on the contract.'
      : 'Confirm no separate role or upgrade path keeps this capability active.',
    fingerprintSeed: capability,
  };
}

export function createProxyAnalysisRules(): readonly RiskRule[] {
  return PROXY_FINDING_CODES.map((code) => ({
    ruleId: `proxy.${code.toLowerCase()}`,
    version: '1.0.0',
    category: 'Upgradeability',
    title: titleCase(code),
    description: `Evaluate ${code} from pinned direct chain proxy analysis.`,
    requiredDataSources: ['chain_proxy_state'],
    maxPenaltyBps:
      code === 'UPGRADEABLE_CONTRACT' ? 0 : code.includes('WITHOUT_CODE') ? 2_000 : 800,
    evaluate: (context: Readonly<RiskScanContext>) =>
      Promise.resolve(proxyEvaluation(code, context)),
  }));
}

export function createPrivilegeAnalysisRules(): readonly RiskRule[] {
  return PRIVILEGE_CAPABILITIES.map((capability) => ({
    ruleId: `privilege.${capability}`,
    version: '1.0.0',
    category: privilegeCategory(capability),
    title: titleCase(capability),
    description: `Evaluate ${capability} from source, ABI, and bytecode evidence.`,
    requiredDataSources: ['chain_runtime_bytecode'],
    maxPenaltyBps: privilegeSeverity(capability) === 'high' ? 2_000 : 600,
    evaluate: (context: Readonly<RiskScanContext>) =>
      Promise.resolve(privilegeEvaluation(capability, context)),
  }));
}
