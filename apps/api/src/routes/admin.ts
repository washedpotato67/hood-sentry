import { type Database, schema } from '@hood-sentry/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@hood-sentry/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { type AuthSessionManager, requireTrustedOrigin } from '../auth-session.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
const limitOffsetSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().nonnegative().max(10_000).default(0),
});
const adminRoleSchema = z.enum(['super_admin', 'moderator', 'reviewer', 'analyst']);
const claimStatusSchema = z.enum(['pending', 'approved', 'rejected']);
const reportStatusSchema = z.enum(['submitted', 'under_review', 'upheld', 'rejected', 'appealed']);
const appealStatusSchema = z.enum(['pending', 'accepted', 'rejected']);

type AdminRole = z.infer<typeof adminRoleSchema>;

export type AdminRouteOptions = {
  database: Database;
  sessions: AuthSessionManager;
  publicAppUrl: string;
};

function userAgent(request: FastifyRequest): string | null {
  const value = request.headers['user-agent'];
  if (value === undefined) return null;
  return value.slice(0, 2_000);
}

async function requireAdmin(
  request: FastifyRequest,
  options: AdminRouteOptions,
  allowed: readonly AdminRole[],
) {
  requireTrustedOrigin(request, options.publicAppUrl);
  const session = await options.sessions.require(request);
  const rows = await options.database.db
    .select({ role: schema.adminRoles.roleName })
    .from(schema.adminRoles)
    .where(
      and(
        eq(schema.adminRoles.userId, session.user.id),
        isNull(schema.adminRoles.revokedAt),
        inArray(schema.adminRoles.roleName, allowed),
      ),
    );
  if (rows.length === 0) throw new ForbiddenError('An active admin role is required');
  return { session, roles: rows.map((row) => row.role) };
}

async function audit(
  transaction: Parameters<Parameters<Database['db']['transaction']>[0]>[0],
  input: {
    adminUserId: string;
    actionType: 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'verify' | 'revoke';
    targetType: string;
    targetId: string;
    changes: unknown;
    request: FastifyRequest;
  },
): Promise<void> {
  await transaction.insert(schema.adminAuditLogs).values({
    adminUserId: input.adminUserId,
    actionType: input.actionType,
    targetType: input.targetType,
    targetId: input.targetId,
    changes: input.changes,
    ipAddress: input.request.ip.slice(0, 45),
    userAgent: userAgent(input.request),
  });
}

