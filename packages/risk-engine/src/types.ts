import { z } from 'zod';

export const riskFindingSchema = z.object({
  ruleId: z.string(),
  ruleVersion: z.string(),
  status: z.enum(['pass', 'warn', 'fail', 'unknown']),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  title: z.string(),
  explanation: z.string(),
  evidence: z.array(z.record(z.unknown())),
  remediation: z.string().optional(),
  sourceBlock: z.bigint(),
});

export type RiskFinding = z.infer<typeof riskFindingSchema>;

export const riskScoreSchema = z.object({
  score: z.number().min(0).max(100),
  grade: z.enum(['A', 'B', 'C', 'D', 'F']),
  categoryScores: z.record(z.number()),
  methodologyVersion: z.string(),
  completenessPercent: z.number().min(0).max(100),
  warnings: z.array(z.string()),
});

export type RiskScore = z.infer<typeof riskScoreSchema>;
