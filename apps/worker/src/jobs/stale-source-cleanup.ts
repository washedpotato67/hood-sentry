export interface StaleSourceRepository {
  markStaleSources(observedBefore: Date): Promise<number>;
}

export class StaleSourceCleanupJob {
  constructor(private readonly repository: StaleSourceRepository) {}

  async run(input: { observedBefore: string }): Promise<{
    affected: number;
    idempotencyKey: string;
  }> {
    const cutoff = new Date(input.observedBefore);
    if (Number.isNaN(cutoff.getTime())) throw new Error('Stale-source cutoff is invalid');
    const affected = await this.repository.markStaleSources(cutoff);
    return { affected, idempotencyKey: `stale-source-cleanup:${cutoff.toISOString()}` };
  }
}
