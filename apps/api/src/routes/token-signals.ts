import type { RiskRepository } from '@hood-sentry/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const querySchema = z.object({
  chainId: z.coerce
    .number()
    .int()
    .refine((v) => v === 4663 || v === 46630, 'unsupported chainId'),
  // Comma-separated token addresses from the visible feed page; capped so the
  // enrichment query stays bounded.
  addresses: z
    .string()
    .min(1)
    .transform((raw) =>
      raw
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
        .slice(0, 60),
    ),
});

type Signals = { high: number; medium: number; low: number };

/**
 * Per-token enrichment for the discovery feed, keyed by lowercased address:
 * finding-severity beads. Findings are per-rule evidence, not aggregate scoring,
 * so this is unaffected by RISK_SCORES_ENABLED. Isolated from the ranking
 * pipeline — the feed page calls it with the addresses it just rendered.
 */
export async function tokenSignalRoutes(app: FastifyInstance, options: { risk: RiskRepository }) {
  app.get('/discovery/signals', async (request) => {
    const { chainId, addresses } = querySchema.parse(request.query);
    if (addresses.length === 0) return { data: {} };
    const counts = await options.risk.getFindingSeverityCounts(chainId, addresses);
    const map: Record<string, { signals: Signals }> = {};
    for (const row of counts) {
      map[row.targetAddress] = {
        signals: { high: row.high, medium: row.medium, low: row.low },
      };
    }
    return { data: map };
  });
}
