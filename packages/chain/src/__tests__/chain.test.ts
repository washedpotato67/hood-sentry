import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  buildAddressUrl,
  buildBlockUrl,
  buildTokenUrl,
  buildTransactionUrl,
  getExplorerApiUrl,
} from '../explorer.js';
import {
  ChainMismatchError,
  MainnetWriteError,
  UnsupportedChainError,
  assertMainnetWriteAllowed,
  assertSupportedChain,
  guardWriteOperation,
} from '../guards.js';
import { applicationContractRegistry } from '../registries/application-contracts.js';
import { bridgeRegistry } from '../registries/bridges.js';
import { canonicalAssetRegistry } from '../registries/canonical-assets.js';
import { chainlinkFeedRegistry } from '../registries/chainlink-feeds.js';
import { dexRegistry } from '../registries/dex.js';
import {
  getMainnetConfig,
  getNetworkConfig,
  getTestnetConfig,
  networkRegistry,
} from '../registries/network.js';
import { quoteProviderRegistry } from '../registries/quote-providers.js';
import { sequencerFeedRegistry } from '../registries/sequencer-feeds.js';
import { smartAccountRegistry } from '../registries/smart-account.js';
import { stockTokenRegistry } from '../registries/stock-tokens.js';
import {
  RegistryValidationError,
  checksumAddress,
  findEnabledEntries,
  findEntries,
  findEntry,
  getEnabledEntries,
  getEntriesByChainId,
  getEntryByAddress,
  validateRegistry,
} from '../registry.js';
import { isPublicRpc, selectRpcUrl } from '../rpc.js';
import {
  MAINNET_CHAIN_ID,
  SUPPORTED_CHAIN_IDS,
  TESTNET_CHAIN_ID,
  isSupportedChainId,
} from '../types.js';
import type { Registry, SupportedChainId } from '../types.js';
import { assertRegistriesValid, validateAllRegistries } from '../validation.js';

describe('Chain Constants', () => {
  it('defines correct mainnet chain ID', () => {
    expect(MAINNET_CHAIN_ID).toBe(4663);
  });

  it('defines correct testnet chain ID', () => {
    expect(TESTNET_CHAIN_ID).toBe(46630);
  });

  it('includes both chain IDs in supported list', () => {
    expect(SUPPORTED_CHAIN_IDS).toContain(MAINNET_CHAIN_ID);
    expect(SUPPORTED_CHAIN_IDS).toContain(TESTNET_CHAIN_ID);
    expect(SUPPORTED_CHAIN_IDS).toHaveLength(2);
  });

  it('isSupportedChainId returns true for valid IDs', () => {
    expect(isSupportedChainId(4663)).toBe(true);
    expect(isSupportedChainId(46630)).toBe(true);
  });

  it('isSupportedChainId returns false for invalid IDs', () => {
    expect(isSupportedChainId(1)).toBe(false);
    expect(isSupportedChainId(137)).toBe(false);
    expect(isSupportedChainId(0)).toBe(false);
    expect(isSupportedChainId(99999)).toBe(false);
  });
});