export async function adminRoutes(app: FastifyInstance, options: AdminRouteOptions) {
  app.get('/admin/session', async (request) => {
    const admin = await requireAdmin(request, options, [
      'super_admin',
      'moderator',
      'reviewer',
      'analyst',
    ]);
    return { data: { userId: admin.session.user.id, roles: admin.roles } };
  });

  app.get('/admin/audit-log', async (request) => {
    await requireAdmin(request, options, ['super_admin', 'moderator', 'reviewer', 'analyst']);
    const query = limitOffsetSchema.parse(request.query);
    const rows = await options.database.db
      .select()
      .from(schema.adminAuditLogs)
      .orderBy(desc(schema.adminAuditLogs.performedAt), desc(schema.adminAuditLogs.id))
      .limit(query.limit)
      .offset(query.offset);
    return { data: rows };
  });

  app.get('/admin/project-claims', async (request) => {
    await requireAdmin(request, options, ['super_admin', 'moderator', 'reviewer']);
    const query = limitOffsetSchema
      .extend({ status: claimStatusSchema.optional() })
      .parse(request.query);
    const rows = await options.database.db
      .select({
        claim: schema.projectClaims,
        projectName: schema.projectProfiles.projectName,
        projectSlug: schema.projectProfiles.slug,
        chainId: schema.projectProfiles.chainId,
      })
      .from(schema.projectClaims)
      .innerJoin(
        schema.projectProfiles,
        eq(schema.projectClaims.projectProfileId, schema.projectProfiles.id),
      )
      .where(query.status === undefined ? undefined : eq(schema.projectClaims.status, query.status))
      .orderBy(asc(schema.projectClaims.createdAt), asc(schema.projectClaims.id))
      .limit(query.limit)
      .offset(query.offset);
    return { data: rows };
  });

  app.post('/admin/project-claims/:id/review', async (request) => {
    const admin = await requireAdmin(request, options, ['super_admin', 'moderator', 'reviewer']);
    const { id } = idParamsSchema.parse(request.params);
    const input = z
      .object({
        status: z.enum(['approved', 'rejected']),
        reason: z.string().trim().min(10).max(5_000),
      })
      .parse(request.body);
    return options.database.db.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(schema.projectClaims)
        .where(eq(schema.projectClaims.id, id))
        .for('update')
        .limit(1);
      const claim = rows[0];
      if (claim === undefined) throw new NotFoundError('Project claim', id);
      if (claim.status !== 'pending') throw new ConflictError('The project claim was reviewed');
      const now = new Date();
      const updated = await transaction
        .update(schema.projectClaims)
        .set({
          status: input.status,
          reviewedBy: admin.session.user.id,
          reviewedAt: now,
          reviewNotes: input.reason,
          updatedAt: now,
        })
        .where(eq(schema.projectClaims.id, id))
        .returning();
      if (input.status === 'approved' && claim.claimType === 'ownership') {
        await transaction
          .update(schema.projectProfiles)
          .set({ verified: true, verifiedAt: now, updatedAt: now })
          .where(eq(schema.projectProfiles.id, claim.projectProfileId));
      }
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${claim.projectProfileId}))`,
      );
      const versions = await transaction
        .select({ version: schema.projectProfileVersions.versionNumber })
        .from(schema.projectProfileVersions)
        .where(eq(schema.projectProfileVersions.projectProfileId, claim.projectProfileId))
        .orderBy(desc(schema.projectProfileVersions.versionNumber))
        .limit(1);
      await transaction.insert(schema.projectProfileVersions).values({
        projectProfileId: claim.projectProfileId,
        versionNumber: (versions[0]?.version ?? 0) + 1,
        changes: {
          action: 'claim_review',
          claimId: id,
          claimType: claim.claimType,
          status: input.status,
          identityVerified: input.status === 'approved' && claim.claimType === 'ownership',
          reason: input.reason,
        },
        changedBy: admin.session.user.id,
      });
      await audit(transaction, {
        adminUserId: admin.session.user.id,
        actionType: input.status === 'approved' ? 'approve' : 'reject',
        targetType: 'project_claim',
        targetId: id,
        changes: { previousStatus: claim.status, ...input },
        request,
      });
      return { data: updated[0] };
    });
  });

  app.get('/admin/reports', async (request) => {
    await requireAdmin(request, options, ['super_admin', 'moderator', 'reviewer', 'analyst']);
    const query = limitOffsetSchema
      .extend({ status: reportStatusSchema.optional() })
      .parse(request.query);
    const rows = await options.database.db
      .select()
      .from(schema.communityReports)
      .where(
        query.status === undefined ? undefined : eq(schema.communityReports.status, query.status),
      )
      .orderBy(asc(schema.communityReports.submittedAt), asc(schema.communityReports.id))
      .limit(query.limit)
      .offset(query.offset);
    return { data: rows };
  });

  app.post('/admin/reports/:id/review', async (request) => {
    const admin = await requireAdmin(request, options, ['super_admin', 'moderator', 'reviewer']);
    const { id } = idParamsSchema.parse(request.params);
    const input = z
      .discriminatedUnion('action', [
        z.object({
          action: z.literal('start_review'),
          notes: z.string().trim().min(10).max(10_000),
        }),
        z.object({
          action: z.literal('resolve'),
          resolutionType: z.enum(['upheld', 'rejected', 'dismissed', 'escalated']),
          notes: z.string().trim().min(10).max(10_000),
        }),
      ])
      .parse(request.body);
    return options.database.db.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(schema.communityReports)
        .where(eq(schema.communityReports.id, id))
        .for('update')
        .limit(1);
      const report = rows[0];
      if (report === undefined) throw new NotFoundError('Report', id);
      const now = new Date();
      if (input.action === 'start_review') {
        if (!['submitted', 'appealed'].includes(report.status)) {
          throw new ConflictError('The report is not awaiting review');
        }
        const updated = await transaction
          .update(schema.communityReports)
          .set({ status: 'under_review', reviewedAt: now })
          .where(eq(schema.communityReports.id, id))
          .returning();
        await audit(transaction, {
          adminUserId: admin.session.user.id,
          actionType: 'update',
          targetType: 'community_report',
          targetId: id,
          changes: { previousStatus: report.status, status: 'under_review', notes: input.notes },
          request,
        });
        return { data: updated[0] };
      }
      if (!['submitted', 'under_review', 'appealed'].includes(report.status)) {
        throw new ConflictError('The report already has a final resolution');
      }
      const finalStatus =
        input.resolutionType === 'upheld'
          ? 'upheld'
          : input.resolutionType === 'escalated'
            ? 'under_review'
            : 'rejected';
      await transaction.insert(schema.reportResolutions).values({
        reportId: id,
        resolutionType: input.resolutionType,
        resolutionNotes: input.notes,
        resolvedBy: admin.session.user.id,
        resolvedAt: now,
      });
      const updated = await transaction
        .update(schema.communityReports)
        .set({
          status: finalStatus,
          reviewedAt: now,
          resolvedAt: finalStatus === 'under_review' ? null : now,
        })
        .where(eq(schema.communityReports.id, id))
        .returning();
      await audit(transaction, {
        adminUserId: admin.session.user.id,
        actionType:
          input.resolutionType === 'upheld'
            ? 'approve'
            : input.resolutionType === 'escalated'
              ? 'update'
              : 'reject',
        targetType: 'community_report',
        targetId: id,
        changes: { previousStatus: report.status, status: finalStatus, ...input },
        request,
      });
      return { data: updated[0] };
    });
  });

  app.get('/admin/report-appeals', async (request) => {
    await requireAdmin(request, options, ['super_admin', 'moderator', 'reviewer']);
    const query = limitOffsetSchema
      .extend({ status: appealStatusSchema.optional() })
      .parse(request.query);
    const rows = await options.database.db
      .select({ appeal: schema.reportAppeals, report: schema.communityReports })
      .from(schema.reportAppeals)
      .innerJoin(
        schema.communityReports,
        eq(schema.reportAppeals.reportId, schema.communityReports.id),
      )
      .where(query.status === undefined ? undefined : eq(schema.reportAppeals.status, query.status))
      .orderBy(asc(schema.reportAppeals.submittedAt), asc(schema.reportAppeals.id))
      .limit(query.limit)
      .offset(query.offset);
    return { data: rows };
  });

  app.post('/admin/report-appeals/:id/review', async (request) => {
    const admin = await requireAdmin(request, options, ['super_admin', 'moderator', 'reviewer']);
    const { id } = idParamsSchema.parse(request.params);
    const input = z
      .object({
        status: z.enum(['accepted', 'rejected']),
        reason: z.string().trim().min(10).max(10_000),
      })
      .parse(request.body);
    return options.database.db.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(schema.reportAppeals)
        .where(eq(schema.reportAppeals.id, id))
        .for('update')
        .limit(1);
      const appeal = rows[0];
      if (appeal === undefined) throw new NotFoundError('Report appeal', id);
      if (appeal.status !== 'pending') throw new ConflictError('The appeal was reviewed');
      const now = new Date();
      const updated = await transaction
        .update(schema.reportAppeals)
        .set({
          status: input.status,
          reviewedAt: now,
          reviewedBy: admin.session.user.id,
          reviewNotes: input.reason,
        })
        .where(eq(schema.reportAppeals.id, id))
        .returning();
      if (input.status === 'accepted') {
        await transaction
          .update(schema.communityReports)
          .set({ status: 'under_review', reviewedAt: now, resolvedAt: null })
          .where(eq(schema.communityReports.id, appeal.reportId));
      } else {
        const resolutions = await transaction
          .select({ type: schema.reportResolutions.resolutionType })
          .from(schema.reportResolutions)
          .where(eq(schema.reportResolutions.reportId, appeal.reportId))
          .orderBy(desc(schema.reportResolutions.resolvedAt))
          .limit(1);
        const type = resolutions[0]?.type;
        const restored =
          type === 'upheld' ? 'upheld' : type === 'escalated' ? 'under_review' : 'rejected';
        await transaction
          .update(schema.communityReports)
          .set({
            status: restored,
            reviewedAt: now,
            resolvedAt: restored === 'under_review' ? null : now,
          })
          .where(eq(schema.communityReports.id, appeal.reportId));
      }
      await audit(transaction, {
        adminUserId: admin.session.user.id,
        actionType: input.status === 'accepted' ? 'approve' : 'reject',
        targetType: 'report_appeal',
        targetId: id,
        changes: { previousStatus: appeal.status, ...input },
        request,
      });
      return { data: updated[0] };
    });
  });
}
