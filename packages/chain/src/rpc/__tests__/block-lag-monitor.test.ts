import { beforeEach, describe, expect, it } from 'vitest';
import { BlockLagMonitor } from '../block-lag-monitor.js';

describe('BlockLagMonitor', () => {
  let monitor: BlockLagMonitor;

  beforeEach(() => {
    monitor = new BlockLagMonitor({
      maxAcceptableLag: 5,
      staleThreshold: 10,
      checkIntervalMs: 10000,
    });
  });

  describe('provider block updates', () => {
    it('should track provider blocks', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);

      expect(monitor.getProviderBlock('http://primary.com')).toBe(100n);
    });

    it('should update provider blocks', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateProviderBlock('http://primary.com', 101n);

      expect(monitor.getProviderBlock('http://primary.com')).toBe(101n);
    });

    it('should track multiple providers', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateProviderBlock('http://secondary.com', 99n);

      expect(monitor.getProviderBlock('http://primary.com')).toBe(100n);
      expect(monitor.getProviderBlock('http://secondary.com')).toBe(99n);
    });
  });

  describe('network head updates', () => {
    it('should update network head', () => {
      monitor.updateNetworkHead(100n);

      expect(monitor.getNetworkHead()).toBe(100n);
    });

    it('should only increase network head', () => {
      monitor.updateNetworkHead(100n);
      monitor.updateNetworkHead(99n);

      expect(monitor.getNetworkHead()).toBe(100n);
    });

    it('should update lag when network head changes', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateNetworkHead(105n);

      expect(monitor.getLag('http://primary.com')).toBe(5);
    });
  });

  describe('lag calculation', () => {
    it('should calculate lag correctly', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateNetworkHead(105n);

      expect(monitor.getLag('http://primary.com')).toBe(5);
    });

    it('should return 0 for negative lag', () => {
      monitor.updateProviderBlock('http://primary.com', 110n);
      monitor.updateNetworkHead(105n);

      expect(monitor.getLag('http://primary.com')).toBe(0);
    });

    it('should return MAX_SAFE_INTEGER for unknown provider', () => {
      expect(monitor.getLag('http://unknown.com')).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('provider staleness', () => {
    it('should detect stale providers', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateNetworkHead(115n);

      expect(monitor.isProviderStale('http://primary.com')).toBe(true);
    });

    it('should detect non-stale providers', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateNetworkHead(105n);

      expect(monitor.isProviderStale('http://primary.com')).toBe(false);
    });

    it('should use staleThreshold from config', () => {
      const customMonitor = new BlockLagMonitor({
        maxAcceptableLag: 5,
        staleThreshold: 20,
        checkIntervalMs: 10000,
      });

      customMonitor.updateProviderBlock('http://primary.com', 100n);
      customMonitor.updateNetworkHead(115n);

      expect(customMonitor.isProviderStale('http://primary.com')).toBe(false);
    });
  });

  describe('provider acceptability', () => {
    it('should detect acceptable providers', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateNetworkHead(103n);

      expect(monitor.isProviderAcceptable('http://primary.com')).toBe(true);
    });

    it('should detect unacceptable providers', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateNetworkHead(110n);

      expect(monitor.isProviderAcceptable('http://primary.com')).toBe(false);
    });

    it('should use maxAcceptableLag from config', () => {
      const customMonitor = new BlockLagMonitor({
        maxAcceptableLag: 10,
        staleThreshold: 20,
        checkIntervalMs: 10000,
      });

      customMonitor.updateProviderBlock('http://primary.com', 100n);
      customMonitor.updateNetworkHead(108n);

      expect(customMonitor.isProviderAcceptable('http://primary.com')).toBe(true);
    });
  });

  describe('lag metrics', () => {
    it('should return lag metrics', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateNetworkHead(105n);

      const metrics = monitor.getLagMetrics('http://primary.com');

      expect(metrics).not.toBeNull();
      expect(metrics?.providerUrl).toBe('http://primary.com');
      expect(metrics?.currentBlock).toBe(100n);
      expect(metrics?.expectedBlock).toBe(105n);
      expect(metrics?.lag).toBe(5);
      expect(metrics?.timestamp).toBeGreaterThan(0);
    });

    it('should return null for unknown provider', () => {
      const metrics = monitor.getLagMetrics('http://unknown.com');

      expect(metrics).toBeNull();
    });
  });

  describe('lag history', () => {
    it('should track lag history', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateNetworkHead(105n);

      monitor.updateProviderBlock('http://primary.com', 101n);
      monitor.updateNetworkHead(106n);

      const history = monitor.getLagHistory('http://primary.com');

      expect(history.length).toBe(2);
      expect(history[0]?.lag).toBe(5);
      expect(history[1]?.lag).toBe(5);
    });

    it('should calculate average lag', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateNetworkHead(105n);

      monitor.updateProviderBlock('http://primary.com', 101n);
      monitor.updateNetworkHead(108n);

      const avgLag = monitor.getAverageLag('http://primary.com');

      expect(avgLag).toBe(6); // (5 + 7) / 2
    });

    it('should calculate max lag', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateNetworkHead(105n);

      monitor.updateProviderBlock('http://primary.com', 101n);
      monitor.updateNetworkHead(110n);

      const maxLag = monitor.getMaxLag('http://primary.com');

      expect(maxLag).toBe(9);
    });

    it('should return 0 for empty history', () => {
      expect(monitor.getAverageLag('http://unknown.com')).toBe(0);
      expect(monitor.getMaxLag('http://unknown.com')).toBe(0);
    });
  });

  describe('provider lag queries', () => {
    it('should get all provider lags', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateProviderBlock('http://secondary.com', 98n);
      monitor.updateNetworkHead(105n);

      const lags = monitor.getAllProviderLags();

      expect(lags.size).toBe(2);
      expect(lags.get('http://primary.com')).toBe(5);
      expect(lags.get('http://secondary.com')).toBe(7);
    });

    it('should get providers with acceptable lag', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateProviderBlock('http://secondary.com', 90n);
      monitor.updateNetworkHead(105n);

      const acceptable = monitor.getProvidersWithAcceptableLag();

      expect(acceptable).toContain('http://primary.com');
      expect(acceptable).not.toContain('http://secondary.com');
    });

    it('should get providers with stale lag', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateProviderBlock('http://secondary.com', 90n);
      monitor.updateNetworkHead(105n);

      const stale = monitor.getProvidersWithStaleLag();

      expect(stale).not.toContain('http://primary.com');
      expect(stale).toContain('http://secondary.com');
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      monitor.updateProviderBlock('http://primary.com', 100n);
      monitor.updateNetworkHead(105n);

      monitor.reset();

      expect(monitor.getNetworkHead()).toBe(0n);
      expect(monitor.getProviderBlock('http://primary.com')).toBeUndefined();
      expect(monitor.getLagHistory('http://primary.com')).toEqual([]);
    });
  });

  describe('configuration', () => {
    it('should return configuration', () => {
      const config = monitor.getConfig();

      expect(config.maxAcceptableLag).toBe(5);
      expect(config.staleThreshold).toBe(10);
      expect(config.checkIntervalMs).toBe(10000);
    });

    it('should use default configuration when not provided', () => {
      const defaultMonitor = new BlockLagMonitor();
      const config = defaultMonitor.getConfig();

      expect(config.maxAcceptableLag).toBe(5);
      expect(config.staleThreshold).toBe(10);
      expect(config.checkIntervalMs).toBe(10000);
    });
  });
});
