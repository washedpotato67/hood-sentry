import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ProviderConfigurationError,
  ProviderHttpClient,
  ProviderHttpError,
  ResendEmailProvider,
  TelegramBotProvider,
  getProviderDefinition,
  getProviderEndpoint,
  providerRegistry,
  resolveRpcProviders,
} from '../index.js';

describe('provider registry', () => {
  it('exposes verified Robinhood Chain endpoints', () => {
    expect(providerRegistry.version).toBe('1.0.0');
    expect(getProviderDefinition('alchemy').trustClass).toBe('chainFact');
    expect(getProviderEndpoint('blockscout', 4663, 'http')).toBe(
      'https://robinhoodchain.blockscout.com',
    );
    expect(getProviderDefinition('resend').capabilities).toContain('emailDelivery');
  });

  it('rejects unknown provider endpoint requests', () => {
    expect(() => getProviderDefinition('missing')).toThrow('Unknown provider: missing');
  });
});

describe('notification providers', () => {
  it('sends Resend email with provider idempotency', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'message-id' }), { status: 200 }));
    const provider = new ResendEmailProvider('re_secret', fetchRequest);
    await expect(
      provider.send({
        from: 'Hood Sentry <alerts@example.com>',
        to: 'user@example.com',
        subject: 'Risk alert',
        text: 'A risk rule triggered.',
        idempotencyKey: 'delivery-id',
      }),
    ).resolves.toMatchObject({ providerId: 'resend', providerMessageId: 'message-id' });
    const request = fetchRequest.mock.calls[0];
    expect(request?.[1]?.headers).toMatchObject({ 'idempotency-key': 'delivery-id' });
  });

  it('sends a Telegram message without exposing formatting controls', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 }),
      );
    const provider = new TelegramBotProvider(
      '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567890',
      fetchRequest,
    );
    await expect(provider.send({ chatId: '99', text: '<unsafe>' })).resolves.toMatchObject({
      providerId: 'telegram',
      providerMessageId: '42',
    });
    const body = JSON.parse(String(fetchRequest.mock.calls[0]?.[1]?.body)) as unknown;
    expect(body).toMatchObject({ chat_id: '99', text: '<unsafe>' });
  });
});

describe('RPC provider resolution', () => {
  it('builds mainnet RPC and WebSocket endpoints from one Alchemy key', () => {
    const result = resolveRpcProviders({ chainId: 4663, alchemyApiKey: 'key/with spaces' });

    expect(result.primary).toEqual({
      providerId: 'alchemy',
      url: 'https://robinhood-mainnet.g.alchemy.com/v2/key%2Fwith%20spaces',
    });
    expect(result.primaryWebsocket).toEqual({
      providerId: 'alchemy',
      url: 'wss://robinhood-mainnet.g.alchemy.com/v2/key%2Fwith%20spaces',
    });
  });

  it('prefers explicit endpoints and keeps Alchemy as the WebSocket fallback', () => {
    const result = resolveRpcProviders({
      chainId: 46630,
      alchemyApiKey: 'test-key',
      primaryRpcUrl: 'https://primary.example/rpc',
      secondaryRpcUrl: 'https://secondary.example/rpc',
    });

    expect(result.primary.providerId).toBe('configured-primary');
    expect(result.secondary?.providerId).toBe('configured-secondary');
    expect(result.primaryWebsocket?.url).toContain('robinhood-testnet.g.alchemy.com');
  });

  it('fails with a stable code when no primary provider is configured', () => {
    expect.assertions(2);
    try {
      resolveRpcProviders({ chainId: 4663 });
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderConfigurationError);
      expect((error as ProviderConfigurationError).code).toBe('PRIMARY_RPC_MISSING');
    }
  });
});

describe('provider HTTP client', () => {
  const responseSchema = z.object({ value: z.number().int() });

  it('validates responses and removes secrets from provenance', async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ value: 7 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new ProviderHttpClient({
      providerId: 'fixture',
      fetchRequest,
      requestsPerSecond: 1_000_000,
    });

    const result = await client.request({
      url: 'https://provider.example/v1/secret-key?apikey=secret-key',
      schema: responseSchema,
      secretValues: ['secret-key'],
    });

    expect(result.data).toEqual({ value: 7 });
    expect(result.provenance.endpoint).not.toContain('secret-key');
    expect(result.provenance.endpoint).toContain('%5BREDACTED%5D');
  });

  it('retries rate limits and honors retry-after', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: 8 }), { status: 200 }));
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = new ProviderHttpClient({
      providerId: 'fixture',
      fetchRequest,
      sleep,
      random: () => 0,
      requestsPerSecond: 1_000_000,
    });

    const result = await client.request({
      url: 'https://provider.example',
      schema: responseSchema,
    });

    expect(result.data.value).toBe(8);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('rejects malformed external responses', async () => {
    const client = new ProviderHttpClient({
      providerId: 'fixture',
      fetchRequest: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ value: 'wrong' }), { status: 200 })),
      requestsPerSecond: 1_000_000,
    });

    await expect(
      client.request({ url: 'https://provider.example', schema: responseSchema }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID', retryable: false });
  });

  it('opens the circuit after repeated provider failures', async () => {
    const client = new ProviderHttpClient({
      providerId: 'fixture',
      fetchRequest: vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
      maximumAttempts: 1,
      circuitFailureThreshold: 2,
      requestsPerSecond: 1_000_000,
    });

    await expect(
      client.request({ url: 'https://provider.example', schema: responseSchema }),
    ).rejects.toBeInstanceOf(ProviderHttpError);
    await expect(
      client.request({ url: 'https://provider.example', schema: responseSchema }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NETWORK_ERROR' });
    await expect(
      client.request({ url: 'https://provider.example', schema: responseSchema }),
    ).rejects.toMatchObject({ code: 'PROVIDER_CIRCUIT_OPEN' });
  });

  it('rejects oversized responses before parsing', async () => {
    const client = new ProviderHttpClient({
      providerId: 'fixture',
      fetchRequest: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ value: 1 }), {
          status: 200,
          headers: { 'content-length': '100' },
        }),
      ),
      maximumResponseBytes: 10,
      requestsPerSecond: 1_000_000,
    });

    await expect(
      client.request({ url: 'https://provider.example', schema: responseSchema }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' });
  });
});
