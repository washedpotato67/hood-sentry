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
        status: z.string(),
        latencyMs: z.number().optional(),
      }),
    )
    .optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
