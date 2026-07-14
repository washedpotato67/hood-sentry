import postgres from 'postgres';

async function resetMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // biome-ignore lint/suspicious/noConsole: CLI script
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  if (databaseUrl.includes('production') || databaseUrl.includes('prod')) {
    // biome-ignore lint/suspicious/noConsole: CLI script
    console.error('Cannot reset migrations on production database');
    process.exit(1);
  }

  const sql = postgres(databaseUrl);

  try {
    // biome-ignore lint/suspicious/noConsole: CLI script
    console.log('Dropping all tables...');
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
    // biome-ignore lint/suspicious/noConsole: CLI script
    console.log('✓ Database reset complete');
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: CLI script
    console.error('Reset failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

resetMigrations();
