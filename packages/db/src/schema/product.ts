import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const targetTypeEnum = pgEnum('target_type', ['token', 'wallet', 'contract', 'project']);
export const alertRuleTypeEnum = pgEnum('alert_rule_type', [
  'price_change',
  'volume_spike',
  'large_transfer',
  'contract_event',
  'risk_score_change',
  'governance_proposal',
]);
export const severityEnum = pgEnum('severity', ['low', 'medium', 'high', 'critical']);
export const channelTypeEnum = pgEnum('channel_type', ['email', 'telegram', 'webhook', 'push']);
export const deliveryStatusEnum = pgEnum('delivery_status', [
  'pending',
  'sent',
  'failed',
  'delivered',
]);
export const contractTypeEnum = pgEnum('contract_type', [
  'token',
  'staking',
  'governance',
  'treasury',
  'bond',
  'vesting',
  'factory',
  'router',
]);
export const claimTypeEnum = pgEnum('claim_type', ['ownership', 'maintainer', 'contributor']);
export const claimStatusEnum = pgEnum('claim_status', ['pending', 'approved', 'rejected']);
export const reportTypeEnum = pgEnum('report_type', [
  'scam',
  'rug_pull',
  'honeypot',
  'exploit',
  'phishing',
  'impersonation',
  'other',
]);
export const reportStatusEnum = pgEnum('report_status', [
  'submitted',
  'under_review',
  'upheld',
  'rejected',
  'appealed',
]);
export const evidenceTypeEnum = pgEnum('evidence_type', [
  'screenshot',
  'transaction_hash',
  'contract_code',
  'chat_log',
  'url',
  'document',
]);
export const resolutionTypeEnum = pgEnum('resolution_type', [
  'upheld',
  'rejected',
  'dismissed',
  'escalated',
]);
export const appealStatusEnum = pgEnum('appeal_status', ['pending', 'accepted', 'rejected']);
export const intentTypeEnum = pgEnum('intent_type', [
  'transfer',
  'approve',
  'swap',
  'stake',
  'unstake',
  'claim',
  'vote',
  'custom',
]);
export const txStatusEnum = pgEnum('tx_status', [
  'draft',
  'simulated',
  'signed',
  'broadcast',
  'confirmed',
  'failed',
]);
export const adminRoleEnum = pgEnum('admin_role', [
  'super_admin',
  'moderator',
  'reviewer',
  'analyst',
]);
export const adminActionTypeEnum = pgEnum('admin_action_type', [
  'create',
  'update',
  'delete',
  'approve',
  'reject',
  'ban',
  'unban',
  'verify',
  'revoke',
]);
export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'pending',
  'sent',
  'failed',
  'delivered',
]);

export const watchlists = pgTable(
  'watchlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index('watchlists_user_id_idx').on(table.userId),
    userDefaultIdx: index('watchlists_user_default_idx').on(table.userId, table.isDefault),
  }),
);

export const watchlistItems = pgTable(
  'watchlist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    watchlistId: uuid('watchlist_id')
      .notNull()
      .references(() => watchlists.id, { onDelete: 'cascade' }),
    chainId: integer('chain_id').notNull(),
    targetAddress: varchar('target_address', { length: 42 }).notNull(),
    targetType: targetTypeEnum('target_type').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
  },
  (table) => ({
    watchlistIdx: index('watchlist_items_watchlist_id_idx').on(table.watchlistId),
    chainAddressIdx: index('watchlist_items_chain_address_idx').on(
      table.chainId,
      table.targetAddress,
    ),
  }),
);

export const alertRules = pgTable(
  'alert_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    chainId: integer('chain_id').notNull(),
    targetAddress: varchar('target_address', { length: 42 }).notNull(),
    ruleType: alertRuleTypeEnum('rule_type').notNull(),
    condition: jsonb('condition').notNull(),
    channels: jsonb('channels').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index('alert_rules_user_id_idx').on(table.userId),
    chainTargetIdx: index('alert_rules_chain_target_idx').on(table.chainId, table.targetAddress),
    enabledIdx: index('alert_rules_enabled_idx').on(table.enabled),
  }),
);

export const alertEvents = pgTable(
  'alert_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alertRuleId: uuid('alert_rule_id')
      .notNull()
      .references(() => alertRules.id, { onDelete: 'cascade' }),
    chainId: integer('chain_id').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    blockHash: text('block_hash'),
    transactionHash: varchar('transaction_hash', { length: 66 }),
    logIndex: integer('log_index'),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
    severity: severityEnum('severity').notNull(),
    metadata: jsonb('metadata').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => ({
    alertRuleIdx: index('alert_events_alert_rule_id_idx').on(table.alertRuleId),
    chainBlockIdx: index('alert_events_chain_block_idx').on(table.chainId, table.blockNumber),
    triggeredIdx: index('alert_events_triggered_at_idx').on(table.triggeredAt),
    severityIdx: index('alert_events_severity_idx').on(table.severity),
  }),
);

