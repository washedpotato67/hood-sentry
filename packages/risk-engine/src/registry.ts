import { RISK_CATEGORIES, type RiskRule, type RiskRuleset, riskRulesetSchema } from './types.js';

const categoryOrder = new Map(RISK_CATEGORIES.map((category, index) => [category, index]));

export function compareRiskRules(left: RiskRule, right: RiskRule): number {
  const categoryDifference =
    (categoryOrder.get(left.category) ?? RISK_CATEGORIES.length) -
    (categoryOrder.get(right.category) ?? RISK_CATEGORIES.length);
  if (categoryDifference !== 0) return categoryDifference;
  const idDifference = left.ruleId < right.ruleId ? -1 : left.ruleId > right.ruleId ? 1 : 0;
  if (idDifference !== 0) return idDifference;
  return left.version < right.version ? -1 : left.version > right.version ? 1 : 0;
}

function ruleKey(ruleId: string, version: string): string {
  return `${ruleId}@${version}`;
}

function validateRule(rule: RiskRule): void {
  if (rule.ruleId.trim().length === 0) throw new Error('Risk rule ID is required');
  if (rule.version.trim().length === 0) throw new Error(`Risk rule ${rule.ruleId} needs a version`);
  if (
    !Number.isInteger(rule.maxPenaltyBps) ||
    rule.maxPenaltyBps < 0 ||
    rule.maxPenaltyBps > 10_000
  ) {
    throw new Error(`Risk rule ${ruleKey(rule.ruleId, rule.version)} has an invalid penalty`);
  }
  const dependencyKeys = new Set<string>();
  for (const dependency of rule.requiredDataSources) {
    if (dependency.trim().length === 0) throw new Error('Risk data source keys cannot be empty');
    if (dependencyKeys.has(dependency)) {
      throw new Error(`Risk rule ${ruleKey(rule.ruleId, rule.version)} repeats ${dependency}`);
    }
    dependencyKeys.add(dependency);
  }
}

export class RiskRuleRegistry {
  private readonly rules = new Map<string, RiskRule>();

  constructor(rules: readonly RiskRule[] = []) {
    for (const rule of rules) this.register(rule);
  }

  register(rule: RiskRule): void {
    validateRule(rule);
    const key = ruleKey(rule.ruleId, rule.version);
    if (this.rules.has(key)) throw new Error(`Duplicate risk rule ${key}`);
    Object.freeze(rule.requiredDataSources);
    Object.freeze(rule);
    this.rules.set(key, rule);
  }

  get(ruleId: string, version: string): RiskRule | null {
    return this.rules.get(ruleKey(ruleId, version)) ?? null;
  }

  list(): readonly RiskRule[] {
    return [...this.rules.values()].sort(compareRiskRules);
  }

  resolveRuleset(input: RiskRuleset): { ruleset: RiskRuleset; rules: readonly RiskRule[] } {
    const ruleset = riskRulesetSchema.parse(input);
    const references = new Set<string>();
    const rules: RiskRule[] = [];
    for (const reference of ruleset.rules) {
      const key = ruleKey(reference.ruleId, reference.version);
      if (references.has(key)) throw new Error(`Ruleset ${ruleset.version} repeats ${key}`);
      references.add(key);
      const rule = this.rules.get(key);
      if (!rule) throw new Error(`Ruleset ${ruleset.version} references unknown rule ${key}`);
      if (ruleset.categoryPenaltyCapsBps[rule.category] === undefined) {
        throw new Error(`Ruleset ${ruleset.version} has no penalty cap for ${rule.category}`);
      }
      rules.push(rule);
    }
    return { ruleset, rules: rules.sort(compareRiskRules) };
  }
}
