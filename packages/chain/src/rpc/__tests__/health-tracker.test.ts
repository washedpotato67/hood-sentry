import type { Hash } from 'viem';
import { beforeEach, describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../circuit-breaker.js';
import { ProviderHealthTracker } from '../health-tracker.js';
import type { RPCRequestMetrics } from '../types.js';

describe('ProviderHealthTracker', () => {
  let tracker: ProviderHealthTracker;
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker('http://test.com', {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxRequests: 2,
    });
    tracker = new ProviderHealthTracker('http://test.com', 'primary', circuitBreaker);
  });

  describe('initial state', () => {
    it('should start healthy', () => {
      expect(tracker.isHealthy()).toBe(true);
    });

    it('should have correct initial health', () => {
      const health = tracker.getHealth();

      expect(health.providerUrl).toBe('http://test.com');
      expect(health.role).toBe('primary');
      expect(health.isHealthy).toBe(true);
      expect(health.circuitState).toBe('closed');
      expect(health.latencyMs).toBeNull();
      expect(health.lastBlockNumber).toBeNull();
      expect(health.lastBlockHash).toBeNull();
      expect(health.errorRate).toBe(0);
      expect(health.consecutiveFailures).toBe(0);
      expect(health.chainIdMatch).toBe(true);
      expect(health.archiveCapable).toBeNull();
    });

    it('should have correct initial metrics', () => {
      const metrics = tracker.getMetrics();

      expect(metrics.totalRequests).toBe(0);
      expect(metrics.successfulRequests).toBe(0);
      expect(metrics.failedRequests).toBe(0);
      expect(metrics.averageLatencyMs).toBe(0);
      expect(metrics.p95LatencyMs).toBe(0);
      expect(metrics.p99LatencyMs).toBe(0);
      expect(metrics.errorRate).toBe(0);
      expect(metrics.circuitBreakerTrips).toBe(0);
      expect(metrics.failovers).toBe(0);
    });
  });

  describe('recording success', () => {
    it('should record success', () => {
      tracker.recordSuccess(100);

      const health = tracker.getHealth();
      expect(health.latencyMs).toBe(100);
      expect(health.consecutiveFailures).toBe(0);
    });

    it('should reset consecutive failures on success', () => {
      tracker.recordFailure();
      tracker.recordFailure();
      tracker.recordSuccess(100);

      const health = tracker.getHealth();
      expect(health.consecutiveFailures).toBe(0);
    });

    it('should update circuit breaker on success', () => {
      tracker.recordFailure();
      tracker.recordFailure();
      tracker.recordSuccess(100);

      const state = circuitBreaker.getState();
      expect(state.failureCount).toBe(0);
    });
  });

  describe('recording failure', () => {
    it('should record failure', () => {
      tracker.recordFailure();

      const health = tracker.getHealth();
      expect(health.consecutiveFailures).toBe(1);
    });

    it('should increment consecutive failures', () => {
      tracker.recordFailure();
      tracker.recordFailure();
      tracker.recordFailure();

      const health = tracker.getHealth();
      expect(health.consecutiveFailures).toBe(3);
    });

    it('should update circuit breaker on failure', () => {
      tracker.recordFailure();
      tracker.recordFailure();
      tracker.recordFailure();

      const state = circuitBreaker.getState();
      expect(state.failureCount).toBe(3);
      expect(state.state).toBe('open');
    });

    it('should track circuit breaker trips', () => {
      tracker.recordFailure();
      tracker.recordFailure();
      tracker.recordFailure();

      const metrics = tracker.getMetrics();
      expect(metrics.circuitBreakerTrips).toBe(1);
    });
  });

  describe('recording requests', () => {
    it('should record request metrics', () => {
      const metrics: RPCRequestMetrics = {
        method: 'eth_blockNumber',
        providerUrl: 'http://test.com',
        durationMs: 100,
        success: true,
        timestamp: Date.now(),
      };

      tracker.recordRequest(metrics);

      const providerMetrics = tracker.getMetrics();
      expect(providerMetrics.totalRequests).toBe(1);
      expect(providerMetrics.successfulRequests).toBe(1);
      expect(providerMetrics.failedRequests).toBe(0);
    });

    it('should calculate average latency', () => {
      const now = Date.now();

      tracker.recordRequest({
        method: 'eth_blockNumber',
        providerUrl: 'http://test.com',
        durationMs: 100,
        success: true,
        timestamp: now,
      });

      tracker.recordRequest({
        method: 'eth_blockNumber',
        providerUrl: 'http://test.com',
        durationMs: 200,
        success: true,
        timestamp: now,
      });

      const metrics = tracker.getMetrics();
      expect(metrics.averageLatencyMs).toBe(150);
    });

    it('should calculate error rate', () => {
      const now = Date.now();

      tracker.recordRequest({
        method: 'eth_blockNumber',
        providerUrl: 'http://test.com',
        durationMs: 100,
        success: true,
        timestamp: now,
      });

      tracker.recordRequest({
        method: 'eth_blockNumber',
        providerUrl: 'http://test.com',
        durationMs: 100,
        success: false,
        timestamp: now,
      });

      const metrics = tracker.getMetrics();
      expect(metrics.errorRate).toBe(0.5);
    });

    it('should calculate p95 and p99 latency', () => {
      const now = Date.now();

      // Record 100 requests with increasing latency
      for (let i = 0; i < 100; i++) {
        tracker.recordRequest({
          method: 'eth_blockNumber',
          providerUrl: 'http://test.com',
          durationMs: i * 10,
          success: true,
          timestamp: now,
        });
      }

      const metrics = tracker.getMetrics();
      expect(metrics.p95LatencyMs).toBeGreaterThan(0);
      expect(metrics.p99LatencyMs).toBeGreaterThan(metrics.p95LatencyMs);
    });
  });

  describe('block info updates', () => {
    it('should update block info', () => {
      tracker.updateBlockInfo(100n, '0xabc' as Hash);

      const health = tracker.getHealth();
      expect(health.lastBlockNumber).toBe(100n);
      expect(health.lastBlockHash).toBe('0xabc');
    });
  });

  describe('chain ID matching', () => {
    it('should set chain ID match', () => {
      tracker.setChainIdMatch(false);

      const health = tracker.getHealth();
      expect(health.chainIdMatch).toBe(false);
      expect(tracker.isHealthy()).toBe(false);
    });

    it('should be unhealthy when chain ID does not match', () => {
      tracker.setChainIdMatch(false);

      expect(tracker.isHealthy()).toBe(false);
    });
  });

  describe('archive capability', () => {
    it('should set archive capability', () => {
      tracker.setArchiveCapable(true);

      const health = tracker.getHealth();
      expect(health.archiveCapable).toBe(true);
    });

    it('should set archive incapable', () => {
      tracker.setArchiveCapable(false);

      const health = tracker.getHealth();
      expect(health.archiveCapable).toBe(false);
    });
  });

  describe('failover tracking', () => {
    it('should record failovers', () => {
      tracker.recordFailover();
      tracker.recordFailover();

      const metrics = tracker.getMetrics();
      expect(metrics.failovers).toBe(2);
    });
  });

  describe('health determination', () => {
    it('should be healthy when all conditions met', () => {
      expect(tracker.isHealthy()).toBe(true);
    });

    it('should be unhealthy when circuit breaker is open', () => {
      tracker.recordFailure();
      tracker.recordFailure();
      tracker.recordFailure();

      expect(tracker.isHealthy()).toBe(false);
    });

    it('should be unhealthy when chain ID does not match', () => {
      tracker.setChainIdMatch(false);

      expect(tracker.isHealthy()).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      tracker.recordFailure();
      tracker.recordFailure();
      tracker.updateBlockInfo(100n, '0xabc' as Hash);
      tracker.recordFailover();

      tracker.reset();

      const health = tracker.getHealth();
      expect(health.consecutiveFailures).toBe(0);
      expect(health.lastBlockNumber).toBeNull();
      expect(health.circuitState).toBe('closed');

      const metrics = tracker.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.failovers).toBe(0);
    });
  });

  describe('getHealth and getMetrics', () => {
    it('should return copies of health and metrics', () => {
      const health1 = tracker.getHealth();
      const health2 = tracker.getHealth();

      expect(health1).toEqual(health2);
      expect(health1).not.toBe(health2);

      const metrics1 = tracker.getMetrics();
      const metrics2 = tracker.getMetrics();

      expect(metrics1).toEqual(metrics2);
      expect(metrics1).not.toBe(metrics2);
    });
  });
});
