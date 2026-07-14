import type { Registry, SmartAccountEntry } from '../types.js';

// Smart account infrastructure (ERC-4337) on Robinhood Chain has not been independently verified.
// Addresses must be sourced from official provider registries.
// All account abstraction features remain disabled until infrastructure is verified.
const smartAccountEntries: ReadonlyArray<SmartAccountEntry> = [];

export const smartAccountRegistry: Registry<SmartAccountEntry> = {
  name: 'Smart Account Infrastructure',
  version: {
    version: '1.0.0',
    createdAt: '2026-07-13',
  },
  entries: smartAccountEntries,
};

export const PENDING_SMART_ACCOUNT_INFRASTRUCTURE = [
  {
    provider: 'pending',
    accountType: 'entrypoint' as const,
    status: 'pending-verification',
    notes: 'ERC-4337 EntryPoint address not yet verified on Robinhood Chain.',
  },
  {
    provider: 'pending',
    accountType: 'paymaster' as const,
    status: 'pending-verification',
    notes: 'Paymaster address not yet verified. Required for gas sponsorship.',
  },
  {
    provider: 'pending',
    accountType: 'factory' as const,
    status: 'pending-verification',
    notes: 'Account factory address not yet verified.',
  },
] as const;
