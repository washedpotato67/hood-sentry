import { createHash } from 'node:crypto';
import type {
  ProviderEvidenceRepository,
  RiskFinding,
  RiskRepository,
  RiskScanRun,
  RiskScore,
} from '@hood-sentry/db';
import {
  type OpenAiRiskCommentaryProvider,
  PROVIDER_REGISTRY_VERSION,
  RISK_COMMENTARY_PROMPT_VERSION,
  RiskCommentaryProviderError,
  riskCommentarySchema,
} from '@hood-sentry/providers';
import { AppError, NotFoundError } from '@hood-sentry/shared';
import { z } from 'zod';

const cachedCommentarySchema = z
  .object({
    commentary: riskCommentarySchema,
    providerResponseId: z.string().min(1),
    providerId: z.literal('openai'),
    model: z.string().min(1),
    promptVersion: z.literal(RISK_COMMENTARY_PROMPT_VERSION),
    fetchedAt: z.string().datetime(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    scan: z.object({
      id: z.string().uuid(),
      engineVersion: z.string().min(1),
      rulesetVersion: z.string().min(1),
      methodologyVersion: z.string().min(1),
      sourceBlock: z.string().regex(/^[0-9]+$/),
      sourceBlockHash: z.string().nullable(),
      status: z.enum(['completed', 'partial']),
    }),
    affectsRiskFindings: z.literal(false),
    affectsRiskScore: z.literal(false),
  })
  .strict();

export type CachedRiskCommentary = z.infer<typeof cachedCommentarySchema>;

type CommentaryConfiguration = {
  enabled: boolean;
  model: string;
  cacheSeconds: number;
};

type CommentaryRiskStore = Pick<
  RiskRepository,
  'getLatestScan' | 'getScoreByScan' | 'getFindingsByScan'
>;
type CommentaryEvidenceStore = Pick<ProviderEvidenceRepository, 'getFresh' | 'insert'>;
type CommentaryProvider = Pick<OpenAiRiskCommentaryProvider, 'generate'>;

function digest(value: string): string {
  return `0x${createHash('sha256').update(value).digest('hex')}`;
}

function activeFindings(findings: readonly RiskFinding[]): readonly RiskFinding[] {
  return findings.filter((finding) => !finding.suppressed);
}

function commentaryInput(
  scan: RiskScanRun,
  score: RiskScore | null,
  findings: readonly RiskFinding[],
) {
  if (scan.status !== 'completed' && scan.status !== 'partial') {
    throw new Error('Commentary requires a completed or partial scan');
  }
  return {
    scanId: scan.id,
    chainId: scan.chainId,
    targetAddress: scan.targetAddress,
    targetType: scan.targetType,
    engineVersion: scan.engineVersion,
    rulesetVersion: scan.rulesetVersion,
    methodologyVersion: scan.methodologyVersion,
    sourceBlock: scan.sourceBlock.toString(),
    sourceBlockHash: scan.sourceBlockHash,
    status: scan.status,
    score:
      score === null
        ? null
        : {
            value: score.score,
            grade: score.grade,
            completenessPercent: score.completenessPercent,
            unresolvedDataWarnings: score.unresolvedDataWarnings,
          },
    findings: activeFindings(findings).map((finding) => ({
      ruleId: finding.ruleId,
      ruleVersion: finding.ruleVersion,
      status: finding.status,
      category: finding.category,
      severity: finding.severity,
      confidence: finding.confidence,
      title: finding.title,
      explanation: finding.explanation,
      evidence: finding.evidence,
      remediation: finding.remediation,
    })),
  } as const;
}

export class RiskCommentaryService {
  constructor(
    private readonly risk: CommentaryRiskStore,
    private readonly evidence: CommentaryEvidenceStore,
    private readonly provider: CommentaryProvider | null,
    private readonly config: CommentaryConfiguration,
    private readonly now: () => Date = () => new Date(),
  ) {}

  status() {
    return {
      enabled: this.config.enabled && this.provider !== null,
      providerId: 'openai' as const,
      model: this.config.model,
      promptVersion: RISK_COMMENTARY_PROMPT_VERSION,
      role: 'commentary_only' as const,
    };
  }

  async get(chainId: number, targetAddress: string): Promise<CachedRiskCommentary> {
    if (!this.config.enabled || this.provider === null) {
      throw new AppError(
        'AI_COMMENTARY_DISABLED',
        'AI risk commentary is disabled until the provider key and feature flag are set.',
        503,
      );
    }
    const scan = await this.risk.getLatestScan(chainId, targetAddress.toLowerCase());
    if (scan === null || (scan.status !== 'completed' && scan.status !== 'partial')) {
      throw new NotFoundError('Completed risk scan', targetAddress);
    }
    const requestFingerprint = digest(
      JSON.stringify({
        scanId: scan.id,
        model: this.config.model,
        promptVersion: RISK_COMMENTARY_PROMPT_VERSION,
      }),
    );
    const cached = await this.evidence.getFresh(
      'openai',
      'aiCommentary',
      requestFingerprint,
      this.now(),
    );
    if (cached !== null) {
      const parsed = cachedCommentarySchema.safeParse(cached.responsePayload);
      if (parsed.success) return parsed.data;
    }

    const [score, findings] = await Promise.all([
      this.risk.getScoreByScan(scan.id),
      this.risk.getFindingsByScan(scan.id),
    ]);
    let generated: Awaited<ReturnType<CommentaryProvider['generate']>>;
    try {
      generated = await this.provider.generate(commentaryInput(scan, score, findings));
    } catch (error) {
      if (error instanceof RiskCommentaryProviderError) {
        throw new AppError('AI_COMMENTARY_UNAVAILABLE', error.message, 503);
      }
      throw new AppError(
        'AI_COMMENTARY_UNAVAILABLE',
        'The AI commentary provider is unavailable.',
        503,
      );
    }
    const payload: CachedRiskCommentary = {
      ...generated,
      scan: {
        id: scan.id,
        engineVersion: scan.engineVersion,
        rulesetVersion: scan.rulesetVersion,
        methodologyVersion: scan.methodologyVersion,
        sourceBlock: scan.sourceBlock.toString(),
        sourceBlockHash: scan.sourceBlockHash,
        status: scan.status,
      },
      affectsRiskFindings: false,
      affectsRiskScore: false,
    };
    const serialized = JSON.stringify(payload);
    await this.evidence.insert({
      providerId: 'openai',
      capability: 'aiCommentary',
      trustClass: 'commentary',
      chainId,
      requestFingerprint,
      responseHash: digest(serialized),
      responsePayload: payload,
      responseBytes: Buffer.byteLength(serialized, 'utf8'),
      httpStatus: 200,
      fetchedAt: new Date(generated.fetchedAt),
      expiresAt: new Date(this.now().getTime() + this.config.cacheSeconds * 1_000),
      sourceBlockNumber: scan.sourceBlock,
      sourceBlockHash: scan.sourceBlockHash,
      canonical: scan.canonical,
      registryVersion: PROVIDER_REGISTRY_VERSION,
    });
    return payload;
  }
}
