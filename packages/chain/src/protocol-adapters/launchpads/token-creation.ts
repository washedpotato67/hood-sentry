import type { LaunchpadTokenCreated, RawChainLog } from '../types.js';

export interface TokenCreationDecoder {
  decodeTokenCreation(log: RawChainLog): Promise<LaunchpadTokenCreated | null>;
}

export type { LaunchpadTokenCreated } from '../types.js';
