import { z } from 'zod';
import { evmAddressSchema, rawIntegerSchema } from './protocols.js';

export const normalizedRouteStepSchema = z.object({
  protocolKey: z.string().min(1),
  protocolVersion: z.string().min(1),
  poolAddress: evmAddressSchema,
  inputTokenAddress: evmAddressSchema,
  outputTokenAddress: evmAddressSchema,
  feeTier: rawIntegerSchema.optional(),
});

export const quoteRequestSchema = z.object({
  chainId: z.number().int().positive(),
  protocolKey: z.string().min(1),
  inputTokenAddress: evmAddressSchema,
  outputTokenAddress: evmAddressSchema,
  amountInRaw: rawIntegerSchema,
  minimumAmountOutRaw: rawIntegerSchema,
  route: z.array(normalizedRouteStepSchema).min(1),
});

export const quoteWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
});

export const normalizedQuoteResponseSchema = z.object({
  quoteId: z.string(),
  chainId: z.number().int().positive(),
  protocolKey: z.string(),
  protocolVersion: z.string(),
  inputTokenAddress: evmAddressSchema,
  outputTokenAddress: evmAddressSchema,
  amountInRaw: rawIntegerSchema,
  expectedAmountOutRaw: rawIntegerSchema,
  minimumAmountOutRaw: rawIntegerSchema,
  estimatedGas: rawIntegerSchema.optional(),
  priceImpactBps: rawIntegerSchema.optional(),
  protocolFeeRaw: rawIntegerSchema.optional(),
  route: z.array(normalizedRouteStepSchema),
  spenderAddress: evmAddressSchema.optional(),
  transactionTarget: evmAddressSchema,
  transactionSelector: z.string().regex(/^0x[0-9a-fA-F]{8}$/),
  sourceBlockNumber: rawIntegerSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  warnings: z.array(quoteWarningSchema),
});

export type QuoteRequestContract = z.infer<typeof quoteRequestSchema>;
export type NormalizedQuoteResponse = z.infer<typeof normalizedQuoteResponseSchema>;
