import { describe, expect, it } from 'vitest';
import { explainFindings } from '../ai-explanations.js';
describe('AI explanation controls', () => {
  it('requires finding citations and rejects invented references', async () => {
    const findings = [
      { id: 'f1', title: 'Risk', severity: 'high', confidence: 'high', evidence: ['chain'] },
    ];
    await expect(
      explainFindings(
        findings,
        { generate: async () => ({ summary: 'x', citations: ['fake'] }) },
        true,
      ),
    ).rejects.toThrow();
    await expect(
      explainFindings(
        findings,
        { generate: async () => ({ summary: 'x', citations: ['f1'] }) },
        true,
      ),
    ).resolves.toMatchObject({ citations: ['f1'] });
  });
  it('works without AI', async () => {
    await expect(explainFindings([], { generate: async () => ({}) }, false)).resolves.toMatchObject(
      { summary: 'AI explanations are disabled.' },
    );
  });
});
