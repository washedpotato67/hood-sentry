import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const riskScanRunStatusEnum = pgEnum('risk_scan_run_status', [
  'pending',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
]);

export const riskFindingStatusEnum = pgEnum('risk_finding_status', [
  'pass',
  'warning',
  'fail',
  'unknown',
  'not_applicable',
]);

export const riskTargetTypeEnum = pgEnum('risk_target_type', [
  'token',
  'pool',
  'wallet',
  'project',
  'launchpad_token',
]);

export const riskRescanTriggerEnum = pgEnum('risk_rescan_trigger', [
  'new_token',
  'source_verification',
  'proxy_implementation_change',
  'ownership_change',
  'role_change',
  'mint',
  'supply_change',
  'pool_creation',
  'liquidity_removal',
  'holder_concentration_change',
  'launchpad_graduation',
  'launchpad_migration',
  'token_code_change',
  'manual_analyst_request',
  'methodology_version_change',
]);

export const riskRescanStatusEnum = pgEnum('risk_rescan_status', [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'orphaned',
]);

export const riskSeverityEnum = pgEnum('risk_severity', [
  'info',
  'low',
  'medium',
  'high',
  'critical',
]);

export const riskGradeEnum = pgEnum('risk_grade', ['A', 'B', 'C', 'D', 'F']);

export const maliciousLabelTypeEnum = pgEnum('malicious_label_type', [
  'scam',
  'phishing',
  'exploit',
  'sanctioned',
  'mixer',
  'ransomware',
  'darknet',
  'fraud',
  'other',
]);

export const riskScanRuns = pgTable(
  'risk_scan_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chainId: integer('chain_id').notNull(),
    targetType: riskTargetTypeEnum('target_type').notNull().default('token'),
    targetAddress: text('target_address').notNull(),
    engineVersion: text('engine_version').notNull(),
    rulesetVersion: text('ruleset_version').notNull(),
    methodologyVersion: text('methodology_version').notNull(),
    sourceBlock: bigint('source_block', { mode: 'bigint' }).notNull(),
    sourceBlockHash: text('source_block_hash'),
    triggerType: riskRescanTriggerEnum('trigger_type').notNull(),
    idempotencyKey: text('idempotency_key'),
    canonical: boolean('canonical').notNull().default(true),
    partial: boolean('partial').notNull().default(false),
    status: riskScanRunStatusEnum('status').notNull().default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: text('error_code'),
    cancellationRequestedAt: timestamp('cancellation_requested_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('risk_scan_runs_chain_target_idx').on(table.chainId, table.targetAddress),
    index('risk_scan_runs_status_idx').on(table.status),
    index('risk_scan_runs_source_block_idx').on(table.sourceBlock),
    index('risk_scan_runs_canonical_source_idx').on(
      table.chainId,
      table.canonical,
      table.sourceBlock,
    ),
    index('risk_scan_runs_idempotency_idx').on(table.idempotencyKey),
    index('risk_scan_runs_created_at_idx').on(table.createdAt),
  ],
);

export const riskFindings = pgTable(
  'risk_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scanRunId: uuid('scan_run_id')
      .notNull()
      .references(() => riskScanRuns.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull(),
    ruleVersion: text('rule_version').notNull(),
    status: riskFindingStatusEnum('status').notNull(),
    category: text('category').notNull(),
    severity: riskSeverityEnum('severity').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    confidenceDetail: jsonb('confidence_detail').notNull().default({}),
    title: text('title').notNull(),
    explanation: text('explanation').notNull(),
    evidence: jsonb('evidence').notNull(),
    remediation: text('remediation'),
    sourceProvenance: jsonb('source_provenance').notNull(),
    sourceBlock: bigint('source_block', { mode: 'bigint' }),
    sourceBlockHash: text('source_block_hash'),
    fingerprint: text('fingerprint').notNull(),
    suppressed: boolean('suppressed').notNull().default(false),
    suppressionReason: text('suppression_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('risk_findings_scan_run_idx').on(table.scanRunId),
    index('risk_findings_rule_idx').on(table.ruleId),
    index('risk_findings_severity_idx').on(table.severity),
    index('risk_findings_fingerprint_idx').on(table.fingerprint),
    index('risk_findings_category_idx').on(table.category),
    index('risk_findings_scan_fingerprint_idx').on(table.scanRunId, table.fingerprint),
  ],
);

export const riskScores = pgTable(
  'risk_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scanRunId: uuid('scan_run_id')
      .notNull()
      .references(() => riskScanRuns.id, { onDelete: 'cascade' }),
    score: numeric('score', { precision: 5, scale: 2 }).notNull(),
    grade: riskGradeEnum('grade').notNull(),
    categoryScores: jsonb('category_scores').notNull(),
    methodologyVersion: text('methodology_version').notNull(),
    completenessPercent: numeric('completeness_percent', { precision: 5, scale: 2 }).notNull(),
    unresolvedDataWarnings: jsonb('unresolved_data_warnings').notNull().default('[]'),
    completenessDetail: jsonb('completeness_detail').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('risk_scores_scan_run_idx').on(table.scanRunId),
    index('risk_scores_grade_idx').on(table.grade),
    index('risk_scores_one_per_scan_idx').on(table.scanRunId),
  ],
);

