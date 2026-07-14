import type { Address } from 'viem';
import type { NormalizedQuote, PreparedProtocolTransaction } from '../types.js';

export interface TransactionAdapter {
  prepareSwapTransaction(
    quote: NormalizedQuote,
    userAddress: Address,
  ): Promise<PreparedProtocolTransaction>;
}

export type { PreparedProtocolTransaction, TransactionFeaturePolicy } from '../types.js';
