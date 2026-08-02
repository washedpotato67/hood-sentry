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

/**
 * Models reach for em dashes even when the prompt forbids them. Dash characters
 * are typographic noise in a product whose UI avoids them, so they are stripped
 * at the boundary: no generated prose can carry an em or en dash to the page.
 */
function stripDashes(text: string): string {
  return text.replace(/\s*[\u2013\u2014]\s*/g, ', ');
}

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
  return { summary: stripDashes(r.summary), citations: r.citations, groups: [] };
}
