import { z } from 'zod';
import { getProviderEndpoint } from './registry.js';

const rpcResolutionInputSchema = z.object({
  chainId: z.union([z.literal(4663), z.literal(46630)]),
  alchemyApiKey: z.string().trim().min(1).max(512).optional(),
  primaryRpcUrl: z.string().url().optional(),
  secondaryRpcUrl: z.string().url().optional(),
  primaryWebsocketUrl: z.string().url().optional(),
  secondaryWebsocketUrl: z.string().url().optional(),
});

export type RpcResolutionInput = {
  chainId: number;
  alchemyApiKey?: string;
  primaryRpcUrl?: string;
  secondaryRpcUrl?: string;
  primaryWebsocketUrl?: string;
  secondaryWebsocketUrl?: string;
};

export type ResolvedRpcProviders = {
  primary: { providerId: string; url: string };
  secondary: { providerId: string; url: string } | null;
  primaryWebsocket: { providerId: string; url: string } | null;
  secondaryWebsocket: { providerId: string; url: string } | null;
};

export class ProviderConfigurationError extends Error {
  constructor(
    readonly code: 'PRIMARY_RPC_MISSING' | 'PROVIDER_ENDPOINT_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderConfigurationError';
  }
}

function endpointFromTemplate(template: string, apiKey: string): string {
  const endpoint = template.replace('{API_KEY}', encodeURIComponent(apiKey));
  try {
    const parsed = new URL(endpoint);
    if (!['https:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('Provider endpoint scheme or credentials are invalid');
    }
    return parsed.toString();
  } catch (error) {
    throw new ProviderConfigurationError(
      'PROVIDER_ENDPOINT_INVALID',
      error instanceof Error ? error.message : 'Provider endpoint is invalid',
    );
  }
}

export function resolveRpcProviders(rawInput: RpcResolutionInput): ResolvedRpcProviders {
  const input = rpcResolutionInputSchema.parse(rawInput);
  const alchemyPrimary =
    input.alchemyApiKey === undefined
      ? null
      : endpointFromTemplate(
          getProviderEndpoint('alchemy', input.chainId, 'http'),
          input.alchemyApiKey,
        );
  const alchemyWebsocket =
    input.alchemyApiKey === undefined
      ? null
      : endpointFromTemplate(
          getProviderEndpoint('alchemy', input.chainId, 'websocket'),
          input.alchemyApiKey,
        );
  const primaryUrl = input.primaryRpcUrl ?? alchemyPrimary;
  if (primaryUrl === null || primaryUrl === undefined) {
    throw new ProviderConfigurationError(
      'PRIMARY_RPC_MISSING',
      'Set ALCHEMY_API_KEY or ROBINHOOD_RPC_PRIMARY',
    );
  }

  return {
    primary: {
      providerId: input.primaryRpcUrl === undefined ? 'alchemy' : 'configured-primary',
      url: primaryUrl,
    },
    secondary:
      input.secondaryRpcUrl === undefined
        ? null
        : { providerId: 'configured-secondary', url: input.secondaryRpcUrl },
    primaryWebsocket:
      input.primaryWebsocketUrl === undefined && alchemyWebsocket === null
        ? null
        : {
            providerId: input.primaryWebsocketUrl === undefined ? 'alchemy' : 'configured-primary',
            url: input.primaryWebsocketUrl ?? alchemyWebsocket ?? '',
          },
    secondaryWebsocket:
      input.secondaryWebsocketUrl === undefined
        ? null
        : { providerId: 'configured-secondary', url: input.secondaryWebsocketUrl },
  };
}
