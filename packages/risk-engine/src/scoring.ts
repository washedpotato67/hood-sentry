import type { RiskCompleteness, RiskFinding, RiskRule, RiskRuleset, RiskScore } from './types.js';
import { RISK_CATEGORIES } from './types.js';

function findingPenalty(finding: RiskFinding, rule: RiskRule): number {
  if (finding.status === 'fail') return rule.maxPenaltyBps;
  if (finding.status === 'warning') return Math.floor(rule.maxPenaltyBps / 2);
  return 0;
}

function grade(scoreBps: number): RiskScore['grade'] {
  if (scoreBps >= 9_000) return 'A';
  if (scoreBps >= 8_000) return 'B';
  if (scoreBps >= 7_000) return 'C';
  if (scoreBps >= 6_000) return 'D';
  return 'F';
}

export function calculateRiskScore(input: {
  findings: readonly RiskFinding[];
  rules: readonly RiskRule[];
  ruleset: RiskRuleset;
  completeness: RiskCompleteness;
}): RiskScore {
  const rules = new Map(input.rules.map((rule) => [`${rule.ruleId}@${rule.version}`, rule]));
  const categoryPenalties = new Map<RiskFinding['category'], number>();
  for (const finding of input.findings) {
    const rule = rules.get(`${finding.ruleId}@${finding.ruleVersion}`);
    if (!rule)
      throw new Error(`No scoring configuration for ${finding.ruleId}@${finding.ruleVersion}`);
    const current = categoryPenalties.get(finding.category) ?? 0;
    categoryPenalties.set(finding.category, current + findingPenalty(finding, rule));
  }

  const categoryScoresBps: Partial<Record<RiskFinding['category'], number>> = {};
  let totalPenalty = 0;
  for (const category of RISK_CATEGORIES) {
    const cap = input.ruleset.categoryPenaltyCapsBps[category];
    if (cap === undefined) continue;
    const penalty = Math.min(categoryPenalties.get(category) ?? 0, cap);
    categoryScoresBps[category] = Math.max(0, 10_000 - penalty);
    totalPenalty += penalty;
  }
  const scoreBps = Math.max(0, 10_000 - Math.min(10_000, totalPenalty));
  const warnings = [...input.completeness.reasons];
  if (input.completeness.basisPoints < 10_000) warnings.push('RISK_DATA_INCOMPLETE');

  return {
    scoreBps,
    grade: grade(scoreBps),
    categoryScoresBps,
    methodologyVersion: input.ruleset.methodologyVersion,
    completeness: input.completeness,
    warnings: [...new Set(warnings)].sort(),
  };
}
