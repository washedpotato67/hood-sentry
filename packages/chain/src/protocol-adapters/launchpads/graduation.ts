import type { LaunchpadGraduation, RawChainLog } from '../types.js';

export interface GraduationDecoder {
  decodeGraduation(log: RawChainLog): Promise<LaunchpadGraduation | null>;
}

export type { LaunchpadGraduation } from '../types.js';
