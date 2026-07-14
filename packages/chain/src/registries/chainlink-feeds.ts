import type { ChainlinkFeedEntry, Registry } from '../types.js';

// Chainlink price feeds on Robinhood Chain have not been independently verified.
// Feed addresses must be sourced from the official Chainlink registry.
// All price-dependent features remain disabled until feeds are verified.
const chainlinkFeedEntries: ReadonlyArray<ChainlinkFeedEntry> = [];

export const chainlinkFeedRegistry: Registry<ChainlinkFeedEntry> = {
  name: 'Chainlink Price Feeds',
  version: {
    version: '1.0.0',
    createdAt: '2026-07-13',
  },
  entries: chainlinkFeedEntries,
};

export const PENDING_CHAINLINK_FEEDS = [
  {
    feedType: 'price' as const,
    status: 'pending-verification',
    notes:
      'Price feed addresses not yet verified. Must be sourced from official Chainlink registry at https://docs.robinhood.com/chain/oracles-and-price-feeds/',
  },
] as const;
