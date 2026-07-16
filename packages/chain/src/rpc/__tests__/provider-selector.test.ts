import { beforeEach, describe, expect, it } from 'vitest';
import { BlockLagMonitor } from '../block-lag-monitor.js';
import { CircuitBreaker } from '../circuit-breaker.js';
import { ProviderHealthTracker } from '../health-tracker.js';
import { ProviderSelector } from '../provider-selector.js';

describe('ProviderSelector', () => {
  let selector: ProviderSelector;
  let healthTrackers: Map<string, ProviderHealthTracker>;
  let blockLagMonitor: BlockLagMonitor;
  let primaryCircuitBreaker: CircuitBreaker;
  let secondaryCircuitBreaker: CircuitBreaker;
  let archiveCircuitBreaker: CircuitBreaker;

  beforeEach(() => {
    healthTrackers = new Map();
    blockLagMonitor = new BlockLagMonitor({
      maxAcceptableLag: 5,
      staleThreshold: 10,
    });

    primaryCircuitBreaker = new CircuitBreaker('http://primary.com', {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxRequests: 2,
    });
    secondaryCircuitBreaker = new CircuitBreaker('http://secondary.com', {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxRequests: 2,
    });
    archiveCircuitBreaker = new CircuitBreaker('http://archive.com', {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxRequests: 2,
    });

    healthTrackers.set(
      'http://primary.com',
      new ProviderHealthTracker('http://primary.com', 'primary', primaryCircuitBreaker),
    );
    healthTrackers.set(
      'http://secondary.com',
      new ProviderHealthTracker('http://secondary.com', 'secondary', secondaryCircuitBreaker),
    );
    healthTrackers.set(
      'http://archive.com',
      new ProviderHealthTracker('http://archive.com', 'archive', archiveCircuitBreaker),
    );

    selector = new ProviderSelector(
      'http://primary.com',
      'http://secondary.com',
      'http://archive.com',
      healthTrackers,
      blockLagMonitor,
      {
        preferPrimary: true,
        maxAcceptableLag: 5,
        maxAcceptableLatencyMs: 2000,
        maxAcceptableErrorRate: 0.1,
        requireArchiveForHistorical: true,
      },
    );
  });

  describe('provider selection', () => {
    it('should select primary provider when healthy', () => {
      const provider = selector.selectProvider();

      expect(provider).toBe('http://primary.com');
    });

    it('should select secondary when primary is unhealthy', () => {
      // Make primary unhealthy
      const primaryTracker = healthTrackers.get('http://primary.com');
      if (!primaryTracker) throw new Error('Primary tracker not found');
      primaryTracker.recordFailure();
      primaryTracker.recordFailure();
      primaryTracker.recordFailure();

      const provider = selector.selectProvider();

      expect(provider).toBe('http://secondary.com');
    });

    it('should return null when all providers are unhealthy', () => {
      // Make all providers unhealthy
      const primaryTracker = healthTrackers.get('http://primary.com');
      const secondaryTracker = healthTrackers.get('http://secondary.com');
      if (!primaryTracker) throw new Error('Primary tracker not found');
      if (!secondaryTracker) throw new Error('Secondary tracker not found');

      primaryTracker.recordFailure();
      primaryTracker.recordFailure();
      primaryTracker.recordFailure();

      secondaryTracker.recordFailure();
      secondaryTracker.recordFailure();
      secondaryTracker.recordFailure();

      const provider = selector.selectProvider();

      expect(provider).toBeNull();
    });
  });

  describe('provider preference', () => {
    it('should prefer primary when configured', () => {
      const provider = selector.selectProvider();

      expect(provider).toBe('http://primary.com');
    });

    it('should not prefer primary when not configured', () => {
      const noPreferenceSelector = new ProviderSelector(
        'http://primary.com',
        'http://secondary.com',
        'http://archive.com',
        healthTrackers,
        blockLagMonitor,
        {
          preferPrimary: false,
        },
      );

      // Both are healthy, should select based on other criteria
      const provider = noPreferenceSelector.selectProvider();

      expect(provider).toBeTruthy();
    });
  });

  describe('lag-based selection', () => {
    it('should prefer provider with lower lag', () => {
      blockLagMonitor.updateProviderBlock('http://primary.com', 100n);
      blockLagMonitor.updateProviderBlock('http://secondary.com', 105n);
      blockLagMonitor.updateNetworkHead(110n);

      const provider = selector.selectProvider();

      expect(provider).toBe('http://secondary.com');
    });

    it('should select provider with acceptable lag', () => {
      blockLagMonitor.updateProviderBlock('http://primary.com', 100n);
      blockLagMonitor.updateProviderBlock('http://secondary.com', 90n);
      blockLagMonitor.updateNetworkHead(110n);

      // Primary has lag 10 (unacceptable), secondary has lag 20 (unacceptable)
      // But primary is closer, so should be selected
      const provider = selector.selectProvider();

      expect(provider).toBe('http://primary.com');
    });
  });

  describe('latency-based selection', () => {
    it('should prefer provider with lower latency when lag is equal', () => {
      blockLagMonitor.updateProviderBlock('http://primary.com', 100n);
      blockLagMonitor.updateProviderBlock('http://secondary.com', 100n);
      blockLagMonitor.updateNetworkHead(105n);

      const primaryTracker = healthTrackers.get('http://primary.com');
      const secondaryTracker = healthTrackers.get('http://secondary.com');
      if (!primaryTracker) throw new Error('Primary tracker not found');
      if (!secondaryTracker) throw new Error('Secondary tracker not found');

      primaryTracker.recordSuccess(200);
      secondaryTracker.recordSuccess(100);

      const provider = selector.selectProvider();

      expect(provider).toBe('http://secondary.com');
    });
  });

  describe('error rate-based selection', () => {
    it('should prefer provider with lower error rate', () => {
      const now = Date.now();

      const primaryTracker = healthTrackers.get('http://primary.com');
      const secondaryTracker = healthTrackers.get('http://secondary.com');
      if (!primaryTracker) throw new Error('Primary tracker not found');
      if (!secondaryTracker) throw new Error('Secondary tracker not found');

      // Primary has higher error rate
      primaryTracker.recordRequest({
        method: 'eth_blockNumber',
        providerUrl: 'http://primary.com',
        durationMs: 100,
        success: false,
        timestamp: now,
      });

      secondaryTracker.recordRequest({
        method: 'eth_blockNumber',
        providerUrl: 'http://secondary.com',
        durationMs: 100,
        success: true,
        timestamp: now,
      });

      const provider = selector.selectProvider();

      expect(provider).toBe('http://secondary.com');
    });
  });

  describe('archive provider selection', () => {
    it('should select archive provider when required', () => {
      const archiveTracker = healthTrackers.get('http://archive.com');
      if (!archiveTracker) throw new Error('Archive tracker not found');
      archiveTracker.setArchiveCapable(true);

      const provider = selector.selectProvider(true);

      expect(provider).toBe('http://archive.com');
    });

    it('should not select archive provider when not capable', () => {
      const archiveTracker = healthTrackers.get('http://archive.com');
      if (!archiveTracker) throw new Error('Archive tracker not found');
      archiveTracker.setArchiveCapable(false);

      const provider = selector.selectProvider(true);

      // Should fall back to primary or secondary
      expect(provider).not.toBe('http://archive.com');
    });

    it('should select archive provider via selectArchiveProvider', () => {
      const archiveTracker = healthTrackers.get('http://archive.com');
      if (!archiveTracker) throw new Error('Archive tracker not found');
      archiveTracker.setArchiveCapable(true);

      const provider = selector.selectArchiveProvider();

      expect(provider).toBe('http://archive.com');
    });

    it('should return null from selectArchiveProvider when not capable', () => {
      const archiveTracker = healthTrackers.get('http://archive.com');
      if (!archiveTracker) throw new Error('Archive tracker not found');
      archiveTracker.setArchiveCapable(false);

      const provider = selector.selectArchiveProvider();

      expect(provider).toBeNull();
    });
  });

  describe('method-based selection', () => {
    it('should select archive for historical methods', () => {
      const archiveTracker = healthTrackers.get('http://archive.com');
      if (!archiveTracker) throw new Error('Archive tracker not found');
      archiveTracker.setArchiveCapable(true);

      const provider = selector.selectProviderForMethod('eth_getBlockByNumber');

      expect(provider).toBe('http://archive.com');
    });

    it('should not require archive for non-historical methods', () => {
      const provider = selector.selectProviderForMethod('eth_blockNumber');

      expect(provider).toBe('http://primary.com');
    });

    it('uses the primary for pinned reads when no archive provider is configured', () => {
      const noArchiveSelector = new ProviderSelector(
        'http://primary.com',
        'http://secondary.com',
        undefined,
        healthTrackers,
        blockLagMonitor,
        { requireArchiveForHistorical: false },
      );

      expect(noArchiveSelector.selectProviderForMethod('eth_getBlockByNumber')).toBe(
        'http://primary.com',
      );
    });
  });

  describe('fallback selection', () => {
    it('should select fallback provider', () => {
      const fallback = selector.selectFallbackProvider(['http://primary.com']);

      expect(fallback).toBe('http://secondary.com');
    });

    it('should exclude specified providers', () => {
      const fallback = selector.selectFallbackProvider([
        'http://primary.com',
        'http://secondary.com',
      ]);

      expect(fallback).toBe('http://archive.com');
    });

    it('should return null when no fallback available', () => {
      const fallback = selector.selectFallbackProvider([
        'http://primary.com',
        'http://secondary.com',
        'http://archive.com',
      ]);

      expect(fallback).toBeNull();
    });
  });

  describe('provider acceptability', () => {
    it('should determine provider is acceptable', () => {
      blockLagMonitor.updateProviderBlock('http://primary.com', 100n);
      blockLagMonitor.updateNetworkHead(103n);

      const primaryTracker = healthTrackers.get('http://primary.com');
      if (!primaryTracker) throw new Error('Primary tracker not found');
      primaryTracker.recordSuccess(100);

      expect(selector.isProviderAcceptable('http://primary.com')).toBe(true);
    });

    it('should determine provider is not acceptable due to lag', () => {
      blockLagMonitor.updateProviderBlock('http://primary.com', 100n);
      blockLagMonitor.updateNetworkHead(110n);

      expect(selector.isProviderAcceptable('http://primary.com')).toBe(false);
    });

    it('should determine provider is not acceptable due to latency', () => {
      blockLagMonitor.updateProviderBlock('http://primary.com', 100n);
      blockLagMonitor.updateNetworkHead(103n);

      const primaryTracker = healthTrackers.get('http://primary.com');
      if (!primaryTracker) throw new Error('Primary tracker not found');
      primaryTracker.recordSuccess(3000); // High latency

      expect(selector.isProviderAcceptable('http://primary.com')).toBe(false);
    });

    it('should determine provider is not acceptable when unhealthy', () => {
      const primaryTracker = healthTrackers.get('http://primary.com');
      if (!primaryTracker) throw new Error('Primary tracker not found');
      primaryTracker.recordFailure();
      primaryTracker.recordFailure();
      primaryTracker.recordFailure();

      expect(selector.isProviderAcceptable('http://primary.com')).toBe(false);
    });
  });

  describe('provider ranking', () => {
    it('should return provider ranking', () => {
      const ranking = selector.getProviderRanking();

      expect(ranking.length).toBeGreaterThan(0);
      expect(ranking[0]?.score).toBe(1);
    });

    it('should rank providers by preference', () => {
      blockLagMonitor.updateProviderBlock('http://primary.com', 100n);
      blockLagMonitor.updateProviderBlock('http://secondary.com', 105n);
      blockLagMonitor.updateNetworkHead(110n);

      const ranking = selector.getProviderRanking();

      // Secondary should be ranked higher due to lower lag
      const secondaryRank = ranking.find((r) => r.providerUrl === 'http://secondary.com');
      const primaryRank = ranking.find((r) => r.providerUrl === 'http://primary.com');

      expect(secondaryRank?.score).toBeLessThan(primaryRank?.score ?? Number.MAX_SAFE_INTEGER);
    });
  });

  describe('configuration', () => {
    it('should return configuration', () => {
      const config = selector.getConfig();

      expect(config.preferPrimary).toBe(true);
      expect(config.maxAcceptableLag).toBe(5);
      expect(config.maxAcceptableLatencyMs).toBe(2000);
      expect(config.maxAcceptableErrorRate).toBe(0.1);
      expect(config.requireArchiveForHistorical).toBe(true);
    });
  });
});
