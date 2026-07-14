import { getAddress, isAddress } from 'viem';
import { z } from 'zod';

const evmAddressSchema = z
  .string()
  .refine(isAddress, 'Risk target address is malformed')
  .transform((address) => getAddress(address));
const blockHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const versionSchema = z.string().trim().min(1).max(128);

export const riskFindingStatusSchema = z.enum([
  'pass',
  'warning',
  'fail',
  'unknown',
  'not_applicable',
]);
export type RiskFindingStatus = z.infer<typeof riskFindingStatusSchema>;

export const riskSeveritySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export type RiskSeverity = z.infer<typeof riskSeveritySchema>;

export const riskConfidenceSchema = z.object({
  level: z.enum(['unknown', 'low', 'medium', 'high', 'confirmed']),
  basisPoints: z.number().int().min(0).max(10_000),
  rationale: z.string().trim().min(1),
});
export type RiskConfidence = z.infer<typeof riskConfidenceSchema>;

export const RISK_CATEGORIES = [
  'Contract control',
  'Transfer behavior',
  'Supply',
  'Upgradeability',
  'Liquidity',
  'Holder distribution',
  'Deployer history',
  'Identity and impersonation',
  'Market integrity',
  'Oracle behavior',
  'Metadata quality',
  'Launchpad behavior',
] as const;
export const riskCategorySchema = z.enum(RISK_CATEGORIES);
export type RiskCategory = z.infer<typeof riskCategorySchema>;

export const riskMethodologyVersionSchema = versionSchema;
export type RiskMethodologyVersion = z.infer<typeof riskMethodologyVersionSchema>;

export const riskTargetSchema = z.object({
  type: z.enum(['token', 'pool', 'wallet', 'project', 'launchpad_token']),
  chainId: z.number().int().positive(),
  address: evmAddressSchema,
});
export type RiskTarget = z.infer<typeof riskTargetSchema>;

export const riskDataSourceSchema = z.object({
  key: z.string().trim().min(1),
  kind: z.enum([
    'chain',
    'database',
    'explorer',
    'simulation',
    'protocol',
    'external_provider',
    'analyst',
  ]),
  provider: z.string().trim().min(1),
  status: z.enum(['available', 'unavailable', 'stale', 'error']),
  sourceBlock: z.bigint().nonnegative(),
  sourceBlockHash: blockHashSchema,
  fetchedAt: z.string().datetime().nullable(),
  reason: z.string().trim().min(1).nullable(),
});
export type RiskDataSource = z.infer<typeof riskDataSourceSchema>;

export const riskScanContextSchema = z.object({
  target: riskTargetSchema,
  sourceBlock: z.bigint().nonnegative(),
  sourceBlockHash: blockHashSchema,
  methodologyVersion: riskMethodologyVersionSchema,
  data: z.record(z.unknown()),
  dataSources: z.array(riskDataSourceSchema),
});
export type RiskScanContext = z.infer<typeof riskScanContextSchema>;

export const riskEvidenceSchema = z.object({
  evidenceType: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  data: z.record(z.unknown()),
  provenanceKeys: z.array(z.string().trim().min(1)),
});
export type RiskEvidence = z.infer<typeof riskEvidenceSchema>;

export const riskRuleEvaluationSchema = z.object({
  status: riskFindingStatusSchema,
  severity: riskSeveritySchema,
  confidence: riskConfidenceSchema,
  title: z.string().trim().min(1),
  explanation: z.string().trim().min(1),
  evidence: z.array(riskEvidenceSchema),
  remediation: z.string().trim().min(1).nullable(),
  fingerprintSeed: z.string().trim().min(1),
});
export type RiskRuleEvaluation = z.infer<typeof riskRuleEvaluationSchema>;

export interface RiskRule {
  readonly ruleId: string;
  readonly version: string;
  readonly category: RiskCategory;
  readonly title: string;
  readonly description: string;
  readonly requiredDataSources: readonly string[];
  readonly maxPenaltyBps: number;
  evaluate(context: Readonly<RiskScanContext>, signal: AbortSignal): Promise<RiskRuleEvaluation>;
}

export const riskRuleReferenceSchema = z.object({
  ruleId: z.string().trim().min(1),
  version: versionSchema,
});
export type RiskRuleReference = z.infer<typeof riskRuleReferenceSchema>;

