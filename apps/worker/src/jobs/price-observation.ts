import {
  type PriceEvidence,
  type PriceObservation,
  type PriceSourceConfig,
  evaluateObservation,
} from '@hood-sentry/market-engine';

export interface PriceObservationWriter {
  saveObservation(observation: PriceObservation): Promise<void>;
}

export class NewPriceObservationJob {
  constructor(private readonly repository: PriceObservationWriter) {}

  async run(input: {
    config: PriceSourceConfig;
    evidence: PriceEvidence;
    previousPriceRaw?: bigint | null;
  }): Promise<{ observation: PriceObservation; idempotencyKey: string }> {
    const observation = evaluateObservation(
      input.config,
      input.evidence,
      input.previousPriceRaw ?? null,
    );
    await this.repository.saveObservation(observation);
    return { observation, idempotencyKey: observation.observationKey };
  }
}
