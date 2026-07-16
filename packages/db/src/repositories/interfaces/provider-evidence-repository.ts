import type { TransactionContext } from '../../core/transaction.js';

export type ProviderEvidenceRecord = {
  id: string;
  providerId: string;
  capability: string;
  trustClass: string;
  chainId: number | null;
  requestFingerprint: string;
  responseHash: string;
  responsePayload: unknown;
  responseBytes: number;
  httpStatus: number;
  fetchedAt: Date;
  expiresAt: Date | null;
  sourceBlockNumber: bigint | null;
  sourceBlockHash: string | null;
  canonical: boolean;
  registryVersion: string;
  createdAt: Date;
};

export interface ProviderEvidenceRepository {
  getFresh(
    providerId: string,
    capability: string,
    requestFingerprint: string,
    at: Date,
    tx?: TransactionContext,
  ): Promise<ProviderEvidenceRecord | null>;

  insert(
    record: Omit<ProviderEvidenceRecord, 'id' | 'createdAt'>,
    tx?: TransactionContext,
  ): Promise<ProviderEvidenceRecord>;
}
