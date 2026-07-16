import type { BlockLagMonitor } from './block-lag-monitor.js';
import type { ProviderHealthTracker } from './health-tracker.js';
import type { ProviderHealth } from './types.js';

export interface ProviderSelectorConfig {
  preferPrimary: boolean;
  maxAcceptableLag: number;
  maxAcceptableLatencyMs: number;
  maxAcceptableErrorRate: number;
  requireArchiveForHistorical: boolean;
}

export class ProviderSelector {
  private readonly config: ProviderSelectorConfig;
  private readonly healthTrackers: Map<string, ProviderHealthTracker>;
  private readonly blockLagMonitor: BlockLagMonitor;
  private readonly primaryUrl: string;
  private readonly secondaryUrl?: string;
  private readonly archiveUrl?: string;

  constructor(
    primaryUrl: string,
    secondaryUrl: string | undefined,
    archiveUrl: string | undefined,
    healthTrackers: Map<string, ProviderHealthTracker>,
    blockLagMonitor: BlockLagMonitor,
    config: Partial<ProviderSelectorConfig> = {},
  ) {
    this.primaryUrl = primaryUrl;
    this.secondaryUrl = secondaryUrl;
    this.archiveUrl = archiveUrl;
    this.healthTrackers = healthTrackers;
    this.blockLagMonitor = blockLagMonitor;

    this.config = {
      preferPrimary: config.preferPrimary ?? true,
      maxAcceptableLag: config.maxAcceptableLag ?? 5,
      maxAcceptableLatencyMs: config.maxAcceptableLatencyMs ?? 2000,
      maxAcceptableErrorRate: config.maxAcceptableErrorRate ?? 0.1,
      requireArchiveForHistorical: config.requireArchiveForHistorical ?? true,
    };
  }

  selectProvider(requireArchive = false): string | null {
    const candidates = this.getCandidateProviders(requireArchive);

    if (candidates.length === 0) {
      return null;
    }

    // Sort by preference
    candidates.sort((a, b) => this.compareProviders(a, b));

    return candidates[0]?.providerUrl ?? null;
  }

  selectProviderForMethod(method: string): string | null {
    const requireArchive = this.isHistoricalMethod(method);
    return this.selectProvider(requireArchive);
  }

  selectFallbackProvider(excludeUrls: string[] = []): string | null {
    const candidates = this.getCandidateProviders(false).filter(
      (p) => !excludeUrls.includes(p.providerUrl),
    );

    // Also include archive provider as a fallback option
    if (this.archiveUrl && !excludeUrls.includes(this.archiveUrl)) {
      const archiveTracker = this.healthTrackers.get(this.archiveUrl);
      if (archiveTracker?.isHealthy()) {
        const health = archiveTracker.getHealth();
        // Only add if not already in candidates
        if (!candidates.some((c) => c.providerUrl === this.archiveUrl)) {
          candidates.push(health);
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => this.compareProviders(a, b));

    return candidates[0]?.providerUrl ?? null;
  }

  selectArchiveProvider(): string | null {
    if (!this.archiveUrl) {
      return null;
    }

    const tracker = this.healthTrackers.get(this.archiveUrl);
    if (!tracker || !tracker.isHealthy()) {
      return null;
    }

    const health = tracker.getHealth();
    if (health.archiveCapable === false) {
      return null;
    }

    return this.archiveUrl;
  }

  private getCandidateProviders(requireArchive: boolean): ProviderHealth[] {
    const candidates: ProviderHealth[] = [];

    this.addProviderIfEligible(candidates, this.primaryUrl, requireArchive);

    if (this.secondaryUrl) {
      this.addProviderIfEligible(candidates, this.secondaryUrl, requireArchive);
    }

    if (requireArchive && this.archiveUrl) {
      this.addArchiveProviderIfEligible(candidates, this.archiveUrl);
    }

    return candidates;
  }

  private addProviderIfEligible(
    candidates: ProviderHealth[],
    providerUrl: string,
    requireArchive: boolean,
  ): void {
    const tracker = this.healthTrackers.get(providerUrl);
    if (!tracker?.isHealthy()) {
      return;
    }

    const health = tracker.getHealth();
    if (!requireArchive || health.archiveCapable === true) {
      candidates.push(health);
    }
  }

  private addArchiveProviderIfEligible(candidates: ProviderHealth[], archiveUrl: string): void {
    const tracker = this.healthTrackers.get(archiveUrl);
    if (!tracker?.isHealthy()) {
      return;
    }

    const health = tracker.getHealth();
    if (health.archiveCapable === true) {
      candidates.push(health);
    }
  }

  private compareProviders(a: ProviderHealth, b: ProviderHealth): number {
    // Compare lag
    const lagA = this.blockLagMonitor.getLag(a.providerUrl);
    const lagB = this.blockLagMonitor.getLag(b.providerUrl);

    if (lagA !== lagB) {
      return lagA - lagB; // Lower lag is better
    }

    // Compare latency
    const latencyA = a.latencyMs ?? Number.MAX_SAFE_INTEGER;
    const latencyB = b.latencyMs ?? Number.MAX_SAFE_INTEGER;

    if (latencyA !== latencyB) {
      return latencyA - latencyB; // Lower latency is better
    }

    // Compare error rate
    if (a.errorRate !== b.errorRate) {
      return a.errorRate - b.errorRate; // Lower error rate is better
    }

    // Compare consecutive failures
    if (a.consecutiveFailures !== b.consecutiveFailures) {
      return a.consecutiveFailures - b.consecutiveFailures; // Fewer failures is better
    }

    // Prefer primary if configured (tiebreaker)
    if (this.config.preferPrimary) {
      if (a.role === 'primary' && b.role !== 'primary') return -1;
      if (b.role === 'primary' && a.role !== 'primary') return 1;
    }

    return 0;
  }

  private isHistoricalMethod(method: string): boolean {
    if (!this.config.requireArchiveForHistorical) return false;
    const historicalMethods = [
      'eth_getBlockByNumber',
      'eth_getBlockByHash',
      'eth_getTransactionByHash',
      'eth_getTransactionReceipt',
      'eth_getLogs',
      'eth_getCode',
      'eth_call',
    ];

    return historicalMethods.includes(method);
  }

  isProviderAcceptable(providerUrl: string): boolean {
    const tracker = this.healthTrackers.get(providerUrl);
    if (!tracker || !tracker.isHealthy()) {
      return false;
    }

    const health = tracker.getHealth();
    const lag = this.blockLagMonitor.getLag(providerUrl);
    const latency = health.latencyMs ?? Number.MAX_SAFE_INTEGER;

    return (
      lag <= this.config.maxAcceptableLag &&
      latency <= this.config.maxAcceptableLatencyMs &&
      health.errorRate <= this.config.maxAcceptableErrorRate
    );
  }

  getProviderRanking(): Array<{ providerUrl: string; role: string; score: number }> {
    const candidates = this.getCandidateProviders(false);

    candidates.sort((a, b) => this.compareProviders(a, b));

    return candidates.map((c, index) => ({
      providerUrl: c.providerUrl,
      role: c.role,
      score: index + 1,
    }));
  }

  getConfig(): ProviderSelectorConfig {
    return { ...this.config };
  }
}
