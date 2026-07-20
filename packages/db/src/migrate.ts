import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // biome-ignore lint/suspicious/noConsole: CLI script
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  // Migrations run one statement at a time against a pooled endpoint that
  // cannot keep prepared statements between them, so ask for none. A generous
  // connect timeout covers a serverless cluster resuming from cold, and no idle
  // timeout keeps the single connection alive across a schema change that the
  // engine may run as a background job.
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 60,
    idle_timeout: 0,
  });

  try {
    // Create migrations table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Get list of applied migrations
    const applied = await sql`SELECT name FROM migrations ORDER BY id`;
    const appliedSet = new Set(applied.map((m) => m.name));

    // Get list of migration files
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // biome-ignore lint/suspicious/noConsole: CLI script
    console.log(`Found ${files.length} migration files`);
    // biome-ignore lint/suspicious/noConsole: CLI script
    console.log(`${appliedSet.size} migrations already applied`);

    // Apply pending migrations
    for (const file of files) {
      if (appliedSet.has(file)) {
        // biome-ignore lint/suspicious/noConsole: CLI script
        console.log(`Skipping ${file} (already applied)`);
        continue;
      }

      // biome-ignore lint/suspicious/noConsole: CLI script
      console.log(`Applying ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, 'utf-8');

      // Apply the migration, then record it, without wrapping the two in one
      // transaction. A distributed engine commits each schema change as its own
      // job and cannot roll a group of them back together, so the wrapper does
      // not give atomicity there and silently drops the tracking insert. Applied
      // then recorded is correct against a clean database and behaves the same
      // on a single-node engine.
      await sql.unsafe(sqlContent);
      await sql`INSERT INTO migrations (name) VALUES (${file})`;

      // biome-ignore lint/suspicious/noConsole: CLI script
      console.log(`✓ Applied ${file}`);
    }

    // biome-ignore lint/suspicious/noConsole: CLI script
    console.log('All migrations applied successfully');
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: CLI script
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigrations();
