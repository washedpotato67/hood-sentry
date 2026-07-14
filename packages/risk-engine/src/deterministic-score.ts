export type RiskScoreCategory =
  | 'contractControl'
  | 'transferBehavior'
  | 'liquidity'
  | 'supplyHolders'
  | 'deployerHistory'
  | 'identity'
  | 'dataCompleteness';
export type ScoreFinding = {
  id: string;
  category: RiskScoreCategory;
  penalty: bigint;
  confidence: 'high' | 'medium' | 'low';
  cap?: bigint;
  explanation: string;
};
export type DeterministicRiskScore = {
  methodologyVersion: string;
  categoryScores: Readonly<Record<RiskScoreCategory, bigint>>;
  total: bigint | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | 'U';
  confidence: string;
  completenessBps: bigint;
  findingCount: number;
  caps: readonly string[];
  changes: readonly string[];
};
const weights: Record<RiskScoreCategory, bigint> = {
  contractControl: 25n,
  transferBehavior: 20n,
  liquidity: 20n,
  supplyHolders: 15n,
  deployerHistory: 10n,
  identity: 5n,
  dataCompleteness: 5n,
};
export function scoreRisk(
  findings: readonly ScoreFinding[],
  completenessBps: bigint,
  methodologyVersion: string,
  previous?: DeterministicRiskScore,
): DeterministicRiskScore {
  const grouped = new Map<RiskScoreCategory, ScoreFinding[]>();
  for (const finding of [...findings].sort((a, b) => a.id.localeCompare(b.id)))
    grouped.set(finding.category, [...(grouped.get(finding.category) ?? []), finding]);
  const categoryScores = Object.fromEntries(
    Object.keys(weights).map((category) => {
      const key = category as RiskScoreCategory;
      const penalty = (grouped.get(key) ?? []).reduce((sum, f) => sum + f.penalty, 0n);
      return [key, penalty > weights[key] ? 0n : weights[key] - penalty];
    }),
  ) as Record<RiskScoreCategory, bigint>;
  const caps: string[] = [];
  let total = Object.values(categoryScores).reduce((a, b) => a + b, 0n);
  for (const finding of findings)
    if (finding.cap !== undefined && total > finding.cap) {
      total = finding.cap;
      caps.push(finding.id);
    }
  const complete = completenessBps >= 10_000n;
  const grade = !complete
    ? 'U'
    : total >= 85n
      ? 'A'
      : total >= 70n
        ? 'B'
        : total >= 50n
          ? 'C'
          : total >= 30n
            ? 'D'
            : 'F';
  const changes = previous
    ? Object.keys(weights)
        .filter(
          (key) =>
            categoryScores[key as RiskScoreCategory] !==
            previous.categoryScores[key as RiskScoreCategory],
        )
        .map((key) => `${key} changed`)
    : [];
  return {
    methodologyVersion,
    categoryScores,
    total: complete ? total : null,
    grade,
    confidence: completenessBps >= 9000n ? 'high' : completenessBps >= 6000n ? 'medium' : 'low',
    completenessBps,
    findingCount: findings.length,
    caps,
    changes,
  };
}