describe('Registry Validation', () => {
  it('validates canonical assets registry', () => {
    expect(() => validateRegistry(canonicalAssetRegistry)).not.toThrow();
  });

  it('validates stock token registry', () => {
    expect(() => validateRegistry(stockTokenRegistry)).not.toThrow();
  });

  it('validates empty registries', () => {
    expect(() => validateRegistry(applicationContractRegistry)).not.toThrow();
    expect(() => validateRegistry(dexRegistry)).not.toThrow();
    expect(() => validateRegistry(quoteProviderRegistry)).not.toThrow();
    expect(() => validateRegistry(chainlinkFeedRegistry)).not.toThrow();
    expect(() => validateRegistry(sequencerFeedRegistry)).not.toThrow();
    expect(() => validateRegistry(smartAccountRegistry)).not.toThrow();
    expect(() => validateRegistry(bridgeRegistry)).not.toThrow();
  });

  it('rejects unsupported chain ID', () => {
    const badRegistry: Registry = {
      name: 'Bad Registry',
      version: { version: '1.0.0', createdAt: '2026-07-13' },
      entries: [
        {
          name: 'Bad Entry',
          key: 'bad',
          chainId: 1 as SupportedChainId,
          address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
          role: 'test',
          officialSource: 'https://example.com',
          verificationDate: '2026-07-13',
          runtimeBytecodeHash: null,
          enabled: true,
          notes: 'test',
        },
      ],
    };

    expect(() => validateRegistry(badRegistry)).toThrow(RegistryValidationError);
    expect(() => validateRegistry(badRegistry)).toThrow('unsupported chain ID');
  });

  it('rejects non-checksummed address', () => {
    const badRegistry: Registry = {
      name: 'Bad Registry',
      version: { version: '1.0.0', createdAt: '2026-07-13' },
      entries: [
        {
          name: 'Bad Address',
          key: 'bad',
          chainId: MAINNET_CHAIN_ID,
          address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73' as `0x${string}`,
          role: 'test',
          officialSource: 'https://example.com',
          verificationDate: '2026-07-13',
          runtimeBytecodeHash: null,
          enabled: true,
          notes: 'test',
        },
      ],
    };

    expect(() => validateRegistry(badRegistry)).toThrow(RegistryValidationError);
    expect(() => validateRegistry(badRegistry)).toThrow('not checksummed');
  });

  it('rejects zero address', () => {
    const badRegistry: Registry = {
      name: 'Bad Registry',
      version: { version: '1.0.0', createdAt: '2026-07-13' },
      entries: [
        {
          name: 'Zero Address',
          key: 'zero',
          chainId: MAINNET_CHAIN_ID,
          address: '0x0000000000000000000000000000000000000000',
          role: 'test',
          officialSource: 'https://example.com',
          verificationDate: '2026-07-13',
          runtimeBytecodeHash: null,
          enabled: true,
          notes: 'test',
        },
      ],
    };

    expect(() => validateRegistry(badRegistry)).toThrow(RegistryValidationError);
    expect(() => validateRegistry(badRegistry)).toThrow('zero address');
  });

  it('rejects duplicate address+role on same chain', () => {
    const address = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
    const badRegistry: Registry = {
      name: 'Bad Registry',
      version: { version: '1.0.0', createdAt: '2026-07-13' },
      entries: [
        {
          name: 'Entry A',
          key: 'a',
          chainId: MAINNET_CHAIN_ID,
          address: address as `0x${string}`,
          role: 'router',
          officialSource: 'https://example.com',
          verificationDate: '2026-07-13',
          runtimeBytecodeHash: null,
          enabled: true,
          notes: 'test',
        },
        {
          name: 'Entry B',
          key: 'b',
          chainId: MAINNET_CHAIN_ID,
          address: address as `0x${string}`,
          role: 'router',
          officialSource: 'https://example.com',
          verificationDate: '2026-07-13',
          runtimeBytecodeHash: null,
          enabled: true,
          notes: 'test',
        },
      ],
    };

    expect(() => validateRegistry(badRegistry)).toThrow(RegistryValidationError);
    expect(() => validateRegistry(badRegistry)).toThrow('Duplicate address+role');
  });

  it('allows same address with different roles', () => {
    const address = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
    const goodRegistry: Registry = {
      name: 'Good Registry',
      version: { version: '1.0.0', createdAt: '2026-07-13' },
      entries: [
        {
          name: 'Entry A',
          key: 'a',
          chainId: MAINNET_CHAIN_ID,
          address: address as `0x${string}`,
          role: 'router',
          officialSource: 'https://example.com',
          verificationDate: '2026-07-13',
          runtimeBytecodeHash: null,
          enabled: true,
          notes: 'test',
        },
        {
          name: 'Entry B',
          key: 'b',
          chainId: MAINNET_CHAIN_ID,
          address: address as `0x${string}`,
          role: 'quoter',
          officialSource: 'https://example.com',
          verificationDate: '2026-07-13',
          runtimeBytecodeHash: null,
          enabled: true,
          notes: 'test',
        },
      ],
    };

    expect(() => validateRegistry(goodRegistry)).not.toThrow();
  });

  it('rejects empty required fields', () => {
    const badRegistry: Registry = {
      name: 'Bad Registry',
      version: { version: '1.0.0', createdAt: '2026-07-13' },
      entries: [
        {
          name: '',
          key: '',
          chainId: MAINNET_CHAIN_ID,
          address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
          role: '',
          officialSource: '',
          verificationDate: '',
          runtimeBytecodeHash: null,
          enabled: true,
          notes: 'test',
        },
      ],
    };

    expect(() => validateRegistry(badRegistry)).toThrow(RegistryValidationError);
  });
});

