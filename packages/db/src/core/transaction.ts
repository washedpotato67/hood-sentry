import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Database } from '../client.js';

// biome-ignore lint/suspicious/noExplicitAny: Transaction context needs to accept any schema
export type TransactionContext = PostgresJsDatabase<any>;

export interface TransactionOptions {
  timeout?: number;
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';
}

export async function withTransaction<T>(
  db: Database['db'],
  fn: (tx: TransactionContext) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const { timeout = 30000, isolationLevel = 'read committed' } = options;

  return db.transaction(async (tx) => {
    if (timeout) {
      await tx.execute(`SET LOCAL statement_timeout = '${timeout}ms'`);
    }

    if (isolationLevel !== 'read committed') {
      await tx.execute(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
    }

    return fn(tx as TransactionContext);
  });
}

export async function withSerializableTransaction<T>(
  db: Database['db'],
  fn: (tx: TransactionContext) => Promise<T>,
  timeout = 30000,
): Promise<T> {
  return withTransaction(db, fn, { timeout, isolationLevel: 'serializable' });
}
