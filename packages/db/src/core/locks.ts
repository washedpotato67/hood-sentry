import type { TransactionContext } from './transaction.js';

export interface LeaseOptions {
  timeout?: number;
  ownerId?: string;
}

export interface Lease {
  key: string;
  ownerId: string;
  expiresAt: Date;
}

export async function acquireAdvisoryLock(
  tx: TransactionContext,
  lockId: bigint,
  _timeout = 5000,
): Promise<boolean> {
  const result = await tx.execute(
    `SELECT pg_try_advisory_xact_lock(${lockId.toString()}) as acquired`,
  );

  // biome-ignore lint/suspicious/noExplicitAny: Raw SQL query result
  return (result[0] as any)?.acquired === true;
}

export async function acquireAdvisoryLockShared(
  tx: TransactionContext,
  lockId: bigint,
): Promise<boolean> {
  const result = await tx.execute(
    `SELECT pg_try_advisory_xact_lock_shared(${lockId.toString()}) as acquired`,
  );

  return result[0]?.acquired === true;
}

export async function acquireLease(
  tx: TransactionContext,
  key: string,
  durationMs: number,
  options: LeaseOptions = {},
): Promise<Lease | null> {
  const { ownerId = 'default' } = options;
  const expiresAt = new Date(Date.now() + durationMs);

  const result = await tx.execute(`
    INSERT INTO leases (key, owner_id, expires_at)
    VALUES ('${key}', '${ownerId}', '${expiresAt.toISOString()}')
    ON CONFLICT (key) DO UPDATE
    SET owner_id = EXCLUDED.owner_id,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
    WHERE leases.expires_at < NOW() OR leases.owner_id = EXCLUDED.owner_id
    RETURNING key, owner_id, expires_at
  `);

  if (result.length === 0) {
    return null;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Raw SQL query result
  const row = result[0] as any;
  return {
    key: row.key,
    ownerId: row.owner_id,
    expiresAt: row.expires_at,
  };
}

export async function releaseLease(
  tx: TransactionContext,
  key: string,
  ownerId: string,
): Promise<boolean> {
  const result = await tx.execute(`
    DELETE FROM leases
    WHERE key = '${key}' AND owner_id = '${ownerId}'
    RETURNING key
  `);

  return result.length > 0;
}

export async function cleanupExpiredLeases(tx: TransactionContext): Promise<number> {
  const result = await tx.execute(`
    DELETE FROM leases
    WHERE expires_at < NOW()
    RETURNING key
  `);

  return result.length;
}

export function generateLockId(namespace: string, key: string): bigint {
  const combined = `${namespace}:${key}`;
  let hash = BigInt(0);

  for (let i = 0; i < combined.length; i++) {
    hash = (hash * BigInt(31) + BigInt(combined.charCodeAt(i))) % BigInt('9223372036854775807');
  }

  return hash;
}
