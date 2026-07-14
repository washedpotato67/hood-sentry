import type { ApplicationContractEntry, Registry } from '../types.js';

// Application contracts are not yet deployed.
// Addresses will be populated after testnet deployment and verification.
// All dependent features remain disabled until addresses are verified.
const applicationContractEntries: ReadonlyArray<ApplicationContractEntry> = [];

export const applicationContractRegistry: Registry<ApplicationContractEntry> = {
  name: 'Application Contracts',
  version: {
    version: '1.0.0',
    createdAt: '2026-07-13',
  },
  entries: applicationContractEntries,
};

export const PENDING_APPLICATION_CONTRACTS = [
  {
    key: 'sentry-token',
    name: 'Sentry Token',
    contractType: 'token' as const,
    role: 'utility-token',
    status: 'pending-deployment',
    notes: 'Fixed-supply ERC-20 + ERC20Permit. Not yet deployed.',
  },
  {
    key: 'access-staking',
    name: 'Access Staking',
    contractType: 'staking' as const,
    role: 'staking',
    status: 'pending-deployment',
    notes: 'Tier-based staking without yield. Not yet deployed.',
  },
  {
    key: 'project-registry',
    name: 'Project Registry',
    contractType: 'registry' as const,
    role: 'project-registry',
    status: 'pending-deployment',
    notes: 'On-chain project identity and metadata hash. Not yet deployed.',
  },
  {
    key: 'project-bond-vault',
    name: 'Project Bond Vault',
    contractType: 'bond-vault' as const,
    role: 'bond-vault',
    status: 'pending-deployment',
    notes: 'Project bond deposits and slashing. Not yet deployed.',
  },
  {
    key: 'report-registry',
    name: 'Report Registry',
    contractType: 'report-registry' as const,
    role: 'report-registry',
    status: 'pending-deployment',
    notes: 'Community report submissions and resolution. Not yet deployed.',
  },
  {
    key: 'timelock',
    name: 'Timelock Controller',
    contractType: 'timelock' as const,
    role: 'timelock',
    status: 'pending-deployment',
    notes: 'OpenZeppelin TimelockController for admin actions. Not yet deployed.',
  },
  {
    key: 'treasury-safe',
    name: 'Treasury Safe',
    contractType: 'safe' as const,
    role: 'treasury',
    status: 'pending-deployment',
    notes: 'Safe multisig for treasury operations. Not yet deployed.',
  },
] as const;
