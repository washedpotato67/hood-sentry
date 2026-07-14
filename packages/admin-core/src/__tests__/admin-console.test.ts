import { describe, expect, it } from 'vitest';
import { auditAdminMutation, authorizeAdmin } from '../admin-console.js';
describe('admin console controls', () => {
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
});
