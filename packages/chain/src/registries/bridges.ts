import type { BridgeEntry, Registry } from '../types.js';

// Bridge contracts on Robinhood Chain have not been independently verified.
// Addresses must be sourced from official bridge provider registries.
// All bridge-related features remain disabled until contracts are verified.
const bridgeEntries: ReadonlyArray<BridgeEntry> = [];

export const bridgeRegistry: Registry<BridgeEntry> = {
  name: 'Bridges',
  version: {
    version: '1.0.0',
    createdAt: '2026-07-13',
  },
  entries: bridgeEntries,
};

export const PENDING_BRIDGES = [
  {
    bridgeType: 'canonical' as const,
    direction: 'both' as const,
    status: 'pending-verification',
    notes: 'Canonical bridge address not yet verified on Robinhood Chain.',
  },
] as const;
