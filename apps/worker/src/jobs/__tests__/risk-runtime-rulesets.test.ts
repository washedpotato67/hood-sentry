import { RiskRuleRegistry } from '@hood-sentry/risk-engine';
import { describe, expect, it } from 'vitest';
import { ALL_RULES, POOL_RISK_RULESET, TOKEN_RISK_RULESET } from '../risk-runtime.js';

describe('risk rulesets cover the oracle and market categories', () => {
  it('registers oracle and market-integrity rules without duplicates', () => {
    const registry = new RiskRuleRegistry(ALL_RULES);
    const ids = registry.list().map((r) => r.ruleId);
    expect(ids).toContain('oracle.oracle_stale');
    expect(ids).toContain('market.self_trading');
  });

  it('resolves the token ruleset with both new categories and their caps', () => {
    const registry = new RiskRuleRegistry(ALL_RULES);
    const { rules } = registry.resolveRuleset(TOKEN_RISK_RULESET);
    const categories = new Set(rules.map((r) => r.category));
    expect(categories.has('Oracle behavior')).toBe(true);
    expect(categories.has('Market integrity')).toBe(true);
    for (const category of categories) {
      expect(TOKEN_RISK_RULESET.categoryPenaltyCapsBps[category]).toBeGreaterThan(0);
    }
  });

  it('resolves the pool ruleset with caps for every category it references', () => {
    const registry = new RiskRuleRegistry(ALL_RULES);
    const { rules } = registry.resolveRuleset(POOL_RISK_RULESET);
    for (const rule of rules) {
      expect(POOL_RISK_RULESET.categoryPenaltyCapsBps[rule.category]).toBeGreaterThan(0);
    }
  });
});