describe('Registry Helpers', () => {
  it('checksumAddress returns valid checksum', () => {
    const result = checksumAddress('0x0bd7d308f8e1639fab988df18a8011f41eacad73');
    expect(result).toBe('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73');
  });

  it('checksumAddress throws on invalid address', () => {
    expect(() => checksumAddress('not-an-address')).toThrow('Invalid Ethereum address');
  });

  it('findEntry returns matching entry', () => {
    const entry = findEntry(canonicalAssetRegistry, (e) => e.key === 'weth');
    expect(entry).toBeDefined();
    expect(entry?.symbol).toBe('WETH');
  });

  it('findEntry returns undefined for no match', () => {
    const entry = findEntry(canonicalAssetRegistry, (e) => e.key === 'nonexistent');
    expect(entry).toBeUndefined();
  });

  it('findEntries returns all matching entries', () => {
    const entries = findEntries(stockTokenRegistry, (e) => e.assetType === 'etf');
    expect(entries.length).toBe(5);
  });

  it('findEnabledEntries filters by enabled state', () => {
    const entries = findEnabledEntries(canonicalAssetRegistry, () => true);
    expect(entries.length).toBe(2);
  });

  it('getEntryByAddress finds by address', () => {
    const entry = getEntryByAddress(
      canonicalAssetRegistry,
      '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    );
    expect(entry).toBeDefined();
    expect(entry?.key).toBe('weth');
  });

  it('getEntryByAddress is case-insensitive', () => {
    const entry = getEntryByAddress(
      canonicalAssetRegistry,
      '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
    );
    expect(entry).toBeDefined();
    expect(entry?.key).toBe('weth');
  });

  it('getEnabledEntries returns only enabled entries', () => {
    const entries = getEnabledEntries(canonicalAssetRegistry);
    expect(entries.every((e) => e.enabled)).toBe(true);
  });

  it('getEntriesByChainId filters by chain', () => {
    const entries = getEntriesByChainId(canonicalAssetRegistry, MAINNET_CHAIN_ID);
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.chainId === MAINNET_CHAIN_ID)).toBe(true);
  });
});

describe('Network Registry', () => {
  it('contains mainnet and testnet configurations', () => {
    expect(networkRegistry).toHaveLength(2);
  });

  it('getNetworkConfig returns correct config', () => {
    const mainnet = getNetworkConfig(MAINNET_CHAIN_ID);
    expect(mainnet).toBeDefined();
    expect(mainnet?.name).toBe('Robinhood Chain');
    expect(mainnet?.isTestnet).toBe(false);

    const testnet = getNetworkConfig(TESTNET_CHAIN_ID);
    expect(testnet).toBeDefined();
    expect(testnet?.name).toBe('Robinhood Chain Testnet');
    expect(testnet?.isTestnet).toBe(true);
  });

  it('getNetworkConfig returns undefined for unsupported chain', () => {
    expect(getNetworkConfig(1)).toBeUndefined();
  });

  it('getMainnetConfig returns mainnet', () => {
    const config = getMainnetConfig();
    expect(config.chainId).toBe(MAINNET_CHAIN_ID);
  });

  it('getTestnetConfig returns testnet', () => {
    const config = getTestnetConfig();
    expect(config.chainId).toBe(TESTNET_CHAIN_ID);
  });
});

