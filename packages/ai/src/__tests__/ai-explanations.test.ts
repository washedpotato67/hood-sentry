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
  it('strips em and en dashes from generated prose', async () => {
    const findings = [
      { id: 'f1', title: 'Risk', severity: 'high', confidence: 'high', evidence: ['chain'] },
    ];
    await expect(
      explainFindings(
        findings,
        {
          generate: async () => ({
            summary: 'Owner control — a persistent privilege, 5–9 of them.',
            citations: ['f1'],
          }),
        },
        true,
      ),
    ).resolves.toMatchObject({ summary: 'Owner control, a persistent privilege, 5, 9 of them.' });
  });
  it('works without AI', async () => {
    await expect(explainFindings([], { generate: async () => ({}) }, false)).resolves.toMatchObject(
      { summary: 'AI explanations are disabled.' },
    );
  });
});