export const notificationChannels = pgTable(
  'notification_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    channelType: channelTypeEnum('channel_type').notNull(),
    channelConfig: jsonb('channel_config').notNull(),
    verified: boolean('verified').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationTokenHash: text('verification_token_hash'),
    verificationExpiresAt: timestamp('verification_expires_at', { withTimezone: true }),
    verificationSentAt: timestamp('verification_sent_at', { withTimezone: true }),
    verificationAttempts: integer('verification_attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('notification_channels_user_id_idx').on(table.userId),
    typeIdx: index('notification_channels_type_idx').on(table.channelType),
  }),
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationChannelId: uuid('notification_channel_id')
      .notNull()
      .references(() => notificationChannels.id, { onDelete: 'cascade' }),
    alertEventId: uuid('alert_event_id')
      .notNull()
      .references(() => alertEvents.id, { onDelete: 'cascade' }),
    status: deliveryStatusEnum('status').notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),
    providerMessageId: text('provider_message_id'),
    responseStatus: integer('response_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    channelIdx: index('notification_deliveries_channel_idx').on(table.notificationChannelId),
    eventIdx: index('notification_deliveries_event_idx').on(table.alertEventId),
    statusIdx: index('notification_deliveries_status_idx').on(table.status),
  }),
);

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    url: text('url').notNull(),
    secretHash: varchar('secret_hash', { length: 255 }).notNull(),
    secretVersion: integer('secret_version').notNull().default(1),
    events: jsonb('events').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('webhook_endpoints_user_id_idx').on(table.userId),
    enabledIdx: index('webhook_endpoints_enabled_idx').on(table.enabled),
  }),
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    webhookEndpointId: uuid('webhook_endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: jsonb('payload').notNull(),
    status: webhookDeliveryStatusEnum('status').notNull().default('pending'),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    endpointIdx: index('webhook_deliveries_endpoint_idx').on(table.webhookEndpointId),
    statusIdx: index('webhook_deliveries_status_idx').on(table.status),
    eventTypeIdx: index('webhook_deliveries_event_type_idx').on(table.eventType),
  }),
);

export const projectProfiles = pgTable(
  'project_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chainId: integer('chain_id').notNull(),
    projectName: varchar('project_name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    description: text('description'),
    websiteUrl: text('website_url'),
    logoUri: text('logo_uri'),
    verified: boolean('verified').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    slugIdx: uniqueIndex('project_profiles_slug_idx').on(table.slug),
    chainIdx: index('project_profiles_chain_id_idx').on(table.chainId),
    verifiedIdx: index('project_profiles_verified_idx').on(table.verified),
  }),
);

export const projectProfileVersions = pgTable(
  'project_profile_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectProfileId: uuid('project_profile_id')
      .notNull()
      .references(() => projectProfiles.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    changes: jsonb('changes').notNull(),
    changedBy: uuid('changed_by').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    profileIdx: index('project_profile_versions_profile_idx').on(table.projectProfileId),
    versionIdx: index('project_profile_versions_version_idx').on(
      table.projectProfileId,
      table.versionNumber,
    ),
  }),
);

export const projectContracts = pgTable(
  'project_contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectProfileId: uuid('project_profile_id')
      .notNull()
      .references(() => projectProfiles.id, { onDelete: 'cascade' }),
    chainId: integer('chain_id').notNull(),
    contractAddress: varchar('contract_address', { length: 42 }).notNull(),
    contractType: contractTypeEnum('contract_type').notNull(),
    verified: boolean('verified').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    profileIdx: index('project_contracts_profile_idx').on(table.projectProfileId),
    chainAddressIdx: index('project_contracts_chain_address_idx').on(
      table.chainId,
      table.contractAddress,
    ),
  }),
);

export const projectClaims = pgTable(
  'project_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectProfileId: uuid('project_profile_id')
      .notNull()
      .references(() => projectProfiles.id, { onDelete: 'cascade' }),
    claimerAddress: varchar('claimer_address', { length: 42 }).notNull(),
    claimType: claimTypeEnum('claim_type').notNull(),
    evidence: jsonb('evidence').notNull(),
    status: claimStatusEnum('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    profileIdx: index('project_claims_profile_idx').on(table.projectProfileId),
    claimerIdx: index('project_claims_claimer_idx').on(table.claimerAddress),
    statusIdx: index('project_claims_status_idx').on(table.status),
  }),
);

export const communityReports = pgTable(
  'community_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chainId: integer('chain_id').notNull(),
    targetAddress: varchar('target_address', { length: 42 }).notNull(),
    targetType: targetTypeEnum('target_type').notNull(),
    reporterAddress: varchar('reporter_address', { length: 42 }).notNull(),
    reportType: reportTypeEnum('report_type').notNull(),
    severity: severityEnum('severity').notNull(),
    description: text('description').notNull(),
    evidenceUrls: jsonb('evidence_urls').notNull(),
    status: reportStatusEnum('status').notNull().default('submitted'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => ({
    chainTargetIdx: index('community_reports_chain_target_idx').on(
      table.chainId,
      table.targetAddress,
    ),
    reporterIdx: index('community_reports_reporter_idx').on(table.reporterAddress),
    statusIdx: index('community_reports_status_idx').on(table.status),
    submittedIdx: index('community_reports_submitted_at_idx').on(table.submittedAt),
  }),
);

export const reportEvidence = pgTable(
  'report_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => communityReports.id, { onDelete: 'cascade' }),
    evidenceType: evidenceTypeEnum('evidence_type').notNull(),
    evidenceData: jsonb('evidence_data').notNull(),
    submittedBy: varchar('submitted_by', { length: 42 }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reportIdx: index('report_evidence_report_idx').on(table.reportId),
    typeIdx: index('report_evidence_type_idx').on(table.evidenceType),
  }),
);