describe('Explorer URL Builders', () => {
  it('buildTransactionUrl creates correct URL', () => {
    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const url = buildTransactionUrl(MAINNET_CHAIN_ID, txHash);
    expect(url).toBe(`https://robinhoodchain.blockscout.com/tx/${txHash}`);
  });

  it('buildTransactionUrl works for testnet', () => {
    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const url = buildTransactionUrl(TESTNET_CHAIN_ID, txHash);
    expect(url).toBe(`https://explorer.testnet.chain.robinhood.com/tx/${txHash}`);
  });

  it('buildTransactionUrl rejects invalid tx hash', () => {
    expect(() => buildTransactionUrl(MAINNET_CHAIN_ID, 'invalid')).toThrow(
      'Invalid transaction hash',
    );
  });

  it('buildTransactionUrl rejects unsupported chain', () => {
    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    expect(() => buildTransactionUrl(1, txHash)).toThrow('Unsupported chain ID');
  });

  it('buildAddressUrl creates correct URL', () => {
    const address = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
    const url = buildAddressUrl(MAINNET_CHAIN_ID, address);
    expect(url).toBe(`https://robinhoodchain.blockscout.com/address/${address}`);
  });

  it('buildAddressUrl rejects invalid address', () => {
    expect(() => buildAddressUrl(MAINNET_CHAIN_ID, 'invalid')).toThrow('Invalid address');
  });

  it('buildBlockUrl creates correct URL for block number', () => {
    const url = buildBlockUrl(MAINNET_CHAIN_ID, 12345);
    expect(url).toBe('https://robinhoodchain.blockscout.com/block/12345');
  });

  it('buildBlockUrl creates correct URL for block hash', () => {
    const hash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const url = buildBlockUrl(MAINNET_CHAIN_ID, hash);
    expect(url).toBe(`https://robinhoodchain.blockscout.com/block/${hash}`);
  });

  it('buildTokenUrl creates correct URL', () => {
    const address = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
    const url = buildTokenUrl(MAINNET_CHAIN_ID, address);
    expect(url).toBe(`https://robinhoodchain.blockscout.com/token/${address}`);
  });

  it('getExplorerApiUrl returns API URL for mainnet', () => {
    const url = getExplorerApiUrl(MAINNET_CHAIN_ID);
    expect(url).toBe('https://robinhoodchain.blockscout.com/api');
  });
});

describe('RPC Selection', () => {
  it('returns public RPC when no managed URL provided', () => {
    const url = selectRpcUrl({ chainId: MAINNET_CHAIN_ID });
    expect(url).toBe('https://rpc.mainnet.chain.robinhood.com');
  });

  it('returns managed RPC when provided', () => {
    const url = selectRpcUrl({
      chainId: MAINNET_CHAIN_ID,
      managedRpcUrl: 'https://managed-rpc.example.com',
    });
    expect(url).toBe('https://managed-rpc.example.com');
  });

  it('prefers managed when preferManaged is true', () => {
    const url = selectRpcUrl({
      chainId: MAINNET_CHAIN_ID,
      managedRpcUrl: 'https://managed-rpc.example.com',
      preferManaged: true,
    });
    expect(url).toBe('https://managed-rpc.example.com');
  });

  it('rejects unsupported chain ID', () => {
    expect(() => selectRpcUrl({ chainId: 1 as SupportedChainId })).toThrow('Unsupported chain ID');
  });

  it('isPublicRpc identifies public RPCs', () => {
    expect(isPublicRpc('https://rpc.mainnet.chain.robinhood.com')).toBe(true);
    expect(isPublicRpc('https://rpc.testnet.chain.robinhood.com')).toBe(true);
    expect(isPublicRpc('https://managed-rpc.example.com')).toBe(false);
    expect(isPublicRpc('https://alchemy.com/rpc')).toBe(false);
  });
});

describe('Guards', () => {
  it('assertSupportedChain passes for valid chains', () => {
    expect(() => assertSupportedChain(MAINNET_CHAIN_ID)).not.toThrow();
    expect(() => assertSupportedChain(TESTNET_CHAIN_ID)).not.toThrow();
  });

  it('assertSupportedChain throws for invalid chains', () => {
    expect(() => assertSupportedChain(1)).toThrow(UnsupportedChainError);
    expect(() => assertSupportedChain(137)).toThrow(UnsupportedChainError);
  });

  it('assertMainnetWriteAllowed passes when enabled', () => {
    expect(() => assertMainnetWriteAllowed(MAINNET_CHAIN_ID, 'stake', true)).not.toThrow();
  });

  it('assertMainnetWriteAllowed throws when disabled on mainnet', () => {
    expect(() => assertMainnetWriteAllowed(MAINNET_CHAIN_ID, 'stake', false)).toThrow(
      MainnetWriteError,
    );
    expect(() => assertMainnetWriteAllowed(MAINNET_CHAIN_ID, 'stake', false)).toThrow(
      'MAINNET_WRITES_ENABLED',
    );
  });

  it('assertMainnetWriteAllowed passes on testnet regardless of flag', () => {
    expect(() => assertMainnetWriteAllowed(TESTNET_CHAIN_ID, 'stake', false)).not.toThrow();
  });

  it('guardWriteOperation combines chain and write checks', () => {
    expect(() => guardWriteOperation(TESTNET_CHAIN_ID, 'stake', false)).not.toThrow();
    expect(() => guardWriteOperation(MAINNET_CHAIN_ID, 'stake', true)).not.toThrow();
    expect(() => guardWriteOperation(MAINNET_CHAIN_ID, 'stake', false)).toThrow(MainnetWriteError);
  });

  it('ChainMismatchError includes expected and actual chain IDs', () => {
    const error = new ChainMismatchError(MAINNET_CHAIN_ID, 1);
    expect(error.expectedChainId).toBe(MAINNET_CHAIN_ID);
    expect(error.actualChainId).toBe(1);
    expect(error.message).toContain('4663');
    expect(error.message).toContain('1');
  });
});

