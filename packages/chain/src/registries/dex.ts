import type { DexContractEntry, Registry } from '../types.js';

const UNISWAP_V2_DEPLOYMENT_SOURCE = 'https://developers.uniswap.org/docs/protocols/v2/deployments';

// These addresses come from Uniswap's official deployment registry. Runtime bytecode hashes were
// independently read from Robinhood Chain mainnet through eth_getCode on 2026-07-14.
const dexEntries: ReadonlyArray<DexContractEntry> = [
  {
    name: 'Uniswap v2 Factory',
    key: 'uniswap-v2-factory-mainnet',
    chainId: 4663,
    address: '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f',
    role: 'factory',
    protocol: 'uniswap',
    protocolVersion: 'v2',
    dexType: 'factory',
    officialSource: UNISWAP_V2_DEPLOYMENT_SOURCE,
    verificationDate: '2026-07-14',
    runtimeBytecodeHash: '0xbab145d02e7005f0d84c6c1639d39b799b0ea16df99ebbdaf5a14d9da820b4e0',
    enabled: true,
    notes: 'Chain ID 4663 and runtime bytecode independently verified through direct RPC.',
  },
  {
    name: 'Uniswap v2 Router02',
    key: 'uniswap-v2-router02-mainnet',
    chainId: 4663,
    address: '0x89e5DB8B5aA49aA85AC63f691524311AEB649eba',
    role: 'router',
    protocol: 'uniswap',
    protocolVersion: 'v2',
    dexType: 'router',
    officialSource: UNISWAP_V2_DEPLOYMENT_SOURCE,
    verificationDate: '2026-07-14',
    runtimeBytecodeHash: '0xbd55ea26b2f8d42a8ff151511cef92a326a9817686899fe96a8a8f81ee7fc55e',
    enabled: true,
    notes: 'Chain ID 4663 and runtime bytecode independently verified through direct RPC.',
  },
];

export const dexRegistry: Registry<DexContractEntry> = {
  name: 'Supported DEX Contracts',
  version: {
    version: '1.1.0',
    createdAt: '2026-07-14',
  },
  entries: dexEntries,
};

export const PENDING_DEX_CONTRACTS = [
  {
    protocol: 'additional-venues',
    status: 'pending-verification',
    notes:
      'No additional venue has a complete official Robinhood Chain deployment record and direct bytecode verification.',
  },
] as const;
