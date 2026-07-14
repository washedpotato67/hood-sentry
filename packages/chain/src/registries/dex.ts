import type { DexContractEntry, Registry } from '../types.js';

// DEX contracts on Robinhood Chain have not been independently verified.
// Addresses must be sourced from the official DEX deployment registry.
// All trading features remain disabled until DEX addresses are verified.
const dexEntries: ReadonlyArray<DexContractEntry> = [];

export const dexRegistry: Registry<DexContractEntry> = {
  name: 'Supported DEX Contracts',
  version: {
    version: '1.0.0',
    createdAt: '2026-07-13',
  },
  entries: dexEntries,
};

export const PENDING_DEX_CONTRACTS = [
  {
    protocol: 'pending',
    dexType: 'factory' as const,
    status: 'pending-verification',
    notes:
      'DEX factory address not yet verified. Must be sourced from official deployment registry.',
  },
  {
    protocol: 'pending',
    dexType: 'router' as const,
    status: 'pending-verification',
    notes:
      'DEX router address not yet verified. Must be sourced from official deployment registry.',
  },
  {
    protocol: 'pending',
    dexType: 'quoter' as const,
    status: 'pending-verification',
    notes:
      'DEX quoter address not yet verified. Must be sourced from official deployment registry.',
  },
  {
    protocol: 'pending',
    dexType: 'permit2' as const,
    status: 'pending-verification',
    notes: 'Permit2 address not yet verified. Must be sourced from official deployment registry.',
  },
] as const;
