import { z } from 'zod';

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'ready', 'degraded']),
  checks: z
    .record(
      z.object({
        status: z.enum(['ok', 'error']),
        latencyMs: z.number(),
        code: z.string().optional(),
        details: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      }),
    )
    .optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
