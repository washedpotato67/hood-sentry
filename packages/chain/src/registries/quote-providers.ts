import type { QuoteProviderEntry, Registry } from '../types.js';

// Quote providers have not been independently verified on Robinhood Chain.
// All quote-dependent features remain disabled until providers are verified.
const quoteProviderEntries: ReadonlyArray<QuoteProviderEntry> = [];

export const quoteProviderRegistry: Registry<QuoteProviderEntry> = {
  name: 'Quote Providers',
  version: {
    version: '1.0.0',
    createdAt: '2026-07-13',
  },
  entries: quoteProviderEntries,
};

export const PENDING_QUOTE_PROVIDERS = [
  {
    provider: 'pending',
    quoteType: 'aggregator' as const,
    status: 'pending-verification',
    notes: 'Quote aggregator address not yet verified on Robinhood Chain.',
  },
  {
    provider: 'pending',
    quoteType: 'rfq' as const,
    status: 'pending-verification',
    notes: 'RFQ provider address not yet verified. Required for Stock Token trading.',
  },
] as const;
