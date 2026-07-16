import { z } from 'zod';

export const PROVIDER_REGISTRY_VERSION = '1.0.0';

const supportedChainIdSchema = z.union([z.literal(4663), z.literal(46630)]);
const capabilitySchema = z.enum([
  'rpc',
  'websocket',
  'archive',
  'explorer',
  'marketData',
  'portfolioData',
  'securityLabels',
  'tradeQuotes',
  'aiCommentary',
  'emailDelivery',
  'telegramDelivery',
  'objectStorage',
]);
const trustClassSchema = z.enum([
  'chainFact',
  'explorerEnrichment',
  'externalMarketData',
  'externalLabel',
  'commentary',
  'delivery',
  'storage',
]);
const credentialRequirementSchema = z.enum(['required', 'optional', 'none']);
const endpointKindSchema = z.enum(['http', 'websocket']);

const endpointSchema = z.object({
  chainId: supportedChainIdSchema,
  kind: endpointKindSchema,
  template: z.string().min(1),
});

const providerDefinitionSchema = z.object({
  providerId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  displayName: z.string().min(1),
  capabilities: z.array(capabilitySchema).min(1),
  trustClass: trustClassSchema,
  credentialKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
  credentialRequirement: credentialRequirementSchema,
  endpoints: z.array(endpointSchema),
  serviceUrl: z.string().url().optional(),
  timeoutMs: z.number().int().positive(),
  maximumAttempts: z.number().int().positive(),
  requestsPerSecond: z.number().positive(),
  maximumStalenessSeconds: z.number().int().positive().nullable(),
  verificationSourceUrl: z.string().url(),
  verifiedAt: z.string().datetime(),
});

const providerRegistrySchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    providers: z.array(providerDefinitionSchema).min(1),
  })
  .superRefine((registry, context) => {
    const ids = new Set<string>();
    for (const [index, provider] of registry.providers.entries()) {
      if (ids.has(provider.providerId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providers', index, 'providerId'],
          message: 'Provider IDs must be unique',
        });
      }
      ids.add(provider.providerId);

      const endpointKeys = new Set<string>();
      for (const [endpointIndex, endpoint] of provider.endpoints.entries()) {
        const key = `${endpoint.chainId}:${endpoint.kind}`;
        if (endpointKeys.has(key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['providers', index, 'endpoints', endpointIndex],
            message: 'Provider endpoint chain and kind pairs must be unique',
          });
        }
        endpointKeys.add(key);
      }

      if (provider.credentialRequirement === 'required' && provider.credentialKeys.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providers', index, 'credentialKeys'],
          message: 'Required provider credentials need at least one environment key',
        });
      }
    }
  });

export type SupportedProviderChainId = z.infer<typeof supportedChainIdSchema>;
export type ProviderCapability = z.infer<typeof capabilitySchema>;
export type ProviderTrustClass = z.infer<typeof trustClassSchema>;
export type ProviderDefinition = z.infer<typeof providerDefinitionSchema>;
export type ProviderRegistry = z.infer<typeof providerRegistrySchema>;

