import type { DiscoveryItem } from '../app/discovery-table';
import { apiRequest } from './api';

type Signals = { high: number; medium: number; low: number };
type Enrichment = { signals?: Signals; spark?: number[] };
type EnrichmentMap = Record<string, Enrichment>;

// Best-effort feed enrichment: attaches finding-severity beads and a liquidity
// sparkline by address. A failure returns the items unchanged — the feed never
// depends on it.
export async function enrichWithSignals(
  chain: number,
  items: readonly DiscoveryItem[],
): Promise<readonly DiscoveryItem[]> {
  if (items.length === 0) return items;
  const addresses = items.map((item) => item.address).join(',');
  const res = await apiRequest<EnrichmentMap>(
    `/v1/discovery/signals?chainId=${chain}&addresses=${encodeURIComponent(addresses)}`,
  );
  if (!res.ok) return items;
  const map = res.data;
  return items.map((item) => {
    const entry = map[item.address.toLowerCase()];
    return entry ? { ...item, signals: entry.signals, spark: entry.spark } : item;
  });
}
