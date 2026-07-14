import type { BlockLagMetrics } from './types.js';

export interface BlockLagMonitorConfig {
  maxAcceptableLag: number;
  staleThreshold: number;
  checkIntervalMs: number;
}

export class BlockLagMonitor {
  private providerBlocks: Map<string, bigint> = new Map();
  private networkHead = 0n;
  private lagHistory: Map<string, BlockLagMetrics[]> = new Map();
  private readonly config: BlockLagMonitorConfig;
  private readonly maxHistorySize = 100;

  constructor(config: Partial<BlockLagMonitorConfig> = {}) {
    this.config = {
      maxAcceptableLag: config.maxAcceptableLag ?? 5,
      staleThreshold: config.staleThreshold ?? 10,
      checkIntervalMs: config.checkIntervalMs ?? 10000,
    };
  }

  updateProviderBlock(providerUrl: string, blockNumber: bigint): void {
    this.providerBlocks.set(providerUrl, blockNumber);
    // Don't automatically record lag here - only record when network head changes
    // or when explicitly requested via getLagMetrics
  }

  updateNetworkHead(blockNumber: bigint): void {
    if (blockNumber > this.networkHead) {
      this.networkHead = blockNumber;
      // Update lag for all providers
      for (const [providerUrl, providerBlock] of this.providerBlocks.entries()) {
        this.recordLag(providerUrl, providerBlock);
      }
    }
  }

  getNetworkHead(): bigint {
    return this.networkHead;
  }

  getProviderBlock(providerUrl: string): bigint | undefined {
    return this.providerBlocks.get(providerUrl);
  }

  getLag(providerUrl: string): number {
    const providerBlock = this.providerBlocks.get(providerUrl);
    if (providerBlock === undefined) {
      return Number.MAX_SAFE_INTEGER;
    }

    const lag = Number(this.networkHead - providerBlock);
    return lag < 0 ? 0 : lag;
  }

  isProviderStale(providerUrl: string): boolean {
    const lag = this.getLag(providerUrl);
    return lag > this.config.staleThreshold;
  }

  isProviderAcceptable(providerUrl: string): boolean {
    const lag = this.getLag(providerUrl);
    return lag <= this.config.maxAcceptableLag;
  }

  getLagMetrics(providerUrl: string): BlockLagMetrics | null {
    const providerBlock = this.providerBlocks.get(providerUrl);
    if (providerBlock === undefined) {
      return null;
    }

    const lag = Number(this.networkHead - providerBlock);

    return {
      providerUrl,
      currentBlock: providerBlock,
      expectedBlock: this.networkHead,
      lag: lag < 0 ? 0 : lag,
      timestamp: Date.now(),
    };
  }

  getLagHistory(providerUrl: string): BlockLagMetrics[] {
    return this.lagHistory.get(providerUrl) ?? [];
  }

  getAverageLag(providerUrl: string): number {
    const history = this.lagHistory.get(providerUrl);
    if (!history || history.length === 0) {
      return 0;
    }

    const sum = history.reduce((acc, m) => acc + m.lag, 0);
    return sum / history.length;
  }

  getMaxLag(providerUrl: string): number {
    const history = this.lagHistory.get(providerUrl);
    if (!history || history.length === 0) {
      return 0;
    }

    return Math.max(...history.map((m) => m.lag));
  }

  getAllProviderLags(): Map<string, number> {
    const lags = new Map<string, number>();
    for (const providerUrl of this.providerBlocks.keys()) {
      lags.set(providerUrl, this.getLag(providerUrl));
    }
    return lags;
  }

  getProvidersWithAcceptableLag(): string[] {
    const providers: string[] = [];
    for (const providerUrl of this.providerBlocks.keys()) {
      if (this.isProviderAcceptable(providerUrl)) {
        providers.push(providerUrl);
      }
    }
    return providers;
  }

  getProvidersWithStaleLag(): string[] {
    const providers: string[] = [];
    for (const providerUrl of this.providerBlocks.keys()) {
      if (this.isProviderStale(providerUrl)) {
        providers.push(providerUrl);
      }
    }
    return providers;
  }

  private recordLag(providerUrl: string, providerBlock: bigint): void {
    const lag = Number(this.networkHead - providerBlock);
    const metrics: BlockLagMetrics = {
      providerUrl,
      currentBlock: providerBlock,
      expectedBlock: this.networkHead,
      lag: lag < 0 ? 0 : lag,
      timestamp: Date.now(),
    };

    if (!this.lagHistory.has(providerUrl)) {
      this.lagHistory.set(providerUrl, []);
    }

    const history = this.lagHistory.get(providerUrl);
    if (history) {
      history.push(metrics);

      // Trim history if too large
      if (history.length > this.maxHistorySize) {
        this.lagHistory.set(providerUrl, history.slice(-this.maxHistorySize));
      }
    }
  }

  reset(): void {
    this.providerBlocks.clear();
    this.networkHead = 0n;
    this.lagHistory.clear();
  }

  getConfig(): BlockLagMonitorConfig {
    return { ...this.config };
  }
}
