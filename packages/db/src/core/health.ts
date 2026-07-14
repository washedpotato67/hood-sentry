import type { Database } from '../client.js';

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

export interface ConnectionPoolMetrics {
  totalConnections: number;
  idleConnections: number;
  waitingConnections: number;
  maxConnections: number;
}

export async function checkHealth(db: Database): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    await db.db.execute('SELECT 1');
    const latencyMs = Date.now() - start;

    return {
      healthy: true,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;

    return {
      healthy: false,
      latencyMs,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getConnectionPoolMetrics(
  db: Database,
): Promise<ConnectionPoolMetrics | null> {
  try {
    const result = await db.db.execute(`
      SELECT
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') as idle_connections,
        (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Client') as waiting_connections,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_connections
    `);

    // biome-ignore lint/suspicious/noExplicitAny: Raw SQL query result
    const row = result[0] as any;
    if (!row) {
      return null;
    }

    return {
      totalConnections: Number(row.active_connections) + Number(row.idle_connections),
      idleConnections: Number(row.idle_connections),
      waitingConnections: Number(row.waiting_connections),
      maxConnections: Number(row.max_connections),
    };
  } catch {
    return null;
  }
}

export async function getDatabaseSize(db: Database): Promise<number | null> {
  try {
    const result = await db.db.execute(`
      SELECT pg_database_size(current_database()) as size
    `);

    // biome-ignore lint/suspicious/noExplicitAny: Raw SQL query result
    const row = result[0] as any;
    return row?.size ? Number(row.size) : null;
  } catch {
    return null;
  }
}

export async function getTableStats(
  db: Database,
  tableName: string,
): Promise<{ rowCount: number; sizeBytes: number } | null> {
  try {
    const result = await db.db.execute(`
      SELECT
        (SELECT reltuples::bigint FROM pg_class WHERE relname = '${tableName}') as row_count,
        (SELECT pg_total_relation_size(c.oid) FROM pg_class c WHERE c.relname = '${tableName}') as size_bytes
    `);

    // biome-ignore lint/suspicious/noExplicitAny: Raw SQL query result
    const row = result[0] as any;
    if (!row) {
      return null;
    }

    return {
      rowCount: Number(row.row_count),
      sizeBytes: Number(row.size_bytes),
    };
  } catch {
    return null;
  }
}
