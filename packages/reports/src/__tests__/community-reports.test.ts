import { describe, expect, it } from 'vitest';
import { transitionReport } from '../community-reports.js';
describe('community reports', () => {
  it('keeps final reports immutable', () => {
    const r = {
      id: 'r',
      reporter: 'u',
      subject: 'token' as const,
      subjectId: 't',
      reason: 'phishing' as const,
      description: 'x',
      evidence: [],
      evidenceHash: 'h',
      links: [],
      timestamp: 'now',
      status: 'SUBMITTED' as const,
      history: [],
    };
    const f = transitionReport(r, 'FINAL', 'm', 'review');
    expect(() => transitionReport(f, 'REJECTED', 'm', 'x')).toThrow();
  });
});
