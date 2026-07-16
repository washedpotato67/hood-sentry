import {
  type OracleBehaviorResult,
  ORACLE_OBSERVATION_SOURCE,
  deserializeOracleResult,
} from './oracle-types.js';
import type {
  RiskFindingStatus,
  RiskRule,
  RiskRuleEvaluation,
  RiskScanContext,
  RiskSeverity,
} from './types.js';

export const SEQUENCER_GRACE_SECONDS = 3600n;

export const ORACLE_RULE_CODES = [
  'oracle_stale',
  'oracle_answer_invalid',
  'oracle_incomplete_round',
  'oracle_paused',
  'sequencer_down',
  'sequencer_grace_period',
] as const;
export type OracleRuleCode = (typeof ORACLE_RULE_CODES)[number];

interface Spec {
  readonly severity: RiskSeverity;
  readonly status: Extract<RiskFindingStatus, 'fail' | 'warning'>;
  readonly title: string;
  readonly description: string;
  readonly whenPresent: string;
  readonly whenAbsent: string;
  readonly remediation: string;
  /** Sequencer rules are N/A when no sequencer feed is configured, independent of the price feed. */
  readonly sequencerRule: boolean;
}

const SPECS: Record<OracleRuleCode, Spec> = {
  oracle_stale: {
    severity: 'high',
    status: 'fail',
    title: 'Oracle price is stale',
    description: 'The feed has not updated within its configured heartbeat.',
    whenPresent: 'The oracle last updated longer ago than its heartbeat allows, so its price is stale.',
    whenAbsent: 'The oracle updated within its heartbeat window.',
    remediation: 'Do not rely on this price until the feed updates within its heartbeat.',
    sequencerRule: false,
  },
  oracle_answer_invalid: {
    severity: 'high',
    status: 'fail',
    title: 'Oracle answer is invalid',
    description: 'The feed reported a non-positive answer.',
    whenPresent: 'The oracle reported a zero or negative answer, which cannot be a valid price.',
    whenAbsent: 'The oracle reported a positive answer.',
    remediation: 'Treat the price as unavailable while the answer is non-positive.',
    sequencerRule: false,
  },
  oracle_incomplete_round: {
    severity: 'medium',
    status: 'warning',
    title: 'Oracle round is incomplete',
    description: 'answeredInRound is behind the latest roundId.',
    whenPresent: 'The latest round has no fresh answer yet; the price is carried from an earlier round.',
    whenAbsent: 'The latest round carries its own answer.',
    remediation: 'Prefer a source whose latest round is complete.',
    sequencerRule: false,
  },
  oracle_paused: {
    severity: 'high',
    status: 'fail',
    title: 'Oracle is paused',
    description: 'The aggregator reports a paused state.',
    whenPresent: 'The oracle aggregator is paused, so it is not producing fresh prices.',
    whenAbsent: 'The oracle aggregator is not paused.',
    remediation: 'Do not rely on this price while the aggregator is paused.',
    sequencerRule: false,
  },
  sequencer_down: {
    severity: 'critical',
    status: 'fail',
    title: 'Sequencer is down',
    description: 'The L2 sequencer uptime feed reports the sequencer as down.',
    whenPresent: 'The sequencer uptime feed reports the sequencer down, so on-chain prices are unreliable.',
    whenAbsent: 'The sequencer uptime feed reports the sequencer up.',
    remediation: 'Do not rely on on-chain prices while the sequencer is down.',
    sequencerRule: true,
  },
  sequencer_grace_period: {
    severity: 'medium',
    status: 'warning',
    title: 'Sequencer recently recovered',
    description: 'The sequencer recovered within the grace period.',
    whenPresent: 'The sequencer recovered recently and is still inside its grace period, so prices may lag.',
    whenAbsent: 'The sequencer has been up beyond its grace period.',
    remediation: 'Wait for the grace period to elapse before relying on fresh prices.',
    sequencerRule: true,
  },
};

/**
 * Whether a price-feed rule is missing a field it needs to reach a verdict. Each rule
 * depends on a different subset of the observation, so a blanket check would let a rule
 * resolve to `pass` when the very data it needs (e.g. the heartbeat) is absent. Reporting
 * `unknown` instead keeps absence of evidence from reading as a healthy feed. Sequencer
 * rules are not consulted here; `statusFor` handles their missing state via `sequencerUp`.
 */
function requiredReadingMissing(code: OracleRuleCode, r: OracleBehaviorResult): boolean {
  switch (code) {
    case 'oracle_stale':
      return (
        r.answerRaw === null ||
        r.updatedAtSeconds === null ||
        r.scanTimeSeconds === null ||
        r.heartbeatSeconds === null
      );
    case 'oracle_answer_invalid':
      return r.answerRaw === null;
    case 'oracle_incomplete_round':
      return r.roundId === null || r.answeredInRound === null;
    case 'oracle_paused':
      // oraclePaused is a non-nullable boolean, so this verdict is always reachable.
      return false;
    case 'sequencer_down':
    case 'sequencer_grace_period':
      return false;
  }
}

