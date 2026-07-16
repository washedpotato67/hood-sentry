import { describe, expect, it } from 'vitest';
import { POOL_RISK_RULESET, RISK_METHODOLOGY_VERSION, TOKEN_RISK_RULESET } from './risk-runtime.js';

describe('production risk rulesets', () => {
  it('marks the active methodology and rulesets as partial', () => {
    expect(RISK_METHODOLOGY_VERSION).toContain('partial');
    expect(TOKEN_RISK_RULESET.version).toContain('partial');
    expect(POOL_RISK_RULESET.version).toContain('partial');
  });

  it('runs contract, liquidity, and holder rules for tokens', () => {
    const ruleIds = TOKEN_RISK_RULESET.rules.map((rule) => rule.ruleId);
    expect(ruleIds.some((ruleId) => ruleId.startsWith('proxy.'))).toBe(true);
    expect(ruleIds.some((ruleId) => ruleId.startsWith('privilege.'))).toBe(true);
    expect(ruleIds.some((ruleId) => ruleId.startsWith('liquidity.'))).toBe(true);
    expect(ruleIds.some((ruleId) => ruleId.startsWith('holder.'))).toBe(true);
  });

  it('excludes token holder rules from pool targets', () => {
    const ruleIds = POOL_RISK_RULESET.rules.map((rule) => rule.ruleId);
    expect(ruleIds.some((ruleId) => ruleId.startsWith('liquidity.'))).toBe(true);
    expect(ruleIds.some((ruleId) => ruleId.startsWith('holder.'))).toBe(false);
    expect(POOL_RISK_RULESET.categoryPenaltyCapsBps['Holder distribution']).toBeUndefined();
  });
});
