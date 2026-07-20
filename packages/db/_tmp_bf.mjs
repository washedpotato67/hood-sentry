import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { prepare: false, connect_timeout: 30, max: 1 });
console.log('POOLS=' + (await sql`select count(*)::int as n from pools`)[0].n);
const c = await sql`select next_block::text as n from indexer_checkpoints where stream like 'pool-backfill%'`;
console.log('CURSOR=' + (c[0]?.n ?? 'none'));
const oldest = await sql`select address, created_block::text as blk from pools order by created_block asc limit 3`;
for (const r of oldest) console.log('OLDEST=' + r.address.slice(0,12) + ' blk ' + r.blk);
await sql.end();
