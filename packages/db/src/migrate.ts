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
  // cannot keep prepared statements between them, so ask for none.
  const sql = postgres(databaseUrl, { prepare: false, max: 1 });

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

      await sql.begin(async (tx) => {
        await tx.unsafe(sqlContent);
        await tx`INSERT INTO migrations (name) VALUES (${file})`;
      });

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
