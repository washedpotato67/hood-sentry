export type WatchlistRecord = {
  id: string;
  userId: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type WatchlistItemRecord = {
  id: string;
  watchlistId: string;
  chainId: number;
  targetAddress: string;
  targetType: 'token' | 'wallet' | 'contract' | 'project';
  notes: string | null;
  addedAt: Date;
};

export type NotificationChannelRecord = {
  id: string;
  userId: string;
  channelType: 'email' | 'telegram' | 'webhook' | 'push';
  channelConfig: unknown;
  verified: boolean;
  verifiedAt: Date | null;
  verificationTokenHash: string | null;
  verificationExpiresAt: Date | null;
  verificationSentAt: Date | null;
  verificationAttempts: number;
  createdAt: Date;
  updatedAt: Date;
};

export type WebhookEndpointRecord = {
  id: string;
  userId: string;
  url: string;
  secretHash: string;
  secretVersion: number;
  events: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectClaimRecord = {
  id: string;
  projectProfileId: string;
  claimerAddress: string;
  claimType: 'ownership' | 'maintainer' | 'contributor';
  evidence: unknown;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
};

export type ProjectProfileVersionRecord = {
  id: string;
  projectProfileId: string;
  versionNumber: number;
  changes: unknown;
  changedBy: string;
  changedAt: Date;
};

export type ReportAppealRecord = {
  id: string;
  reportId: string;
  appellantAddress: string;
  appealReason: string;
  status: 'pending' | 'accepted' | 'rejected';
  submittedAt: Date;
};

export type ReportResolutionRecord = {
  id: string;
  reportId: string;
  resolutionType: 'upheld' | 'rejected' | 'dismissed' | 'escalated';
  resolutionNotes: string | null;
  resolvedBy: string;
  resolvedAt: Date;
};

export interface ProductRepository {
  listWatchlists(userId: string): Promise<readonly WatchlistRecord[]>;
  getWatchlist(userId: string, id: string): Promise<WatchlistRecord | null>;
  createWatchlist(userId: string, name: string, isDefault: boolean): Promise<WatchlistRecord>;
  updateWatchlist(
    userId: string,
    id: string,
    updates: { name?: string; isDefault?: boolean },
  ): Promise<WatchlistRecord | null>;
  deleteWatchlist(userId: string, id: string): Promise<boolean>;
  listWatchlistItems(userId: string, watchlistId: string): Promise<readonly WatchlistItemRecord[]>;
  addWatchlistItem(
    userId: string,
    input: Omit<WatchlistItemRecord, 'id' | 'addedAt'>,
  ): Promise<WatchlistItemRecord>;
  deleteWatchlistItem(userId: string, watchlistId: string, itemId: string): Promise<boolean>;
  listNotificationChannels(userId: string): Promise<readonly NotificationChannelRecord[]>;
  getNotificationChannel(userId: string, id: string): Promise<NotificationChannelRecord | null>;
  createNotificationChannel(
    input: Omit<NotificationChannelRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<NotificationChannelRecord>;
  setNotificationChallenge(
    userId: string,
    id: string,
    tokenHash: string,
    expiresAt: Date,
    sentAt: Date,
  ): Promise<boolean>;
  verifyNotificationChannel(
    userId: string,
    id: string,
    tokenHash: string,
    at: Date,
  ): Promise<boolean>;
  recordNotificationVerificationFailure(userId: string, id: string): Promise<boolean>;
  deleteNotificationChannel(userId: string, id: string): Promise<boolean>;
  listWebhooks(userId: string): Promise<readonly WebhookEndpointRecord[]>;
  getWebhook(userId: string, id: string): Promise<WebhookEndpointRecord | null>;
  createWebhook(
    input: Omit<WebhookEndpointRecord, 'createdAt' | 'updatedAt'>,
  ): Promise<WebhookEndpointRecord>;
  updateWebhook(
    userId: string,
    id: string,
    updates: { url?: string; events?: unknown; enabled?: boolean },
  ): Promise<WebhookEndpointRecord | null>;
  rotateWebhookSecret(
    userId: string,
    id: string,
    expectedVersion: number,
    secretHash: string,
  ): Promise<WebhookEndpointRecord | null>;
  deleteWebhook(userId: string, id: string): Promise<boolean>;
  createProjectClaim(
    input: Omit<ProjectClaimRecord, 'id' | 'createdAt'>,
  ): Promise<ProjectClaimRecord>;
  listProjectClaims(claimerAddresses: readonly string[]): Promise<readonly ProjectClaimRecord[]>;
  hasApprovedProjectClaim(
    projectProfileId: string,
    claimerAddresses: readonly string[],
  ): Promise<boolean>;
  listProjectVersions(projectProfileId: string): Promise<readonly ProjectProfileVersionRecord[]>;
  appendProjectVersion(
    projectProfileId: string,
    changes: unknown,
    changedBy: string,
  ): Promise<ProjectProfileVersionRecord>;
  createReportAppeal(
    input: Omit<ReportAppealRecord, 'id' | 'submittedAt' | 'status'>,
  ): Promise<ReportAppealRecord>;
  listReportAppeals(reportId: string): Promise<readonly ReportAppealRecord[]>;
  listReportResolutions(reportId: string): Promise<readonly ReportResolutionRecord[]>;
}
