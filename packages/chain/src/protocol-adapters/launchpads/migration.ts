import type { LaunchpadMigration, RawChainLog } from '../types.js';

export interface MigrationDecoder {
  decodeMigration(log: RawChainLog): Promise<LaunchpadMigration | null>;
}

export type { LaunchpadMigration } from '../types.js';
