import type {
  NormalizedQuote,
  PriceImpactRequest,
  PriceImpactResult,
  QuoteRequest,
} from '../types.js';

export interface QuoteAdapter {
  getQuote(request: QuoteRequest): Promise<NormalizedQuote>;
  calculatePriceImpact(request: PriceImpactRequest): PriceImpactResult;
}

export type {
  NormalizedQuote,
  NormalizedRouteStep,
  PriceImpactRequest,
  PriceImpactResult,
  QuoteRequest,
  QuoteWarning,
} from '../types.js';
