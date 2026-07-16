-- Migration: 026_admin_role_alignment
-- Created: 2026-07-15
-- Description: Align admin RBAC and audit constraints with the protected moderation API.

ALTER TABLE admin_roles DROP CONSTRAINT IF EXISTS admin_roles_role_name_check;

UPDATE admin_roles SET role_name = 'moderator' WHERE role_name = 'admin';

ALTER TABLE admin_roles
  ADD CONSTRAINT admin_roles_role_name_check
  CHECK (role_name IN ('super_admin', 'moderator', 'reviewer', 'analyst'));

ALTER TABLE admin_roles DROP CONSTRAINT IF EXISTS admin_roles_user_id_role_name_key;

ALTER TABLE admin_roles
  ALTER COLUMN granted_by TYPE UUID
  USING (
    CASE
      WHEN granted_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN granted_by::UUID
      ELSE user_id
    END
  );

ALTER TABLE admin_roles DROP CONSTRAINT IF EXISTS admin_roles_granted_by_fkey;
ALTER TABLE admin_roles
  ADD CONSTRAINT admin_roles_granted_by_fkey
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE admin_audit_logs DROP CONSTRAINT IF EXISTS admin_audit_logs_action_type_check;
ALTER TABLE admin_audit_logs
  ADD CONSTRAINT admin_audit_logs_action_type_check
  CHECK (action_type IN (
    'create', 'update', 'delete', 'approve', 'reject', 'ban', 'unban', 'verify', 'revoke'
  ));

ALTER TABLE admin_audit_logs
  ALTER COLUMN target_id TYPE UUID USING target_id::UUID;

ALTER TABLE admin_audit_logs
  ALTER COLUMN changes DROP NOT NULL;
