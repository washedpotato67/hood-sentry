import type { ApplicationContractEntry, Registry } from '../types.js';

// Sentry does not depend on Sentry-owned application contracts. External token, treasury, and
// protocol addresses live in their dedicated verified registries and remain disabled until proven.
const applicationContractEntries: ReadonlyArray<ApplicationContractEntry> = [];

export const applicationContractRegistry: Registry<ApplicationContractEntry> = {
  name: 'Application Contracts',
  version: {
    version: '1.0.0',
    createdAt: '2026-07-13',
  },
  entries: applicationContractEntries,
};

export const PENDING_APPLICATION_CONTRACTS = [] as const;