const rawRegistry = {
  version: PROVIDER_REGISTRY_VERSION,
  providers: [
    {
      providerId: 'alchemy',
      displayName: 'Alchemy',
      capabilities: ['rpc', 'websocket', 'archive'],
      trustClass: 'chainFact',
      credentialKeys: ['ALCHEMY_API_KEY'],
      credentialRequirement: 'required',
      endpoints: [
        {
          chainId: 4663,
          kind: 'http',
          template: 'https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}',
        },
        {
          chainId: 4663,
          kind: 'websocket',
          template: 'wss://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}',
        },
        {
          chainId: 46630,
          kind: 'http',
          template: 'https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}',
        },
        {
          chainId: 46630,
          kind: 'websocket',
          template: 'wss://robinhood-testnet.g.alchemy.com/v2/{API_KEY}',
        },
      ],
      timeoutMs: 30_000,
      maximumAttempts: 4,
      requestsPerSecond: 25,
      maximumStalenessSeconds: null,
      verificationSourceUrl: 'https://docs.robinhood.com/chain/connecting/',
      verifiedAt: '2026-07-15T00:00:00.000Z',
    },
    {
      providerId: 'blockscout',
      displayName: 'Blockscout',
      capabilities: ['explorer'],
      trustClass: 'explorerEnrichment',
      credentialKeys: ['BLOCKSCOUT_API_KEY'],
      credentialRequirement: 'optional',
      endpoints: [
        {
          chainId: 4663,
          kind: 'http',
          template: 'https://robinhoodchain.blockscout.com',
        },
        {
          chainId: 46630,
          kind: 'http',
          template: 'https://explorer.testnet.chain.robinhood.com',
        },
      ],
      timeoutMs: 5_000,
      maximumAttempts: 3,
      requestsPerSecond: 3,
      maximumStalenessSeconds: 21_600,
      verificationSourceUrl: 'https://docs.robinhood.com/chain/connecting/',
      verifiedAt: '2026-07-15T00:00:00.000Z',
    },
    {
      providerId: 'openai',
      displayName: 'OpenAI',
      capabilities: ['aiCommentary'],
      trustClass: 'commentary',
      credentialKeys: ['AI_PROVIDER_API_KEY'],
      credentialRequirement: 'required',
      endpoints: [],
      serviceUrl: 'https://api.openai.com',
      timeoutMs: 20_000,
      maximumAttempts: 1,
      requestsPerSecond: 2,
      maximumStalenessSeconds: null,
      verificationSourceUrl: 'https://developers.openai.com/api/docs/guides/structured-outputs',
      verifiedAt: '2026-07-15T00:00:00.000Z',
    },
    {
      providerId: 'resend',
      displayName: 'Resend',
      capabilities: ['emailDelivery'],
      trustClass: 'delivery',
      credentialKeys: ['EMAIL_PROVIDER_API_KEY'],
      credentialRequirement: 'required',
      endpoints: [],
      serviceUrl: 'https://api.resend.com',
      timeoutMs: 10_000,
      maximumAttempts: 4,
      requestsPerSecond: 2,
      maximumStalenessSeconds: null,
      verificationSourceUrl: 'https://resend.com/docs/api-reference/emails/send-email',
      verifiedAt: '2026-07-15T00:00:00.000Z',
    },
    {
      providerId: 'telegram',
      displayName: 'Telegram Bot API',
      capabilities: ['telegramDelivery'],
      trustClass: 'delivery',
      credentialKeys: ['TELEGRAM_BOT_TOKEN'],
      credentialRequirement: 'required',
      endpoints: [],
      serviceUrl: 'https://api.telegram.org',
      timeoutMs: 10_000,
      maximumAttempts: 4,
      requestsPerSecond: 20,
      maximumStalenessSeconds: null,
      verificationSourceUrl: 'https://core.telegram.org/bots/api#sendmessage',
      verifiedAt: '2026-07-15T00:00:00.000Z',
    },
  ],
} as const;

export const providerRegistry: ProviderRegistry = providerRegistrySchema.parse(rawRegistry);

export function getProviderDefinition(providerId: string): ProviderDefinition {
  const provider = providerRegistry.providers.find((entry) => entry.providerId === providerId);
  if (provider === undefined) throw new Error(`Unknown provider: ${providerId}`);
  return provider;
}

export function getProviderEndpoint(
  providerId: string,
  chainId: SupportedProviderChainId,
  kind: z.infer<typeof endpointKindSchema>,
): string {
  const provider = getProviderDefinition(providerId);
  const endpoint = provider.endpoints.find(
    (entry) => entry.chainId === chainId && entry.kind === kind,
  );
  if (endpoint === undefined) {
    throw new Error(`${providerId} has no ${kind} endpoint for chain ${chainId}`);
  }
  return endpoint.template;
}

export function getProviderServiceUrl(providerId: string): string {
  const provider = getProviderDefinition(providerId);
  if (provider.serviceUrl === undefined) {
    throw new Error(`${providerId} has no service URL`);
  }
  return provider.serviceUrl;
}
