import type { PriceSourceConfig } from './types.js';

export const PRICE_REGISTRY_VERSION = '1.0.0';

// No production oracle proxy, launchpad, pool, or external provider has passed
// independent source, address, bytecode, and freshness verification yet.
export const productionPriceSources: readonly PriceSourceConfig[] = [];
