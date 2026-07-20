import postgres from 'postgres';
const url = process.env.CRDB_URL;
console.log('HOST=' + new URL(url.replace('postgresql://','https://')).hostname);
try {
  const sql = postgres(url, { prepare: false, connect_timeout: 30, max: 1 });
  const t = Date.now();
  const v = await sql`select version()`;
  console.log('CONNECT_MS=' + (Date.now()-t));
  console.log('VERSION=' + String(v[0].version).slice(0, 80));
  const s = [];
  for (let i=0;i<5;i++) { const a=Date.now(); await sql`select 1`; s.push(Date.now()-a); }
  console.log('RTT_FROM_LAGOS=' + s.join(',') + ' (not the datacenter number)');
  const t2 = await sql`select count(*)::int as n from information_schema.tables where table_schema='public'`;
  console.log('EXISTING_TABLES=' + t2[0].n);
  await sql.end();
} catch (e) { console.log('ERR=' + e.message.slice(0,200)); }
