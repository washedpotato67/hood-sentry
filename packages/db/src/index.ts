export const SCHEMA_VERSION = '0.1.0';

export { createDatabase, type Database } from './client.js';
export * as schema from './schema/index.js';
export * from './core/index.js';
export * from './repositories/index.js';
