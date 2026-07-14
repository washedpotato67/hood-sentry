import type { Hash } from 'viem';
import type { CircuitBreaker } from './circuit-breaker.js';
import type { ProviderHealth, ProviderMetrics, RPCRequestMetrics } from './types.js';

export class ProviderHealthTracker {
  private health: ProviderHealth;
  private metrics: ProviderMetrics;
  private requestHistory: RPCRequestMetrics[] = [];
  private readonly maxHistorySize = 1000;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(
    providerUrl: string,
    role: 'primary' | 'secondary' | 'archive',
    circuitBreaker: CircuitBreaker,
  ) {
    this.circuitBreaker = circuitBreaker;
    this.health = {
      providerUrl,
      role,
      isHealthy: true,
      circuitState: 'closed',
      latencyMs: null,
      lastBlockNumber: null,
      lastBlockHash: null,
      lastCheckTime: Date.now(),
      errorRate: 0,
      consecutiveFailures: 0,
      chainIdMatch: true,
      archiveCapable: null,
    };

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      errorRate: 0,
      circuitBreakerTrips: 0,
      failovers: 0,
      lastUpdated: Date.now(),
    };
  }

  recordRequest(metrics: RPCRequestMetrics): void {
    this.requestHistory.push(metrics);

    // Trim history if too large
    if (this.requestHistory.length > this.maxHistorySize) {
      this.requestHistory = this.requestHistory.slice(-this.maxHistorySize);
    }

    this.updateMetrics();
  }

  recordSuccess(latencyMs: number): void {
    this.health.consecutiveFailures = 0;
    this.health.latencyMs = latencyMs;
    this.health.lastCheckTime = Date.now();
    this.circuitBreaker.recordSuccess();
    this.health.circuitState = this.circuitBreaker.getCircuitState();
  }

  recordFailure(): void {
    this.health.consecutiveFailures++;
    this.health.lastCheckTime = Date.now();
    this.circuitBreaker.recordFailure();
    this.health.circuitState = this.circuitBreaker.getCircuitState();

    if (this.health.circuitState === 'open') {
      this.metrics.circuitBreakerTrips++;
    }
  }

  updateBlockInfo(blockNumber: bigint, blockHash: Hash): void {
    this.health.lastBlockNumber = blockNumber;
    this.health.lastBlockHash = blockHash;
    this.health.lastCheckTime = Date.now();
  }

  setChainIdMatch(matches: boolean): void {
    this.health.chainIdMatch = matches;
  }

  setArchiveCapable(capable: boolean): void {
    this.health.archiveCapable = capable;
  }

  recordFailover(): void {
    this.metrics.failovers++;
  }

  getHealth(): ProviderHealth {
    return { ...this.health };
  }

  getMetrics(): ProviderMetrics {
    return { ...this.metrics };
  }

  isHealthy(): boolean {
    return this.health.isHealthy && this.health.chainIdMatch && this.health.circuitState !== 'open';
  }

  private updateMetrics(): void {
    const now = Date.now();
    const recentRequests = this.requestHistory.filter(
      (r) => now - r.timestamp < 60000, // Last 60 seconds
    );

    this.metrics.totalRequests = this.requestHistory.length;
    this.metrics.successfulRequests = this.requestHistory.filter((r) => r.success).length;
    this.metrics.failedRequests = this.requestHistory.filter((r) => !r.success).length;

    if (recentRequests.length > 0) {
      // Calculate latency percentiles
      const latencies = recentRequests.map((r) => r.durationMs).sort((a, b) => a - b);

      this.metrics.averageLatencyMs = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;

      this.metrics.p95LatencyMs = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
      this.metrics.p99LatencyMs = latencies[Math.floor(latencies.length * 0.99)] ?? 0;

      // Calculate error rate
      const recentFailures = recentRequests.filter((r) => !r.success).length;
      this.metrics.errorRate = recentFailures / recentRequests.length;
      this.health.errorRate = this.metrics.errorRate;
    }

    this.metrics.lastUpdated = now;
  }

  reset(): void {
    this.health = {
      providerUrl: this.health.providerUrl,
      role: this.health.role,
      isHealthy: true,
      circuitState: 'closed',
      latencyMs: null,
      lastBlockNumber: null,
      lastBlockHash: null,
      lastCheckTime: Date.now(),
      errorRate: 0,
      consecutiveFailures: 0,
      chainIdMatch: true,
      archiveCapable: null,
    };

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      errorRate: 0,
      circuitBreakerTrips: 0,
      failovers: 0,
      lastUpdated: Date.now(),
    };

    this.requestHistory = [];
    this.circuitBreaker.reset();
  }
}
