import {
  type PriceObservation,
  type PriceSourceConfig,
  type SourceSelectionResult,
  selectPriceSource,
} from '@hood-sentry/market-engine';

export class SourceReconciliationJob {
  async run(input: {
    configs: readonly PriceSourceConfig[];
    observations: readonly PriceObservation[];
    observedAt: string;
  }): Promise<{ result: SourceSelectionResult; idempotencyKey: string }> {
    const result = selectPriceSource(input.configs, input.observations, input.observedAt);
    return {
      result,
      idempotencyKey: `reconcile:${result.selected.chainId}:${result.selected.tokenAddress}:${result.selected.quoteAssetAddress}:${input.observedAt}`,
    };
  }
}
