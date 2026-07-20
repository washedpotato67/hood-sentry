import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const url = process.env.CRDB_URL;
const dir = path.join(process.cwd(), 'packages/db/migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 60, idle_timeout: 0, connection: { statement_timeout: 0 } });
await sql`CREATE TABLE IF NOT EXISTS migrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
const applied = new Set((await sql`SELECT name FROM migrations`).map(r => r.name));
console.log('ALREADY=' + applied.size);

for (const file of files) {
  if (applied.has(file)) continue;
  const content = fs.readFileSync(path.join(dir, file), 'utf-8');
  let attempt = 0;
  while (true) {
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO migrations (name) VALUES (${file})`;
      });
      console.log('OK ' + file);
      break;
    } catch (e) {
      attempt++;
      const msg = String(e.message || e).slice(0, 120);
      if ((e.code === 'CONNECTION_CLOSED' || /connection/i.test(msg)) && attempt < 4) {
        console.log('RETRY ' + file + ' (' + attempt + ') ' + msg);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      console.log('FAIL ' + file + ' :: ' + msg);
      await sql.end();
      process.exit(1);
    }
  }
}
console.log('DONE');
await sql.end();