export const riskRulesetSchema = z.object({
  version: versionSchema,
  methodologyVersion: riskMethodologyVersionSchema,
  rules: z.array(riskRuleReferenceSchema).min(1),
  categoryPenaltyCapsBps: z.record(riskCategorySchema, z.number().int().min(0).max(10_000)),
});
export type RiskRuleset = z.infer<typeof riskRulesetSchema>;

export const riskFindingSchema = z.object({
  ruleId: z.string().trim().min(1),
  ruleVersion: versionSchema,
  status: riskFindingStatusSchema,
  category: riskCategorySchema,
  severity: riskSeveritySchema,
  confidence: riskConfidenceSchema,
  title: z.string().trim().min(1),
  explanation: z.string().trim().min(1),
  evidence: z.array(riskEvidenceSchema),
  sourceBlock: z.bigint().nonnegative(),
  sourceBlockHash: blockHashSchema,
  dataProvenance: z.array(riskDataSourceSchema),
  remediation: z.string().trim().min(1).nullable(),
  fingerprint: z.string().regex(/^0x[0-9a-f]{64}$/),
  suppressed: z.boolean(),
  suppressionReason: z.string().trim().min(1).nullable(),
});
export type RiskFinding = z.infer<typeof riskFindingSchema>;

export const riskCompletenessSchema = z.object({
  basisPoints: z.number().int().min(0).max(10_000),
  status: z.enum(['complete', 'partial', 'insufficient']),
  totalRules: z.number().int().nonnegative(),
  evaluatedRules: z.number().int().nonnegative(),
  unknownRules: z.number().int().nonnegative(),
  failedRules: z.number().int().nonnegative(),
  unavailableDataSources: z.array(z.string()),
  reasons: z.array(z.string()),
});
export type RiskCompleteness = z.infer<typeof riskCompletenessSchema>;

export const riskScoreSchema = z.object({
  scoreBps: z.number().int().min(0).max(10_000),
  grade: z.enum(['A', 'B', 'C', 'D', 'F']),
  categoryScoresBps: z.record(riskCategorySchema, z.number().int().min(0).max(10_000)),
  methodologyVersion: riskMethodologyVersionSchema,
  completeness: riskCompletenessSchema,
  warnings: z.array(z.string()),
});
export type RiskScore = z.infer<typeof riskScoreSchema>;

export const riskScanResultSchema = z.object({
  target: riskTargetSchema,
  engineVersion: versionSchema,
  rulesetVersion: versionSchema,
  methodologyVersion: riskMethodologyVersionSchema,
  sourceBlock: z.bigint().nonnegative(),
  sourceBlockHash: blockHashSchema,
  status: z.enum(['completed', 'partial', 'cancelled']),
  findings: z.array(riskFindingSchema),
  score: riskScoreSchema,
  completeness: riskCompletenessSchema,
  failureCodes: z.array(z.string()),
});
export type RiskScanResult = z.infer<typeof riskScanResultSchema>;

export const riskSuppressionSchema = z
  .object({
    ruleId: z.string().trim().min(1).nullable(),
    ruleVersion: versionSchema.nullable(),
    fingerprint: z
      .string()
      .regex(/^0x[0-9a-f]{64}$/)
      .nullable(),
    reason: z.string().trim().min(1),
  })
  .refine((value) => value.fingerprint !== null || value.ruleId !== null, {
    message: 'A suppression requires a fingerprint or rule ID',
  });
export type RiskSuppression = z.infer<typeof riskSuppressionSchema>;

export const riskRescanTriggerSchema = z.enum([
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
export type RiskRescanTrigger = z.infer<typeof riskRescanTriggerSchema>;

export const riskRescanRequestSchema = z.object({
  target: riskTargetSchema,
  trigger: riskRescanTriggerSchema,
  sourceBlock: z.bigint().nonnegative(),
  sourceBlockHash: blockHashSchema,
  rulesetVersion: versionSchema,
  methodologyVersion: riskMethodologyVersionSchema,
  eventId: z.string().trim().min(1),
  requestedBy: z.string().trim().min(1),
});
export type RiskRescanRequest = z.infer<typeof riskRescanRequestSchema>;

export interface RiskScanOptions {
  readonly scanTimeoutMs: number;
  readonly perRuleTimeoutMs: number;
  readonly signal?: AbortSignal;
  readonly suppressions?: readonly RiskSuppression[];
}
