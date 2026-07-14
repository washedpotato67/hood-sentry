import type { NormalizedSwap, RawChainLog } from '../types.js';

export interface SwapDecoder {
  decodeSwap(log: RawChainLog): Promise<NormalizedSwap | null>;
}

export type { NormalizedSwap } from '../types.js';
