import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    // A pooled endpoint runs PgBouncer in transaction mode, where a connection
    // is handed to another client between statements, so server-side prepared
    // statements do not survive and every query fails. Turning them off costs a
    // parse per query and works against pooled and direct endpoints alike.
    prepare: false,
  });
  const db = drizzle(client, { schema });

  return {
    db,
    client,
    async close() {
      await client.end();
    },
  };
}

export { schema };
