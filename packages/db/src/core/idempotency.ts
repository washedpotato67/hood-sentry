import { and, eq } from 'drizzle-orm';
import * as schema from '../schema/index.js';
import type { TransactionContext } from './transaction.js';

export interface IdempotencyKey {
  key: string;
  namespace: string;
  expiresAt?: Date;
}

export interface IdempotencyRecord {
  id: string;
  key: string;
  namespace: string;
  responseStatus: string;
  responseData: unknown;
  createdAt: Date;
  expiresAt: Date | null;
}

export async function checkIdempotencyKey(
  tx: TransactionContext,
  key: string,
  namespace: string,
): Promise<IdempotencyRecord | null> {
  const result = await tx
    .select()
    .from(schema.idempotencyKeys)
    .where(
      and(eq(schema.idempotencyKeys.key, key), eq(schema.idempotencyKeys.namespace, namespace)),
    )
    .limit(1);

  const record = result[0];
  if (!record) {
    return null;
  }

  if (record.expires_at && record.expires_at < new Date()) {
    return null;
  }

  return {
    id: record.id,
    key: record.key,
    namespace: record.namespace,
    responseStatus: record.response_status,
    responseData: record.response_data,
    createdAt: record.created_at,
    expiresAt: record.expires_at,
  };
}

export async function setIdempotencyKey(
  tx: TransactionContext,
  key: string,
  namespace: string,
  responseStatus: string,
  responseData: unknown,
  expiresAt?: Date,
): Promise<void> {
  await tx
    .insert(schema.idempotencyKeys)
    .values({
      key,
      namespace,
      response_status: responseStatus,
      response_data: responseData,
      expires_at: expiresAt ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.idempotencyKeys.key, schema.idempotencyKeys.namespace],
      set: {
        response_status: responseStatus,
        response_data: responseData,
        expires_at: expiresAt ?? null,
        updated_at: new Date(),
      },
    });
}

export async function withIdempotency<T>(
  tx: TransactionContext,
  key: string,
  namespace: string,
  fn: () => Promise<T>,
  expiresAt?: Date,
): Promise<T> {
  const existing = await checkIdempotencyKey(tx, key, namespace);

  if (existing) {
    return existing.responseData as T;
  }

  const result = await fn();

  await setIdempotencyKey(tx, key, namespace, 'success', result, expiresAt);

  return result;
}
