import { createFindingFingerprint } from './fingerprint.js';
import type { RiskRuleRegistry } from './registry.js';
import { calculateRiskScore } from './scoring.js';
import {
  type RiskCompleteness,
  type RiskDataSource,
  type RiskFinding,
  type RiskRule,
  type RiskRuleEvaluation,
  type RiskRuleset,
  type RiskScanContext,
  type RiskScanOptions,
  type RiskScanResult,
  type RiskSuppression,
  riskRuleEvaluationSchema,
  riskScanContextSchema,
  riskSuppressionSchema,
} from './types.js';

type RuleFailureCode =
  | 'RULE_TIMEOUT'
  | 'RULE_EXCEPTION'
  | 'DATA_DEPENDENCY_UNAVAILABLE'
  | 'SCAN_TIMEOUT'
  | 'SCAN_CANCELLED';

interface RuleOutcome {
  finding: RiskFinding;
  failureCode: RuleFailureCode | null;
}

function deepFreeze(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  Object.freeze(value);
}

function failureEvaluation(
  rule: RiskRule,
  code: RuleFailureCode,
  details: string,
): RiskRuleEvaluation {
  return {
    status: 'unknown',
    severity: 'info',
    confidence: {
      level: 'unknown',
      basisPoints: 0,
      rationale: 'The rule did not receive enough verified data to reach a conclusion.',
    },
    title: `${rule.title} unavailable`,
    explanation: details,
    evidence: [
      {
        evidenceType: 'rule_execution_state',
        summary: details,
        data: { code },
        provenanceKeys: [],
      },
    ],
    remediation: 'Run the rule again after the required data and services are available.',
    fingerprintSeed: 'rule-unavailable',
  };
}

function sourceMap(context: RiskScanContext): Map<string, RiskDataSource> {
  const sources = new Map<string, RiskDataSource>();
  for (const source of context.dataSources) {
    if (sources.has(source.key)) throw new Error(`Duplicate risk data source key ${source.key}`);
    if (
      source.sourceBlock !== context.sourceBlock ||
      source.sourceBlockHash.toLowerCase() !== context.sourceBlockHash.toLowerCase()
    ) {
      throw new Error(`Risk data source ${source.key} is not pinned to the scan block`);
    }
    sources.set(source.key, source);
  }
  return sources;
}

function findSuppression(
  suppressions: readonly RiskSuppression[],
  finding: Pick<RiskFinding, 'fingerprint' | 'ruleId' | 'ruleVersion'>,
): RiskSuppression | null {
  return (
    suppressions.find((suppression) => {
      if (suppression.fingerprint !== null) return suppression.fingerprint === finding.fingerprint;
      return (
        suppression.ruleId === finding.ruleId &&
        (suppression.ruleVersion === null || suppression.ruleVersion === finding.ruleVersion)
      );
    }) ?? null
  );
}

function materializeFinding(input: {
  rule: RiskRule;
  evaluation: RiskRuleEvaluation;
  context: RiskScanContext;
  sources: ReadonlyMap<string, RiskDataSource>;
  suppressions: readonly RiskSuppression[];
}): RiskFinding {
  const provenanceKeys = new Set(
    input.evaluation.evidence.flatMap((evidence) => evidence.provenanceKeys),
  );
  for (const dependency of input.rule.requiredDataSources) provenanceKeys.add(dependency);
  const dataProvenance = [...provenanceKeys]
    .sort()
    .map((key) => input.sources.get(key))
    .filter((source): source is RiskDataSource => source !== undefined);
  const fingerprint = createFindingFingerprint({
    target: input.context.target,
    ruleId: input.rule.ruleId,
    ruleVersion: input.rule.version,
    fingerprintSeed: input.evaluation.fingerprintSeed,
  });
  const suppression = findSuppression(input.suppressions, {
    fingerprint,
    ruleId: input.rule.ruleId,
    ruleVersion: input.rule.version,
  });
  return {
    ruleId: input.rule.ruleId,
    ruleVersion: input.rule.version,
    status: input.evaluation.status,
    category: input.rule.category,
    severity: input.evaluation.severity,
    confidence: input.evaluation.confidence,
    title: input.evaluation.title,
    explanation: input.evaluation.explanation,
    evidence: input.evaluation.evidence,
    sourceBlock: input.context.sourceBlock,
    sourceBlockHash: input.context.sourceBlockHash,
    dataProvenance,
    remediation: input.evaluation.remediation,
    fingerprint,
    suppressed: suppression !== null,
    suppressionReason: suppression?.reason ?? null,
  };
}

