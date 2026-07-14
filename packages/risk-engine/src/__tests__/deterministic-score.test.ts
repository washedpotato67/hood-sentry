import { describe, expect, it } from 'vitest';
import { scoreRisk } from '../deterministic-score.js';
describe('deterministic scoring', () => {
  it('scores deterministically and explains changes', () => {
    const a = scoreRisk(
      [
        {
          id: 'mint',
          category: 'contractControl',
          penalty: 10n,
          confidence: 'high',
          explanation: 'mint',
        },
      ],
      10000n,
      'v1',
    );
    const b = scoreRisk(
      [
        {
          id: 'mint',
          category: 'contractControl',
          penalty: 20n,
          confidence: 'high',
          explanation: 'mint',
        },
      ],
      10000n,
      'v1',
      a,
    );
    expect(a.grade).toBe('A');
    expect(b.changes).toContain('contractControl changed');
  });
  it('returns U for incomplete data', () => {
    expect(scoreRisk([], 5000n, 'v1').grade).toBe('U');
  });
});
