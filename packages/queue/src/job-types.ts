/**
 * Every derived job type the indexer can publish.
 *
 * This is the contract between the indexer (which emits) and the worker (which
 * routes). It is a closed union rather than a free-form string so a type that no
 * processor handles cannot compile, instead of failing silently at runtime.
 */
export const DERIVED_JOB_TYPES = [
  // Block-level facts, published for every transaction and log.
  'transaction',
  'log',
  // Discovered from block bodies.
  'contract-creation',
  'token-transfer',
  'token-approval',
  // Replay of previously indexed logs for a target contract.
  'contract-replay',
  // Protocol events: pools.
  'pool-refresh',
  'token-metadata',
  'liquidity-analysis',
  'risk-analysis',
  // Protocol events: swaps and launchpad trades.
  'new-price-observation',
  'market-metric',
  'wallet-activity',
  'alert-evaluation',
  // Protocol events: liquidity and migrations.
  'source-reconciliation',
  'liquidity-metric',
  'protocol-enrichment',
  'bonding-curve-migration-transition',
] as const;

export type DerivedJobType = (typeof DERIVED_JOB_TYPES)[number];

const DERIVED_JOB_TYPE_SET: ReadonlySet<string> = new Set(DERIVED_JOB_TYPES);

/**
 * Narrows a type read back from Redis. A payload that predates a rename, or was
 * written by a newer producer, will not match.
 */
export function isDerivedJobType(value: string): value is DerivedJobType {
  return DERIVED_JOB_TYPE_SET.has(value);
}