export const riskRuleVersions = pgTable(
  'risk_rule_versions',
  {
    ruleId: text('rule_id').notNull(),
    version: text('version').notNull(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    weight: numeric('weight', { precision: 5, scale: 2 }).notNull(),
    maxPenalty: numeric('max_penalty', { precision: 5, scale: 2 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.ruleId, table.version] }),
    index('risk_rule_versions_category_idx').on(table.category),
  ],
);

export const riskSuppressions = pgTable(
  'risk_suppressions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chainId: integer('chain_id').notNull(),
    targetAddress: text('target_address').notNull(),
    ruleId: text('rule_id'),
    ruleVersion: text('rule_version'),
    fingerprint: text('fingerprint'),
    reason: text('reason').notNull(),
    suppressedBy: text('suppressed_by').notNull(),
    suppressedAt: timestamp('suppressed_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
    revocationReason: text('revocation_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('risk_suppressions_chain_target_idx').on(table.chainId, table.targetAddress),
    index('risk_suppressions_rule_idx').on(table.ruleId),
    index('risk_suppressions_fingerprint_idx').on(table.fingerprint),
  ],
);

export const riskRulesetVersions = pgTable('risk_ruleset_versions', {
  version: text('version').primaryKey(),
  methodologyVersion: text('methodology_version').notNull(),
  engineVersion: text('engine_version').notNull(),
  ruleReferences: jsonb('rule_references').notNull(),
  categoryPenaltyCapsBps: jsonb('category_penalty_caps_bps').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const riskRescanRequests = pgTable(
  'risk_rescan_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chainId: integer('chain_id').notNull(),
    targetType: riskTargetTypeEnum('target_type').notNull(),
    targetAddress: text('target_address').notNull(),
    triggerType: riskRescanTriggerEnum('trigger_type').notNull(),
    sourceBlock: bigint('source_block', { mode: 'bigint' }).notNull(),
    sourceBlockHash: text('source_block_hash').notNull(),
    rulesetVersion: text('ruleset_version').notNull(),
    methodologyVersion: text('methodology_version').notNull(),
    eventId: text('event_id').notNull(),
    requestedBy: text('requested_by').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: riskRescanStatusEnum('status').notNull().default('queued'),
    scanRunId: uuid('scan_run_id').references(() => riskScanRuns.id),
    canonical: boolean('canonical').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('risk_rescan_requests_target_idx').on(
      table.chainId,
      table.targetAddress,
      table.createdAt,
    ),
    index('risk_rescan_requests_status_idx').on(table.status, table.createdAt),
    index('risk_rescan_requests_source_idx').on(table.chainId, table.canonical, table.sourceBlock),
  ],
);

export const maliciousAddressLabels = pgTable(
  'malicious_address_labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chainId: integer('chain_id').notNull(),
    address: text('address').notNull(),
    labelType: maliciousLabelTypeEnum('label_type').notNull(),
    labelSource: text('label_source').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    evidence: jsonb('evidence').notNull(),
    labeledAt: timestamp('labeled_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('malicious_address_labels_chain_address_idx').on(table.chainId, table.address),
    index('malicious_address_labels_type_idx').on(table.labelType),
    index('malicious_address_labels_source_idx').on(table.labelSource),
  ],
);
