import {
  type OutlierInput,
  type OutlierResult,
  type PriceObservation,
  detectOutliers,
} from '@hood-sentry/market-engine';

export interface OutlierObservationWriter {
  saveObservation(observation: PriceObservation): Promise<void>;
}

export class OutlierDetectionJob {
  constructor(private readonly repository: OutlierObservationWriter) {}

  async run(input: OutlierInput): Promise<{ result: OutlierResult; idempotencyKey: string }> {
    const result = detectOutliers(input);
    await this.repository.saveObservation({
      ...input.observation,
      confidenceBps: result.confidenceBps,
      status:
        result.available && result.reasons.length === 0
          ? 'available'
          : result.available
            ? 'lowConfidence'
            : 'unavailable',
      authoritative: input.observation.authoritative && result.reasons.length === 0,
      reasons: result.reasons,
    });
    return { result, idempotencyKey: `outliers:${input.observation.observationKey}` };
  }
}
