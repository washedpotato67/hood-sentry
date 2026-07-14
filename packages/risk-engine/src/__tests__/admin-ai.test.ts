import { describe, expect, it } from 'vitest';
import { auditAdminMutation, authorizeAdmin } from '../admin-console.js';
import { explainFindings } from '../ai-explanations.js';
describe('admin and AI explanation controls', () => {
  const session = {
    id: 's',
    adminId: 'a',
    role: 'moderator' as const,
    expiresAt: 1000,
    reauthenticatedAt: 900,
    ip: '127.0.0.1',
    device: 'test',
  };
  it('enforces role, reason, expiry, and audit attribution', () => {
    expect(authorizeAdmin(session, 'reports:resolve', 950, 'evidence')).toBe(true);
    expect(() => authorizeAdmin(session, 'flags:write', 950, 'x')).toThrow();
    expect(auditAdminMutation(session, 'resolve', 'r', 'evidence').adminId).toBe('a');
  });
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
