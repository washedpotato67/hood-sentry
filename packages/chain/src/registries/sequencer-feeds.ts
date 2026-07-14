import type { ChainlinkFeedEntry, Registry } from '../types.js';

// Sequencer uptime feeds on Robinhood Chain have not been independently verified.
// Feed addresses must be sourced from the official Chainlink registry.
// All oracle-dependent features remain disabled until feeds are verified.
const sequencerFeedEntries: ReadonlyArray<ChainlinkFeedEntry> = [];

export const sequencerFeedRegistry: Registry<ChainlinkFeedEntry> = {
  name: 'Sequencer Uptime Feeds',
  version: {
    version: '1.0.0',
    createdAt: '2026-07-13',
  },
  entries: sequencerFeedEntries,
};

export const PENDING_SEQUENCER_FEEDS = [
  {
    feedType: 'sequencer-uptime' as const,
    status: 'pending-verification',
    notes:
      'Sequencer uptime feed address not yet verified. Must be sourced from official Chainlink registry.',
  },
] as const;