function triggered(code: OracleRuleCode, r: OracleBehaviorResult): boolean {
  switch (code) {
    case 'oracle_stale':
      return (
        r.updatedAtSeconds !== null &&
        r.scanTimeSeconds !== null &&
        r.heartbeatSeconds !== null &&
        r.scanTimeSeconds - r.updatedAtSeconds > BigInt(r.heartbeatSeconds)
      );
    case 'oracle_answer_invalid':
      return r.answerRaw !== null && r.answerRaw <= 0n;
    case 'oracle_incomplete_round':
      return r.roundId !== null && r.answeredInRound !== null && r.answeredInRound < r.roundId;
    case 'oracle_paused':
      return r.oraclePaused;
    case 'sequencer_down':
      return r.sequencerUp === false;
    case 'sequencer_grace_period':
      return (
        r.sequencerUp === true &&
        r.sequencerRecoveredAtSeconds !== null &&
        r.scanTimeSeconds !== null &&
        r.scanTimeSeconds - r.sequencerRecoveredAtSeconds < SEQUENCER_GRACE_SECONDS
      );
  }
}

function statusFor(code: OracleRuleCode, r: OracleBehaviorResult): RiskFindingStatus {
  const spec = SPECS[code];
  if (!r.applicable) return 'not_applicable';
  if (spec.sequencerRule && !r.sequencerConfigured) return 'not_applicable';
  if (!spec.sequencerRule && requiredReadingMissing(code, r)) return 'unknown';
  if (spec.sequencerRule && r.sequencerUp === null) return 'unknown';
  return triggered(code, r) ? spec.status : 'pass';
}

function evaluationFor(code: OracleRuleCode, context: Readonly<RiskScanContext>): RiskRuleEvaluation {
  const serialized = context.data[ORACLE_OBSERVATION_SOURCE];
  const result = deserializeOracleResult(serialized);
  const spec = SPECS[code];
  const status = statusFor(code, result);
  const fired = status === 'fail' || status === 'warning';
  return {
    status,
    severity: fired ? spec.severity : 'info',
    confidence: {
      level: status === 'unknown' ? 'unknown' : 'high',
      basisPoints: status === 'unknown' ? 0 : 9000,
      rationale:
        status === 'unknown'
          ? 'No readable oracle observation at the pinned block.'
          : 'Derived from the pinned oracle observation state.',
    },
    title: fired ? spec.title : `${spec.title} not found`,
    explanation:
      status === 'not_applicable'
        ? 'No oracle price source applies to this token, so this check does not apply.'
        : status === 'unknown'
          ? 'The configured oracle source had no readable observation at the pinned block.'
          : fired
            ? spec.whenPresent
            : spec.whenAbsent,
    evidence: [
      {
        evidenceType: 'oracle_observation',
        summary: fired ? spec.whenPresent : spec.whenAbsent,
        data: {
          sourceKey: result.sourceKey,
          answerRaw: result.answerRaw?.toString() ?? null,
          roundId: result.roundId?.toString() ?? null,
          answeredInRound: result.answeredInRound?.toString() ?? null,
          updatedAtSeconds: result.updatedAtSeconds?.toString() ?? null,
          heartbeatSeconds: result.heartbeatSeconds,
          oraclePaused: result.oraclePaused,
          sequencerUp: result.sequencerUp,
          sequencerRecoveredAtSeconds: result.sequencerRecoveredAtSeconds?.toString() ?? null,
        },
        provenanceKeys: [ORACLE_OBSERVATION_SOURCE],
      },
    ],
    remediation: fired ? spec.remediation : null,
    fingerprintSeed: code,
  };
}

function maxPenalty(code: OracleRuleCode): number {
  const spec = SPECS[code];
  if (spec.severity === 'critical') return 3000;
  return spec.severity === 'high' ? 2500 : 800;
}

export function createOracleRiskRules(): readonly RiskRule[] {
  return ORACLE_RULE_CODES.map((code) => ({
    ruleId: `oracle.${code}`,
    version: '1.0.0',
    category: 'Oracle behavior' as const,
    title: SPECS[code].title,
    description: SPECS[code].description,
    requiredDataSources: [ORACLE_OBSERVATION_SOURCE],
    maxPenaltyBps: maxPenalty(code),
    evaluate: async (context: Readonly<RiskScanContext>) => evaluationFor(code, context),
  }));
}
