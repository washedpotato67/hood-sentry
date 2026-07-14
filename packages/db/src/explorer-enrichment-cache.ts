import {
  type BlockscoutCache,
  type BlockscoutCacheEntry,
  parseBlockscoutCacheEntry,
} from '@hood-sentry/chain';
import { eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { explorerContractMetadata } from './schema/explorer-enrichment.js';

export class DatabaseBlockscoutCache implements BlockscoutCache {
  constructor(private readonly database: Database['db']) {}

  async get(key: string): Promise<BlockscoutCacheEntry | null> {
    const rows = await this.database
      .select({ cacheEntry: explorerContractMetadata.cache_entry })
      .from(explorerContractMetadata)
      .where(eq(explorerContractMetadata.cache_key, key))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : parseBlockscoutCacheEntry(row.cacheEntry);
  }

  async set(key: string, entry: BlockscoutCacheEntry): Promise<void> {
    const metadata = entry.result.metadata;
    if (entry.result.status !== 'available' || metadata === null) return;

    const values: typeof explorerContractMetadata.$inferInsert = {
      chain_id: metadata.chainId,
      address: metadata.address.toLowerCase(),
      provider: metadata.provenance.provider,
      provider_url: metadata.provenance.providerUrl,
      provider_endpoints: metadata.provenance.endpoints,
      cache_key: key,
      cache_entry: entry,
      verification_status: metadata.verificationStatus,
      source_files: metadata.sourceFiles,
      source_hash: metadata.sourceHash,
      abi: metadata.abi,
      compiler_version: metadata.compilerVersion,
      optimizer_enabled: metadata.optimizerEnabled,
      optimizer_runs: metadata.optimizerRuns,
      compiler_settings: metadata.compilerSettings,
      constructor_arguments: metadata.constructorArguments,
      contract_name: metadata.contractName,
      proxy_metadata: metadata.proxy,
      token_labels: metadata.tokenLabels,
      raw_response: metadata.rawResponse,
      warnings: entry.result.warnings,
      fetched_at: new Date(metadata.provenance.fetchedAt),
      expires_at: new Date(entry.expiresAt),
    };

    await this.database
      .insert(explorerContractMetadata)
      .values(values)
      .onConflictDoUpdate({
        target: [
          explorerContractMetadata.chain_id,
          explorerContractMetadata.address,
          explorerContractMetadata.provider,
        ],
        set: {
          provider_url: values.provider_url,
          provider_endpoints: values.provider_endpoints,
          cache_key: values.cache_key,
          cache_entry: values.cache_entry,
          verification_status: values.verification_status,
          source_files: values.source_files,
          source_hash: values.source_hash,
          abi: values.abi,
          compiler_version: values.compiler_version,
          optimizer_enabled: values.optimizer_enabled,
          optimizer_runs: values.optimizer_runs,
          compiler_settings: values.compiler_settings,
          constructor_arguments: values.constructor_arguments,
          contract_name: values.contract_name,
          proxy_metadata: values.proxy_metadata,
          token_labels: values.token_labels,
          raw_response: values.raw_response,
          warnings: values.warnings,
          fetched_at: values.fetched_at,
          expires_at: values.expires_at,
          updated_at: new Date(),
        },
      });
  }
}
