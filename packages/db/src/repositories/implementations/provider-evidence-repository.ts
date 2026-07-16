import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { Database } from '../../client.js';
import type { TransactionContext } from '../../core/transaction.js';
import { providerEvidence } from '../../schema/provider-evidence.js';
import type {
  ProviderEvidenceRecord,
  ProviderEvidenceRepository,
} from '../interfaces/provider-evidence-repository.js';

function mapRecord(row: typeof providerEvidence.$inferSelect): ProviderEvidenceRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    capability: row.capability,
    trustClass: row.trustClass,
    chainId: row.chainId,
    requestFingerprint: row.requestFingerprint,
    responseHash: row.responseHash,
    responsePayload: row.responsePayload,
    responseBytes: row.responseBytes,
    httpStatus: row.httpStatus,
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
    sourceBlockNumber: row.sourceBlockNumber,
    sourceBlockHash: row.sourceBlockHash,
    canonical: row.canonical,
    registryVersion: row.registryVersion,
    createdAt: row.createdAt,
  };
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

export class DrizzleProviderEvidenceRepository implements ProviderEvidenceRepository {
  constructor(private readonly db: Database['db']) {}

  async getFresh(
    providerId: string,
    capability: string,
    requestFingerprint: string,
    at: Date,
    tx?: TransactionContext,
  ): Promise<ProviderEvidenceRecord | null> {
    const executor = tx ?? this.db;
    const rows = await executor
      .select()
      .from(providerEvidence)
      .where(
        and(
          eq(providerEvidence.providerId, providerId),
          eq(providerEvidence.capability, capability),
          eq(providerEvidence.requestFingerprint, requestFingerprint),
          eq(providerEvidence.canonical, true),
          or(isNull(providerEvidence.expiresAt), gt(providerEvidence.expiresAt, at)),
        ),
      )
      .orderBy(desc(providerEvidence.fetchedAt), desc(providerEvidence.createdAt))
      .limit(1);
    return rows[0] === undefined ? null : mapRecord(rows[0]);
  }

  async insert(
    record: Omit<ProviderEvidenceRecord, 'id' | 'createdAt'>,
    tx?: TransactionContext,
  ): Promise<ProviderEvidenceRecord> {
    const executor = tx ?? this.db;
    const inserted = await executor
      .insert(providerEvidence)
      .values(record)
      .onConflictDoNothing({
        target: [
          providerEvidence.providerId,
          providerEvidence.capability,
          providerEvidence.requestFingerprint,
          providerEvidence.responseHash,
        ],
      })
      .returning();
    if (inserted[0] !== undefined) return mapRecord(inserted[0]);

    const existing = await executor
      .select()
      .from(providerEvidence)
      .where(
        and(
          eq(providerEvidence.providerId, record.providerId),
          eq(providerEvidence.capability, record.capability),
          eq(providerEvidence.requestFingerprint, record.requestFingerprint),
          eq(providerEvidence.responseHash, record.responseHash),
        ),
      )
      .limit(1);
    return mapRecord(required(existing[0], 'Provider evidence conflict lookup returned no row'));
  }
}
