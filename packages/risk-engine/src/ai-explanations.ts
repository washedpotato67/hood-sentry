export type DeterministicFinding = {
  id: string;
  title: string;
  severity: string;
  confidence: string;
  evidence: readonly string[];
};
export type AiProvider = {
  generate(input: { prompt: string; findings: readonly DeterministicFinding[] }): Promise<unknown>;
};
export type AiExplanation = {
  summary: string;
  citations: readonly string[];
  groups: readonly { title: string; findingIds: readonly string[] }[];
};
export async function explainFindings(
  findings: readonly DeterministicFinding[],
  provider: AiProvider,
  enabled: boolean,
  timeoutMs = 3000,
): Promise<AiExplanation> {
  if (!enabled) return { summary: 'AI explanations are disabled.', citations: [], groups: [] };
  const ids = new Set(findings.map((f) => f.id));
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('AI explanation timeout')), timeoutMs),
  );
  const raw = await Promise.race([
    provider.generate({
      prompt:
        'Summarize only the supplied findings. Cite finding IDs. Do not add facts, predictions, identity claims, or actions.',
      findings,
    }),
    timer,
  ]);
  if (typeof raw !== 'object' || raw === null) throw new Error('Malformed AI response');
  const r = raw as Record<string, unknown>;
  if (
    typeof r.summary !== 'string' ||
    !Array.isArray(r.citations) ||
    !r.citations.every((id) => typeof id === 'string' && ids.has(id))
  )
    throw new Error('AI response contains invalid citations');
  return { summary: r.summary, citations: r.citations, groups: [] };
}
