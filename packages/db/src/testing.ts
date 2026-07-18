import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Migration file names in application order. */
export function migrationFiles(): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

/** Drop and recreate the public schema for a clean slate. */
export async function resetSchema(sql: Sql): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS public CASCADE`;
  await sql`CREATE SCHEMA public`;
}

/** Apply every pending migration, tracked in the migrations table. Returns all migration file names. */
export async function applyMigrations(sql: Sql): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  const applied = await sql`SELECT name FROM migrations`;
  const appliedSet = new Set(applied.map((row) => row.name as string));
  const files = migrationFiles();
  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO migrations (name) VALUES (${file})`;
    });
  }
  return files;
}

/** Reset the schema and apply all migrations, so a test file owns a clean, migrated database. */
export async function resetAndMigrate(sql: Sql): Promise<void> {
  await resetSchema(sql);
  await applyMigrations(sql);
  // The supported-chains migration seeds `chains`, but tests provision their own
  // chain fixtures (often the same ids), so hand them an empty table to own. No
  // rows reference it yet on a freshly migrated schema, so the delete is clean.
  await sql`DELETE FROM chains`;
}
