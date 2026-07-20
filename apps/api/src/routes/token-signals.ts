import type { ProtocolRepository, RiskRepository } from '@hood-sentry/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const SPARK_POINTS = 12;

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

type Signals = { high: number; medium: number; low: number; unavailable: number };
type Enrichment = { signals?: Signals; spark?: number[] };

/**
 * Per-token enrichment for the discovery feed, keyed by lowercased address:
 * finding-severity beads and a liquidity sparkline. Both are per-rule / raw
 * evidence, not aggregate scoring, so this is unaffected by RISK_SCORES_ENABLED.
 * Isolated from the ranking pipeline — the feed page calls it with the addresses
 * it just rendered.
 */
export async function tokenSignalRoutes(
  app: FastifyInstance,
  options: { risk: RiskRepository; protocol: ProtocolRepository },
) {
  app.get('/discovery/signals', async (request) => {
    const { chainId, addresses } = querySchema.parse(request.query);
    if (addresses.length === 0) return { data: {} };
    const [counts, series] = await Promise.all([
      options.risk.getFindingSeverityCounts(chainId, addresses),
      options.protocol.getTokenLiquiditySeries(chainId, addresses, SPARK_POINTS),
    ]);
    const map: Record<string, Enrichment> = {};
    for (const row of counts) {
      const entry = map[row.targetAddress] ?? {};
      entry.signals = {
        high: row.high,
        medium: row.medium,
        low: row.low,
        unavailable: row.unavailable,
      };
      map[row.targetAddress] = entry;
    }
    for (const row of series) {
      const entry = map[row.tokenAddress] ?? {};
      entry.spark = row.points;
      map[row.tokenAddress] = entry;
    }
    return { data: map };
  });
}