export const reportResolutions = pgTable(
  'report_resolutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => communityReports.id, { onDelete: 'cascade' }),
    resolutionType: resolutionTypeEnum('resolution_type').notNull(),
    resolutionNotes: text('resolution_notes'),
    resolvedBy: uuid('resolved_by').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reportIdx: index('report_resolutions_report_idx').on(table.reportId),
    typeIdx: index('report_resolutions_type_idx').on(table.resolutionType),
  }),
);

export const reportAppeals = pgTable(
  'report_appeals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => communityReports.id, { onDelete: 'cascade' }),
    appellantAddress: varchar('appellant_address', { length: 42 }).notNull(),
    appealReason: text('appeal_reason').notNull(),
    status: appealStatusEnum('status').notNull().default('pending'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by'),
    reviewNotes: text('review_notes'),
  },
  (table) => ({
    reportIdx: index('report_appeals_report_idx').on(table.reportId),
    appellantIdx: index('report_appeals_appellant_idx').on(table.appellantAddress),
    statusIdx: index('report_appeals_status_idx').on(table.status),
  }),
);

export const transactionIntents = pgTable(
  'transaction_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    intentHash: text('intent_hash'),
    userId: uuid('user_id').notNull(),
    chainId: integer('chain_id').notNull(),
    walletAddress: varchar('wallet_address', { length: 42 }),
    intentType: intentTypeEnum('intent_type').notNull(),
    targetAddress: varchar('target_address', { length: 42 }).notNull(),
    functionSelector: varchar('function_selector', { length: 10 }),
    functionName: text('function_name'),
    decodedArguments: jsonb('decoded_arguments'),
    calldata: text('calldata'),
    valueRaw: numeric('value_raw', { precision: 78, scale: 0 }),
    tokenAmounts: jsonb('token_amounts'),
    spenderAddress: varchar('spender_address', { length: 42 }),
    approvalAmountRaw: numeric('approval_amount_raw', { precision: 78, scale: 0 }),
    expectedResult: text('expected_result'),
    deadline: timestamp('deadline', { withTimezone: true }),
    simulationResult: jsonb('simulation_result'),
    warnings: jsonb('warnings'),
    featureFlag: text('feature_flag'),
    configurationVersion: text('configuration_version'),
    quoteId: text('quote_id'),
    status: txStatusEnum('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    txHash: varchar('tx_hash', { length: 66 }),
  },
  (table) => ({
    userIdIdx: index('transaction_intents_user_id_idx').on(table.userId),
    intentHashIdx: uniqueIndex('transaction_intents_intent_hash_idx').on(table.intentHash),
    walletIdx: index('transaction_intents_wallet_idx').on(
      table.chainId,
      table.walletAddress,
      table.createdAt,
    ),
    chainTargetIdx: index('transaction_intents_chain_target_idx').on(
      table.chainId,
      table.targetAddress,
    ),
    statusIdx: index('transaction_intents_status_idx').on(table.status),
    createdIdx: index('transaction_intents_created_at_idx').on(table.createdAt),
  }),
);

export const transactionIntentEvents = pgTable(
  'transaction_intent_events',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    transactionIntentId: uuid('transaction_intent_id')
      .notNull()
      .references(() => transactionIntents.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    intentIdx: index('transaction_intent_events_intent_idx').on(
      table.transactionIntentId,
      table.createdAt,
    ),
  }),
);

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flagName: varchar('flag_name', { length: 255 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    reason: text('reason'),
    updatedBy: uuid('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    flagNameIdx: uniqueIndex('feature_flags_flag_name_idx').on(table.flagName),
  }),
);

export const adminRoles = pgTable(
  'admin_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    roleName: adminRoleEnum('role_name').notNull(),
    grantedBy: uuid('granted_by').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index('admin_roles_user_id_idx').on(table.userId),
    roleIdx: index('admin_roles_role_idx').on(table.roleName),
  }),
);

export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id').notNull(),
    actionType: adminActionTypeEnum('action_type').notNull(),
    targetType: varchar('target_type', { length: 100 }).notNull(),
    targetId: uuid('target_id').notNull(),
    changes: jsonb('changes'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    adminIdx: index('admin_audit_logs_admin_idx').on(table.adminUserId),
    actionIdx: index('admin_audit_logs_action_idx').on(table.actionType),
    targetIdx: index('admin_audit_logs_target_idx').on(table.targetType, table.targetId),
    performedIdx: index('admin_audit_logs_performed_at_idx').on(table.performedAt),
  }),
);
