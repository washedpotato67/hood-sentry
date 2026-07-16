import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../../client.js';
import {
  communityReports,
  notificationChannels,
  projectClaims,
  projectProfileVersions,
  reportAppeals,
  reportResolutions,
  watchlistItems,
  watchlists,
  webhookEndpoints,
} from '../../schema/product.js';
import type {
  NotificationChannelRecord,
  ProductRepository,
  ProjectClaimRecord,
  ProjectProfileVersionRecord,
  ReportAppealRecord,
  ReportResolutionRecord,
  WatchlistItemRecord,
  WatchlistRecord,
  WebhookEndpointRecord,
} from '../interfaces/product-repository.js';

function required<T>(row: T | undefined, operation: string): T {
  if (row === undefined) throw new Error(`${operation} returned no row`);
  return row;
}

function watchlist(row: typeof watchlists.$inferSelect): WatchlistRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function item(row: typeof watchlistItems.$inferSelect): WatchlistItemRecord {
  return {
    id: row.id,
    watchlistId: row.watchlistId,
    chainId: row.chainId,
    targetAddress: row.targetAddress,
    targetType: row.targetType,
    notes: row.notes,
    addedAt: row.addedAt,
  };
}

function channel(row: typeof notificationChannels.$inferSelect): NotificationChannelRecord {
  return {
    id: row.id,
    userId: row.userId,
    channelType: row.channelType,
    channelConfig: row.channelConfig,
    verified: row.verified,
    verifiedAt: row.verifiedAt,
    verificationTokenHash: row.verificationTokenHash,
    verificationExpiresAt: row.verificationExpiresAt,
    verificationSentAt: row.verificationSentAt,
    verificationAttempts: row.verificationAttempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function webhook(row: typeof webhookEndpoints.$inferSelect): WebhookEndpointRecord {
  return {
    id: row.id,
    userId: row.userId,
    url: row.url,
    secretHash: row.secretHash,
    secretVersion: row.secretVersion,
    events: row.events,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleProductRepository implements ProductRepository {
  constructor(private readonly db: Database['db']) {}

  async listWatchlists(userId: string): Promise<readonly WatchlistRecord[]> {
    const rows = await this.db
      .select()
      .from(watchlists)
      .where(and(eq(watchlists.userId, userId), isNull(watchlists.deletedAt)))
      .orderBy(desc(watchlists.isDefault), asc(watchlists.name), asc(watchlists.id));
    return rows.map(watchlist);
  }

  async getWatchlist(userId: string, id: string): Promise<WatchlistRecord | null> {
    const rows = await this.db
      .select()
      .from(watchlists)
      .where(
        and(eq(watchlists.userId, userId), eq(watchlists.id, id), isNull(watchlists.deletedAt)),
      )
      .limit(1);
    return rows[0] === undefined ? null : watchlist(rows[0]);
  }

  async createWatchlist(
    userId: string,
    name: string,
    isDefault: boolean,
  ): Promise<WatchlistRecord> {
    return this.db.transaction(async (transaction) => {
      if (isDefault) {
        await transaction
          .update(watchlists)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(watchlists.userId, userId), isNull(watchlists.deletedAt)));
      }
      const rows = await transaction
        .insert(watchlists)
        .values({ userId, name, isDefault })
        .returning();
      return watchlist(required(rows[0], 'createWatchlist'));
    });
  }

  async updateWatchlist(
    userId: string,
    id: string,
    updates: { name?: string; isDefault?: boolean },
  ): Promise<WatchlistRecord | null> {
    return this.db.transaction(async (transaction) => {
      if (updates.isDefault === true) {
        await transaction
          .update(watchlists)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(watchlists.userId, userId), isNull(watchlists.deletedAt)));
      }
      const values: { name?: string; isDefault?: boolean; updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (updates.name !== undefined) values.name = updates.name;
      if (updates.isDefault !== undefined) values.isDefault = updates.isDefault;
      const rows = await transaction
        .update(watchlists)
        .set(values)
        .where(
          and(eq(watchlists.userId, userId), eq(watchlists.id, id), isNull(watchlists.deletedAt)),
        )
        .returning();
      return rows[0] === undefined ? null : watchlist(rows[0]);
    });
  }

  async deleteWatchlist(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .update(watchlists)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(watchlists.userId, userId), eq(watchlists.id, id), isNull(watchlists.deletedAt)),
      )
      .returning({ id: watchlists.id });
    return rows.length === 1;
  }

  async listWatchlistItems(
    userId: string,
    watchlistId: string,
  ): Promise<readonly WatchlistItemRecord[]> {
    const owner = await this.getWatchlist(userId, watchlistId);
    if (owner === null) return [];
    const rows = await this.db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.watchlistId, watchlistId))
      .orderBy(desc(watchlistItems.addedAt), asc(watchlistItems.id));
    return rows.map(item);
  }

  async addWatchlistItem(
    userId: string,
    input: Omit<WatchlistItemRecord, 'id' | 'addedAt'>,
  ): Promise<WatchlistItemRecord> {
    const owner = await this.getWatchlist(userId, input.watchlistId);
    if (owner === null) throw new Error('WATCHLIST_NOT_FOUND');
    const rows = await this.db
      .insert(watchlistItems)
      .values({
        watchlistId: input.watchlistId,
        chainId: input.chainId,
        targetAddress: input.targetAddress.toLowerCase(),
        targetType: input.targetType,
        notes: input.notes,
      })
      .onConflictDoUpdate({
        target: [
          watchlistItems.watchlistId,
          watchlistItems.chainId,
          watchlistItems.targetAddress,
          watchlistItems.targetType,
        ],
        set: { notes: input.notes },
      })
      .returning();
    return item(required(rows[0], 'addWatchlistItem'));
  }

  async deleteWatchlistItem(userId: string, watchlistId: string, itemId: string): Promise<boolean> {
    const owner = await this.getWatchlist(userId, watchlistId);
    if (owner === null) return false;
    const rows = await this.db
      .delete(watchlistItems)
      .where(and(eq(watchlistItems.watchlistId, watchlistId), eq(watchlistItems.id, itemId)))
      .returning({ id: watchlistItems.id });
    return rows.length === 1;
  }

  async listNotificationChannels(userId: string): Promise<readonly NotificationChannelRecord[]> {
    const rows = await this.db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.userId, userId))
      .orderBy(asc(notificationChannels.channelType), asc(notificationChannels.createdAt));
    return rows.map(channel);
  }

  async getNotificationChannel(
    userId: string,
    id: string,
  ): Promise<NotificationChannelRecord | null> {
    const rows = await this.db
      .select()
      .from(notificationChannels)
      .where(and(eq(notificationChannels.userId, userId), eq(notificationChannels.id, id)))
      .limit(1);
    return rows[0] === undefined ? null : channel(rows[0]);
  }

  async createNotificationChannel(
    input: Omit<NotificationChannelRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<NotificationChannelRecord> {
    const rows = await this.db.insert(notificationChannels).values(input).returning();
    return channel(required(rows[0], 'createNotificationChannel'));
  }

  async setNotificationChallenge(
    userId: string,
    id: string,
    tokenHash: string,
    expiresAt: Date,
    sentAt: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(notificationChannels)
      .set({
        verificationTokenHash: tokenHash,
        verificationExpiresAt: expiresAt,
        verificationSentAt: sentAt,
        verificationAttempts: 0,
        updatedAt: sentAt,
      })
      .where(and(eq(notificationChannels.userId, userId), eq(notificationChannels.id, id)))
      .returning({ id: notificationChannels.id });
    return rows.length === 1;
  }

  async verifyNotificationChannel(
    userId: string,
    id: string,
    tokenHash: string,
    at: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(notificationChannels)
      .set({
        verified: true,
        verifiedAt: at,
        verificationTokenHash: null,
        verificationExpiresAt: null,
        verificationAttempts: 0,
        updatedAt: at,
      })
      .where(
        and(
          eq(notificationChannels.userId, userId),
          eq(notificationChannels.id, id),
          eq(notificationChannels.verified, false),
          eq(notificationChannels.verificationTokenHash, tokenHash),
          gt(notificationChannels.verificationExpiresAt, at),
          lt(notificationChannels.verificationAttempts, 5),
        ),
      )
      .returning({ id: notificationChannels.id });
    return rows.length === 1;
  }

  async recordNotificationVerificationFailure(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .update(notificationChannels)
      .set({
        verificationAttempts: sql`${notificationChannels.verificationAttempts} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notificationChannels.userId, userId),
          eq(notificationChannels.id, id),
          eq(notificationChannels.verified, false),
          lt(notificationChannels.verificationAttempts, 10),
        ),
      )
      .returning({ id: notificationChannels.id });
    return rows.length === 1;
  }

  async deleteNotificationChannel(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(notificationChannels)
      .where(and(eq(notificationChannels.userId, userId), eq(notificationChannels.id, id)))
      .returning({ id: notificationChannels.id });
    return rows.length === 1;
  }

  async listWebhooks(userId: string): Promise<readonly WebhookEndpointRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.userId, userId))
      .orderBy(desc(webhookEndpoints.createdAt));
    return rows.map(webhook);
  }

  async getWebhook(userId: string, id: string): Promise<WebhookEndpointRecord | null> {
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.userId, userId), eq(webhookEndpoints.id, id)))
      .limit(1);
    return rows[0] === undefined ? null : webhook(rows[0]);
  }

  async createWebhook(
    input: Omit<WebhookEndpointRecord, 'createdAt' | 'updatedAt'>,
  ): Promise<WebhookEndpointRecord> {
    const rows = await this.db.insert(webhookEndpoints).values(input).returning();
    return webhook(required(rows[0], 'createWebhook'));
  }

  async updateWebhook(
    userId: string,
    id: string,
    updates: { url?: string; events?: unknown; enabled?: boolean },
  ): Promise<WebhookEndpointRecord | null> {
    const rows = await this.db
      .update(webhookEndpoints)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(webhookEndpoints.userId, userId), eq(webhookEndpoints.id, id)))
      .returning();
    return rows[0] === undefined ? null : webhook(rows[0]);
  }

  async deleteWebhook(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.userId, userId), eq(webhookEndpoints.id, id)))
      .returning({ id: webhookEndpoints.id });
    return rows.length === 1;
  }

  async rotateWebhookSecret(
    userId: string,
    id: string,
    expectedVersion: number,
    secretHash: string,
  ): Promise<WebhookEndpointRecord | null> {
    const rows = await this.db
      .update(webhookEndpoints)
      .set({
        secretHash,
        secretVersion: sql`${webhookEndpoints.secretVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(webhookEndpoints.userId, userId),
          eq(webhookEndpoints.id, id),
          eq(webhookEndpoints.secretVersion, expectedVersion),
        ),
      )
      .returning();
    return rows[0] === undefined ? null : webhook(rows[0]);
  }

  async createProjectClaim(
    input: Omit<ProjectClaimRecord, 'id' | 'createdAt'>,
  ): Promise<ProjectClaimRecord> {
    const rows = await this.db.insert(projectClaims).values(input).returning();
    const row = required(rows[0], 'createProjectClaim');
    return {
      id: row.id,
      projectProfileId: row.projectProfileId,
      claimerAddress: row.claimerAddress,
      claimType: row.claimType,
      evidence: row.evidence,
      status: row.status,
      createdAt: row.createdAt,
    };
  }

  async listProjectClaims(
    claimerAddresses: readonly string[],
  ): Promise<readonly ProjectClaimRecord[]> {
    if (claimerAddresses.length === 0) return [];
    const rows = await this.db
      .select()
      .from(projectClaims)
      .where(
        inArray(
          projectClaims.claimerAddress,
          claimerAddresses.map((address) => address.toLowerCase()),
        ),
      )
      .orderBy(desc(projectClaims.createdAt), desc(projectClaims.id));
    return rows.map((row) => ({
      id: row.id,
      projectProfileId: row.projectProfileId,
      claimerAddress: row.claimerAddress,
      claimType: row.claimType,
      evidence: row.evidence,
      status: row.status,
      createdAt: row.createdAt,
    }));
  }

  async hasApprovedProjectClaim(
    projectProfileId: string,
    claimerAddresses: readonly string[],
  ): Promise<boolean> {
    if (claimerAddresses.length === 0) return false;
    const rows = await this.db
      .select({ id: projectClaims.id })
      .from(projectClaims)
      .where(
        and(
          eq(projectClaims.projectProfileId, projectProfileId),
          inArray(
            projectClaims.claimerAddress,
            claimerAddresses.map((address) => address.toLowerCase()),
          ),
          eq(projectClaims.status, 'approved'),
        ),
      )
      .limit(1);
    return rows.length === 1;
  }

  async listProjectVersions(
    projectProfileId: string,
  ): Promise<readonly ProjectProfileVersionRecord[]> {
    const rows = await this.db
      .select()
      .from(projectProfileVersions)
      .where(eq(projectProfileVersions.projectProfileId, projectProfileId))
      .orderBy(desc(projectProfileVersions.versionNumber));
    return rows.map((row) => ({
      id: row.id,
      projectProfileId: row.projectProfileId,
      versionNumber: row.versionNumber,
      changes: row.changes,
      changedBy: row.changedBy,
      changedAt: row.changedAt,
    }));
  }

  async appendProjectVersion(
    projectProfileId: string,
    changes: unknown,
    changedBy: string,
  ): Promise<ProjectProfileVersionRecord> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${projectProfileId}))`);
      const latest = await transaction
        .select({ versionNumber: projectProfileVersions.versionNumber })
        .from(projectProfileVersions)
        .where(eq(projectProfileVersions.projectProfileId, projectProfileId))
        .orderBy(desc(projectProfileVersions.versionNumber))
        .limit(1);
      const rows = await transaction
        .insert(projectProfileVersions)
        .values({
          projectProfileId,
          versionNumber: (latest[0]?.versionNumber ?? 0) + 1,
          changes,
          changedBy,
        })
        .returning();
      const row = required(rows[0], 'appendProjectVersion');
      return {
        id: row.id,
        projectProfileId: row.projectProfileId,
        versionNumber: row.versionNumber,
        changes: row.changes,
        changedBy: row.changedBy,
        changedAt: row.changedAt,
      };
    });
  }

  async createReportAppeal(
    input: Omit<ReportAppealRecord, 'id' | 'submittedAt' | 'status'>,
  ): Promise<ReportAppealRecord> {
    return this.db.transaction(async (transaction) => {
      const reports = await transaction
        .update(communityReports)
        .set({ status: 'appealed' })
        .where(
          and(
            eq(communityReports.id, input.reportId),
            inArray(communityReports.status, ['upheld', 'rejected']),
          ),
        )
        .returning({ id: communityReports.id });
      if (reports.length !== 1) throw new Error('REPORT_NOT_APPEALABLE');
      const rows = await transaction.insert(reportAppeals).values(input).returning();
      const row = required(rows[0], 'createReportAppeal');
      return {
        id: row.id,
        reportId: row.reportId,
        appellantAddress: row.appellantAddress,
        appealReason: row.appealReason,
        status: row.status,
        submittedAt: row.submittedAt,
      };
    });
  }

  async listReportAppeals(reportId: string): Promise<readonly ReportAppealRecord[]> {
    const rows = await this.db
      .select()
      .from(reportAppeals)
      .where(eq(reportAppeals.reportId, reportId))
      .orderBy(desc(reportAppeals.submittedAt));
    return rows.map((row) => ({
      id: row.id,
      reportId: row.reportId,
      appellantAddress: row.appellantAddress,
      appealReason: row.appealReason,
      status: row.status,
      submittedAt: row.submittedAt,
    }));
  }

  async listReportResolutions(reportId: string): Promise<readonly ReportResolutionRecord[]> {
    const rows = await this.db
      .select()
      .from(reportResolutions)
      .where(eq(reportResolutions.reportId, reportId))
      .orderBy(desc(reportResolutions.resolvedAt));
    return rows.map((row) => ({
      id: row.id,
      reportId: row.reportId,
      resolutionType: row.resolutionType,
      resolutionNotes: row.resolutionNotes,
      resolvedBy: row.resolvedBy,
      resolvedAt: row.resolvedAt,
    }));
  }
}
