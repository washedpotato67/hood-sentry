import { describe, expect, it, vi } from 'vitest';
import {
  AiTokenReportProvider,
  type AiTokenReportProviderError,
  type TokenReportFacts,
} from '../index.js';

const facts: TokenReportFacts = {
  chainId: 4663,
  address: '0x0000000000000000000000000000000000000001',
  name: 'Example',
  symbol: 'EX',
  priceUsd: '1.23',
  liquidityUsd: '45000',
  volume24hUsd: '12000',
  holderCount: '210',
  poolCount: 2,
};

function chatResponse(content: string, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      id: 'gen-abc123',
      model: 'openai/gpt-4o-mini',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content, ...extra } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('AI token report provider', () => {
  it('parses a schema-checked report from a Chat Completions response', async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(
      chatResponse(
        JSON.stringify({
          summary: 'A small-cap token with thin liquidity relative to its holder base.',
          highlights: ['210 holders across 2 pools.'],
          watchouts: ['Liquidity is shallow at $45k.'],
          disclaimer: 'This is an overview from live data, not financial advice.',
        }),
      ),
    );
    const provider = new AiTokenReportProvider(
      'sk-or-test',
      'openai/gpt-4o-mini',
      'https://openrouter.ai/api/v1',
      fetchRequest,
    );

    const result = await provider.generate(facts);

    expect(result.report.summary).toContain('thin liquidity');
    expect(result.report.watchouts).toHaveLength(1);
    expect(result.model).toBe('openai/gpt-4o-mini');
    expect(result.providerResponseId).toBe('gen-abc123');
    // Posts to the OpenRouter chat-completions surface, not the Responses API.
    const url = fetchRequest.mock.calls[0]?.[0];
    expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('rejects a refusal with a typed error', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(chatResponse('', { refusal: 'I cannot help with that.' }));
    const provider = new AiTokenReportProvider(
      'sk-or-test',
      'm',
      'https://openrouter.ai/api/v1',
      fetchRequest,
    );

    await expect(provider.generate(facts)).rejects.toMatchObject({ code: 'REPORT_REFUSED' });
  });

  it('rejects non-JSON content as invalid', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(chatResponse('here is your report, in prose'));
    const provider = new AiTokenReportProvider(
      'sk-or-test',
      'm',
      'https://openrouter.ai/api/v1',
      fetchRequest,
    );

    const error = (await provider.generate(facts).catch((e) => e)) as AiTokenReportProviderError;
    expect(error.code).toBe('REPORT_RESPONSE_INVALID');
  });
});
