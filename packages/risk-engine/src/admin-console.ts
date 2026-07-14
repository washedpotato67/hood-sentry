export type AdminRole =
  | 'support'
  | 'moderator'
  | 'risk_analyst'
  | 'operations'
  | 'security'
  | 'super_admin';
export type AdminSession = {
  id: string;
  adminId: string;
  role: AdminRole;
  expiresAt: number;
  reauthenticatedAt?: number;
  ip: string;
  device: string;
};
export type AdminAudit = {
  id: string;
  adminId: string;
  action: string;
  reason: string;
  at: string;
  target: string;
  approvalIds: readonly string[];
};
const permissions: Record<AdminRole, readonly string[]> = {
  support: ['reports:read'],
  moderator: ['reports:read', 'reports:resolve'],
  risk_analyst: ['risk:read', 'risk:suppress'],
  operations: ['queues:read', 'flags:write'],
  security: ['audit:read', 'claims:write'],
  super_admin: ['*'],
};
export function authorizeAdmin(
  s: AdminSession,
  permission: string,
  now: number,
  reason: string,
  stepUp = false,
) {
  if (s.expiresAt <= now || !reason.trim()) throw new Error('Admin session or reason invalid');
  if (stepUp && (!s.reauthenticatedAt || now - s.reauthenticatedAt > 300000))
    throw new Error('Step-up authentication required');
  const allowed = permissions[s.role];
  if (!allowed.includes('*') && !allowed.includes(permission))
    throw new Error('Admin permission denied');
  return true;
}
export function auditAdminMutation(
  s: AdminSession,
  action: string,
  target: string,
  reason: string,
  approvalIds: readonly string[] = [],
): AdminAudit {
  return {
    id: `audit_${s.id}:${action}:${target}:${Date.now()}`,
    adminId: s.adminId,
    action,
    reason,
    at: new Date().toISOString(),
    target,
    approvalIds,
  };
}
