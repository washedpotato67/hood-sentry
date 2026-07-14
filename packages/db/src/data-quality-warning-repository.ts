import type { DataQualityWarning } from '@hood-sentry/chain';
import { and, eq, notInArray } from 'drizzle-orm';
import { keccak256, toBytes } from 'viem';
import { z } from 'zod';
import type { Database } from './client.js';
import { dataQualityWarnings } from './schema/explorer-enrichment.js';

const contractIdentitySchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

function warningFingerprint(chainId: number, address: string, warning: DataQualityWarning): string {
  const conflict = warning.conflict;
  const identity = [
    chainId.toString(),
    address.toLowerCase(),
    conflict.provider,
    conflict.field,
    conflict.chainValue?.toLowerCase() ?? 'null',
    conflict.explorerValue?.toLowerCase() ?? 'null',
  ].join(':');
  return keccak256(toBytes(identity));
}

export class DatabaseDataQualityWarningRepository {
  constructor(private readonly database: Database['db']) {}

  async replaceOpenProxyWarnings(
    chainId: number,
    address: string,
    warnings: DataQualityWarning[],
  ): Promise<void> {
    const identity = contractIdentitySchema.parse({ chainId, address });
    const storageAddress = identity.address.toLowerCase();
    const fingerprints = warnings.map((warning) =>
      warningFingerprint(identity.chainId, storageAddress, warning),
    );

    await this.database.transaction(async (transaction) => {
      const baseResolutionFilter = and(
        eq(dataQualityWarnings.chain_id, identity.chainId),
        eq(dataQualityWarnings.address, storageAddress),
        eq(dataQualityWarnings.category, 'explorer_chain_conflict'),
        eq(dataQualityWarnings.provider, 'blockscout'),
        eq(dataQualityWarnings.status, 'open'),
      );
      const resolutionFilter =
        fingerprints.length === 0
          ? baseResolutionFilter
          : and(baseResolutionFilter, notInArray(dataQualityWarnings.fingerprint, fingerprints));

      await transaction
        .update(dataQualityWarnings)
        .set({ status: 'resolved', resolved_at: new Date(), updated_at: new Date() })
        .where(resolutionFilter);

      for (const [index, warning] of warnings.entries()) {
        const fingerprint = fingerprints[index];
        if (fingerprint === undefined) continue;
        const conflict = warning.conflict;
        await transaction
          .insert(dataQualityWarnings)
          .values({
            fingerprint,
            chain_id: identity.chainId,
            address: storageAddress,
            category: warning.category,
            field: conflict.field,
            chain_value: conflict.chainValue,
            provider_value: conflict.explorerValue,
            provider: conflict.provider,
            provider_fetched_at: new Date(conflict.fetchedAt),
            status: 'open',
          })
          .onConflictDoUpdate({
            target: dataQualityWarnings.fingerprint,
            set: {
              provider_fetched_at: new Date(conflict.fetchedAt),
              status: 'open',
              resolved_at: null,
              updated_at: new Date(),
            },
          });
      }
    });
  }
}