describe('Startup Validation', () => {
  it('validateAllRegistries returns results for all registries', () => {
    const results = validateAllRegistries();
    expect(results.length).toBe(9);
    expect(results.every((r) => r.valid)).toBe(true);
  });

  it('assertRegistriesValid does not throw', () => {
    expect(() => assertRegistriesValid()).not.toThrow();
  });

  it('validation results include entry counts', () => {
    const results = validateAllRegistries();
    const canonicalAssets = results.find((r) => r.registryName === 'Canonical Assets');
    expect(canonicalAssets?.entryCount).toBe(2);
    expect(canonicalAssets?.enabledCount).toBe(2);

    const stockTokens = results.find((r) => r.registryName === 'Canonical Stock Tokens and ETFs');
    expect(stockTokens?.entryCount).toBe(25);
    expect(stockTokens?.enabledCount).toBe(25);
  });

  it('verified DEX registry reports enabled entries', () => {
    const results = validateAllRegistries();
    const dex = results.find((r) => r.registryName === 'Supported DEX Contracts');
    expect(dex?.entryCount).toBe(2);
    expect(dex?.enabledCount).toBe(2);
    expect(dex?.valid).toBe(true);
  });
});

describe('Stock Token Registry', () => {
  it('contains 20 stock tokens', () => {
    const stocks = stockTokenRegistry.entries.filter((e) => e.assetType === 'stock');
    expect(stocks.length).toBe(20);
  });

  it('contains 5 ETF tokens', () => {
    const etfs = stockTokenRegistry.entries.filter((e) => e.assetType === 'etf');
    expect(etfs.length).toBe(5);
  });

  it('all stock tokens are on mainnet', () => {
    expect(stockTokenRegistry.entries.every((e) => e.chainId === MAINNET_CHAIN_ID)).toBe(true);
  });

  it('all stock tokens are enabled', () => {
    expect(stockTokenRegistry.entries.every((e) => e.enabled)).toBe(true);
  });

  it('all addresses are checksummed', () => {
    for (const entry of stockTokenRegistry.entries) {
      expect(getAddress(entry.address)).toBe(entry.address);
    }
  });

  it('no duplicate addresses', () => {
    const addresses = stockTokenRegistry.entries.map((e) => e.address.toLowerCase());
    const unique = new Set(addresses);
    expect(unique.size).toBe(addresses.length);
  });

  it('no duplicate tickers', () => {
    const tickers = stockTokenRegistry.entries.map((e) => e.ticker);
    const unique = new Set(tickers);
    expect(unique.size).toBe(tickers.length);
  });
});

describe('Pending Registries Documentation', () => {
  it('application contracts registry is empty with pending documentation', () => {
    expect(applicationContractRegistry.entries).toHaveLength(0);
  });

  it('DEX registry contains only the verified Uniswap v2 deployment', () => {
    expect(dexRegistry.entries).toHaveLength(2);
    expect(dexRegistry.entries.every((entry) => entry.protocol === 'uniswap')).toBe(true);
    expect(dexRegistry.entries.every((entry) => entry.protocolVersion === 'v2')).toBe(true);
    expect(dexRegistry.entries.every((entry) => entry.runtimeBytecodeHash !== null)).toBe(true);
  });

  it('quote provider registry is empty with pending documentation', () => {
    expect(quoteProviderRegistry.entries).toHaveLength(0);
  });

  it('Chainlink feed registry is empty with pending documentation', () => {
    expect(chainlinkFeedRegistry.entries).toHaveLength(0);
  });

  it('sequencer feed registry is empty with pending documentation', () => {
    expect(sequencerFeedRegistry.entries).toHaveLength(0);
  });

  it('smart account registry is empty with pending documentation', () => {
    expect(smartAccountRegistry.entries).toHaveLength(0);
  });

  it('bridge registry is empty with pending documentation', () => {
    expect(bridgeRegistry.entries).toHaveLength(0);
  });
});
