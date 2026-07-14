import type { NormalizedLiquidityEvent, RawChainLog } from '../types.js';

export interface LiquidityDecoder {
  decodeLiquidityEvent(log: RawChainLog): Promise<NormalizedLiquidityEvent | null>;
}

export type { NormalizedLiquidityEvent, NormalizedLiquidityEventType } from '../types.js';
