import { describe, expect, it } from 'vitest';
import { FeatureFlagService, InMemoryFlagStore } from '../service.js';
import type { FlagName } from '../types.js';

describe('InMemoryFlagStore', () => {
  it('defaults all flags to disabled', async () => {
    const store = new InMemoryFlagStore();
    const flag = await store.getFlag('TRADING_ENABLED');
    expect(flag.enabled).toBe(false);
  });

  it('respects initial flag values', async () => {
    const store = new InMemoryFlagStore({ TRADING_ENABLED: true });
    const flag = await store.getFlag('TRADING_ENABLED');
    expect(flag.enabled).toBe(true);
  });

  it('sets and gets flags', async () => {
    const store = new InMemoryFlagStore();
    await store.setFlag('WEBHOOKS_ENABLED', {
      enabled: true,
      reason: 'Testing',
      updatedAt: new Date(),
    });
    const flag = await store.getFlag('WEBHOOKS_ENABLED');
    expect(flag.enabled).toBe(true);
    expect(flag.reason).toBe('Testing');
  });

  it('returns all flags', async () => {
    const store = new InMemoryFlagStore();
    const flags = await store.getAllFlags();
    expect(Object.keys(flags)).toHaveLength(10);
    expect(flags.TRADING_ENABLED?.enabled).toBe(false);
    expect(flags.MAINNET_WRITES_ENABLED?.enabled).toBe(false);
  });
});

describe('FeatureFlagService', () => {
  it('isEnabled returns false for disabled flag', async () => {
    const store = new InMemoryFlagStore();
    const service = new FeatureFlagService(store);
    expect(await service.isEnabled('TRADING_ENABLED')).toBe(false);
  });

  it('isEnabled returns true for enabled flag', async () => {
    const store = new InMemoryFlagStore({ TRADING_ENABLED: true });
    const service = new FeatureFlagService(store);
    expect(await service.isEnabled('TRADING_ENABLED')).toBe(true);
  });

  it('requireEnabled throws for disabled flag', async () => {
    const store = new InMemoryFlagStore();
    const service = new FeatureFlagService(store);
    await expect(service.requireEnabled('TRADING_ENABLED')).rejects.toThrow(
      'Feature flag TRADING_ENABLED is disabled',
    );
  });

  it('requireEnabled does not throw for enabled flag', async () => {
    const store = new InMemoryFlagStore({ TRADING_ENABLED: true });
    const service = new FeatureFlagService(store);
    await expect(service.requireEnabled('TRADING_ENABLED')).resolves.toBeUndefined();
  });

  it('getAllFlags returns complete flag map', async () => {
    const store = new InMemoryFlagStore();
    const service = new FeatureFlagService(store);
    const flags = await service.getAllFlags();
    const expectedFlags: FlagName[] = [
      'TRADING_ENABLED',
      'TOKEN_STAKING_ENABLED',
      'PROJECT_BONDS_ENABLED',
      'REPORT_BONDS_ENABLED',
      'ADMIN_SLASHING_ENABLED',
      'GAS_SPONSORSHIP_ENABLED',
      'AI_EXPLANATIONS_ENABLED',
      'WEBHOOKS_ENABLED',
      'STOCK_TOKEN_MODULE_ENABLED',
      'MAINNET_WRITES_ENABLED',
    ];
    for (const flag of expectedFlags) {
      expect(flags[flag]).toBeDefined();
    }
  });
});