function validateTimeout(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive integer`);
}

function abortedEvaluation(
  rule: RiskRule,
  externalSignal: AbortSignal | undefined,
): { evaluation: RiskRuleEvaluation; failureCode: RuleFailureCode } {
  const failureCode = externalSignal?.aborted ? 'SCAN_CANCELLED' : 'SCAN_TIMEOUT';
  return {
    failureCode,
    evaluation: failureEvaluation(
      rule,
      failureCode,
      failureCode === 'SCAN_TIMEOUT'
        ? 'The scan exceeded its time limit.'
        : 'The risk scan was cancelled.',
    ),
  };
}

async function evaluateWithTimeout(
  rule: RiskRule,
  context: Readonly<RiskScanContext>,
  timeoutMs: number,
  parentSignal: AbortSignal,
): Promise<{ evaluation: RiskRuleEvaluation; failureCode: RuleFailureCode | null }> {
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener('abort', abort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('Rule timeout'));
        reject(new Error('RULE_TIMEOUT'));
      }, timeoutMs);
    });
    const evaluation = await Promise.race([
      rule.evaluate(context, controller.signal),
      timeoutPromise,
    ]);
    return { evaluation: riskRuleEvaluationSchema.parse(evaluation), failureCode: null };
  } catch (error) {
    if (parentSignal.aborted) {
      return {
        evaluation: failureEvaluation(rule, 'SCAN_CANCELLED', 'The risk scan was cancelled.'),
        failureCode: 'SCAN_CANCELLED',
      };
    }
    if (timedOut || (error instanceof Error && error.message === 'RULE_TIMEOUT')) {
      return {
        evaluation: failureEvaluation(rule, 'RULE_TIMEOUT', 'The rule exceeded its time limit.'),
        failureCode: 'RULE_TIMEOUT',
      };
    }
    const message = error instanceof Error ? error.message : 'Unknown rule error';
    return {
      evaluation: failureEvaluation(
        rule,
        'RULE_EXCEPTION',
        `The rule failed without affecting other rules. Error: ${message}`,
      ),
      failureCode: 'RULE_EXCEPTION',
    };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    parentSignal.removeEventListener('abort', abort);
  }
}

async function executeRule(input: {
  rule: RiskRule;
  context: RiskScanContext;
  sources: ReadonlyMap<string, RiskDataSource>;
  suppressions: readonly RiskSuppression[];
  perRuleTimeoutMs: number;
  scanSignal: AbortSignal;
  externalSignal?: AbortSignal;
}): Promise<RuleOutcome> {
  let outcome: {
    evaluation: RiskRuleEvaluation;
    failureCode: RuleFailureCode | null;
  };
  if (input.scanSignal.aborted) {
    outcome = abortedEvaluation(input.rule, input.externalSignal);
  } else {
    const unavailable = input.rule.requiredDataSources.filter(
      (key) => input.sources.get(key)?.status !== 'available',
    );
    if (unavailable.length > 0) {
      outcome = {
        failureCode: 'DATA_DEPENDENCY_UNAVAILABLE',
        evaluation: failureEvaluation(
          input.rule,
          'DATA_DEPENDENCY_UNAVAILABLE',
          `Required data unavailable: ${unavailable.sort().join(', ')}`,
        ),
      };
    } else {
      outcome = await evaluateWithTimeout(
        input.rule,
        input.context,
        input.perRuleTimeoutMs,
        input.scanSignal,
      );
      if (outcome.failureCode === 'SCAN_CANCELLED' && !input.externalSignal?.aborted) {
        outcome = abortedEvaluation(input.rule, input.externalSignal);
      }
    }
  }
  return {
    finding: materializeFinding({
      rule: input.rule,
      evaluation: outcome.evaluation,
      context: input.context,
      sources: input.sources,
      suppressions: input.suppressions,
    }),
    failureCode: outcome.failureCode,
  };
}

function completeness(
  findings: readonly RiskFinding[],
  outcomes: readonly RuleOutcome[],
): RiskCompleteness {
  const unknownRules = findings.filter((finding) => finding.status === 'unknown').length;
  const failedRules = outcomes.filter((outcome) => outcome.failureCode !== null).length;
  const unavailableDataSources = [
    ...new Set(
      findings.flatMap((finding) =>
        finding.dataProvenance
          .filter((source) => source.status !== 'available')
          .map((source) => source.key),
      ),
    ),
  ].sort();
  const totalRules = findings.length;
  const completeRules = totalRules - unknownRules;
  const basisPoints = totalRules === 0 ? 0 : Math.floor((completeRules * 10_000) / totalRules);
  const reasons: string[] = [
    ...new Set(
      outcomes
        .map((outcome) => outcome.failureCode)
        .filter((code): code is RuleFailureCode => code !== null),
    ),
  ].sort();
  if (unknownRules > 0 && reasons.length === 0) reasons.push('UNKNOWN_RULE_RESULTS');
  if (unavailableDataSources.length > 0) reasons.push('DATA_SOURCES_UNAVAILABLE');
  return {
    basisPoints,
    status: basisPoints === 10_000 ? 'complete' : basisPoints >= 5_000 ? 'partial' : 'insufficient',
    totalRules,
    evaluatedRules: completeRules,
    unknownRules,
    failedRules,
    unavailableDataSources,
    reasons: [...new Set(reasons)].sort(),
  };
}

export class RiskScanOrchestrator {
  constructor(
    private readonly registry: RiskRuleRegistry,
    private readonly engineVersion: string,
  ) {
    if (engineVersion.trim().length === 0) throw new Error('Risk engine version is required');
  }

  async scan(
    rawContext: RiskScanContext,
    rawRuleset: RiskRuleset,
    options: RiskScanOptions,
  ): Promise<RiskScanResult> {
    validateTimeout(options.scanTimeoutMs, 'Scan timeout');
    validateTimeout(options.perRuleTimeoutMs, 'Per-rule timeout');
    const context = riskScanContextSchema.parse(rawContext);
    deepFreeze(context);
    if (context.methodologyVersion !== rawRuleset.methodologyVersion) {
      throw new Error('Scan context and ruleset methodology versions differ');
    }
    const { ruleset, rules } = this.registry.resolveRuleset(rawRuleset);
    const sources = sourceMap(context);
    const suppressions = (options.suppressions ?? []).map((value) =>
      riskSuppressionSchema.parse(value),
    );
    const scanController = new AbortController();
    const externalAbort = () => scanController.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', externalAbort, { once: true });
    if (options.signal?.aborted) externalAbort();
    const scanTimeout = setTimeout(
      () => scanController.abort(new Error('SCAN_TIMEOUT')),
      options.scanTimeoutMs,
    );
    const outcomes: RuleOutcome[] = [];

    try {
      for (const rule of rules) {
        outcomes.push(
          await executeRule({
            rule,
            context,
            sources,
            suppressions,
            perRuleTimeoutMs: options.perRuleTimeoutMs,
            scanSignal: scanController.signal,
            externalSignal: options.signal,
          }),
        );
      }
    } finally {
      clearTimeout(scanTimeout);
      options.signal?.removeEventListener('abort', externalAbort);
    }

    const findings = outcomes.map((outcome) => outcome.finding);
    const scanCompleteness = completeness(findings, outcomes);
    const failureCodes = [
      ...new Set(
        outcomes
          .map((outcome) => outcome.failureCode)
          .filter((code): code is RuleFailureCode => code !== null),
      ),
    ].sort();
    const cancelled = options.signal?.aborted === true;
    const status = cancelled
      ? 'cancelled'
      : failureCodes.length > 0 || scanCompleteness.basisPoints < 10_000
        ? 'partial'
        : 'completed';
    return {
      target: context.target,
      engineVersion: this.engineVersion,
      rulesetVersion: ruleset.version,
      methodologyVersion: ruleset.methodologyVersion,
      sourceBlock: context.sourceBlock,
      sourceBlockHash: context.sourceBlockHash,
      status,
      findings,
      score: calculateRiskScore({ findings, rules, ruleset, completeness: scanCompleteness }),
      completeness: scanCompleteness,
      failureCodes,
    };
  }
}
