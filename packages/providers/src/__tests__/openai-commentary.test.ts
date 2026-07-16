import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  OpenAiRiskCommentaryProvider,
  type RiskCommentaryInput,
  type RiskCommentaryProviderError,
} from '../index.js';

const requestSchema = z.object({
  model: z.string(),
  store: z.literal(false),
  input: z.array(z.object({ role: z.string(), content: z.string() })),
  text: z.object({ format: z.object({ type: z.literal('json_schema'), strict: z.literal(true) }) }),
});

const input: RiskCommentaryInput = {
  scanId: '9f324767-3028-4bcf-b83d-4e85886fe9ca',
  chainId: 46630,
  targetAddress: '0x0000000000000000000000000000000000000001',
  targetType: 'token',
  engineVersion: '1.0.0',
  rulesetVersion: '1.0.0',
  methodologyVersion: '1.0.0',
  sourceBlock: '100',
  sourceBlockHash: `0x${'1'.repeat(64)}`,
  status: 'completed',
  score: {
    value: '82.00',
    grade: 'B',
    completenessPercent: '95.00',
    unresolvedDataWarnings: [],
  },
  findings: [
    {
      ruleId: 'owner-control',
      ruleVersion: '1.0.0',
      status: 'warning',
      category: 'privilege',
      severity: 'medium',
      confidence: 'high',
      title: 'Owner retains control',
      explanation: 'The owner retains a privileged function.',
      evidence: [],
      remediation: 'Move ownership to a timelock.',
    },
  ],
};

describe('OpenAI risk commentary provider', () => {
  it('returns schema-checked commentary from the Responses API', async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp_123',
          model: 'gpt-5.4-mini-2026-03-17',
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    summary: 'The report identifies one medium privilege warning.',
                    evidenceHighlights: ['Owner control is present.'],
                    limitations: ['The scan covers block 100.'],
                    userActions: ['Review the owner address.'],
                  }),
                },
              ],
            },
          ],
          usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 },
        }),
        { status: 200 },
      ),
    );
    const provider = new OpenAiRiskCommentaryProvider(
      'sk-test-secret',
      'gpt-5.4-mini-2026-03-17',
      fetchRequest,
      () => new Date('2026-07-15T12:00:00.000Z'),
    );

    await expect(provider.generate(input)).resolves.toMatchObject({
      providerResponseId: 'resp_123',
      providerId: 'openai',
      promptVersion: 'risk-commentary-v1',
      commentary: { evidenceHighlights: ['Owner control is present.'] },
      inputTokens: 100,
      outputTokens: 40,
    });
    const body = requestSchema.parse(JSON.parse(String(fetchRequest.mock.calls[0]?.[1]?.body)));
    expect(body.model).toBe('gpt-5.4-mini-2026-03-17');
    expect(body.input[0]?.content).toContain('Do not create, remove, suppress, change, or rescore');
    expect(body.input[1]?.content).toContain('owner-control');
  });

  it('rejects provider refusals with a stable code', async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp_refusal',
          model: 'gpt-5.4-mini-2026-03-17',
          status: 'completed',
          output: [
            { type: 'message', content: [{ type: 'refusal', refusal: 'Request refused.' }] },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new OpenAiRiskCommentaryProvider(
      'sk-test-secret',
      'gpt-5.4-mini-2026-03-17',
      fetchRequest,
    );

    await expect(provider.generate(input)).rejects.toMatchObject({
      code: 'COMMENTARY_REFUSED',
    } satisfies Partial<RiskCommentaryProviderError>);
  });
});
