import { z } from 'zod';
import type { BlockscoutAbiParameter, BlockscoutCacheEntry } from './types.js';

const abiParameterSchema: z.ZodType<BlockscoutAbiParameter> = z.lazy(() =>
  z.object({
    name: z.string().optional(),
    type: z.string(),
    internalType: z.string().optional(),
    indexed: z.boolean().optional(),
    components: z.array(abiParameterSchema).optional(),
  }),
);

const abiItemSchema = z.object({
  type: z.enum(['constructor', 'error', 'event', 'fallback', 'function', 'receive']),
  name: z.string().optional(),
  stateMutability: z.enum(['pure', 'view', 'nonpayable', 'payable']).optional(),
  anonymous: z.boolean().optional(),
  inputs: z.array(abiParameterSchema).optional(),
  outputs: z.array(abiParameterSchema).optional(),
});

const warningSchema = z.object({
  code: z.enum(['ABI_MALFORMED', 'PROVIDER_UNAVAILABLE', 'RAW_RESPONSE_TOO_LARGE']),
  message: z.string(),
  provider: z.literal('blockscout'),
});

const metadataSchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  verified: z.boolean(),
  verificationStatus: z.enum(['fully_verified', 'partially_verified', 'verified', 'unverified']),
  sourceFiles: z.array(z.object({ path: z.string(), source: z.string() })),
  sourceHash: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable(),
  abi: z.array(abiItemSchema).nullable(),
  compilerVersion: z.string().nullable(),
  optimizerEnabled: z.boolean().nullable(),
  optimizerRuns: z.number().int().nonnegative().nullable(),
  compilerSettings: z.record(z.unknown()).nullable(),
  constructorArguments: z.string().nullable(),
  contractName: z.string().nullable(),
  proxy: z.object({
    proxyType: z.string().nullable(),
    implementationAddresses: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)),
    adminAddress: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .nullable(),
    minimalProxyAddress: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .nullable(),
  }),
  tokenLabels: z.object({
    name: z.string().nullable(),
    symbol: z.string().nullable(),
    publicTags: z.array(z.string()),
  }),
  rawResponse: z.record(z.unknown()),
  provenance: z.object({
    provider: z.literal('blockscout'),
    providerUrl: z.string().url(),
    endpoints: z.array(z.string()),
    fetchedAt: z.string().datetime(),
  }),
});

const cacheEntrySchema: z.ZodType<BlockscoutCacheEntry> = z.object({
  result: z.object({
    status: z.enum(['available', 'unavailable']),
    metadata: metadataSchema.nullable(),
    warnings: z.array(warningSchema),
    cacheStatus: z.enum(['miss', 'fresh', 'refreshed', 'stale']),
  }),
  expiresAt: z.string().datetime(),
});

export function parseBlockscoutCacheEntry(value: unknown): BlockscoutCacheEntry {
  return cacheEntrySchema.parse(value);
}
