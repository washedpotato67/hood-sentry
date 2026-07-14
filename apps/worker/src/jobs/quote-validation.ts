import type { NormalizedQuote, ProtocolAdapterManager } from '@hood-sentry/chain';
import type { ProtocolRepository } from '@hood-sentry/db';

export interface QuoteValidationJobData {
  quote: NormalizedQuote;
  currentBlockNumber: bigint;
  maximumBlockLag: bigint;
  now: string;
}

export class QuoteValidationJob {
  constructor(
    private readonly manager: ProtocolAdapterManager,
    private readonly repository: Pick<ProtocolRepository, 'saveQuote'>,
  ) {}

  async run(data: QuoteValidationJobData): Promise<{ valid: true; idempotencyKey: string }> {
    const quote = data.quote;
    if (new Date(quote.expiresAt).getTime() <= new Date(data.now).getTime()) {
      throw new Error('Quote expired before validation');
    }
    if (data.currentBlockNumber < quote.sourceBlockNumber) {
      throw new Error('Quote source block is ahead of the current block');
    }
    if (data.currentBlockNumber - quote.sourceBlockNumber > data.maximumBlockLag) {
      throw new Error('Quote source block is stale');
    }
    const adapter = this.manager.getAdapter(
      quote.protocolKey,
      quote.protocolVersion,
      quote.chainId,
    );
    const validation = await adapter.validateConfiguration();
    if (!validation.active) throw new Error('Quote protocol is inactive');
    await this.repository.saveQuote(quote);
    return { valid: true, idempotencyKey: quote.quoteId };
  }
}
