import Redis from 'ioredis';
const r = new Redis(process.env.REDIS_PUBLIC_URL, { maxRetriesPerRequest: 3, family: 0, connectTimeout: 20000 });
// Wait for the backlog to clear so the snapshot captures a small dataset.
for (let i = 0; i < 40; i++) {
  const n = await r.llen('bull:derived-jobs:wait');
  if (n < 5000) { console.log('QUEUE_DRAINED=' + n); break; }
  if (i % 5 === 0) console.log('  waiting, queue=' + n);
  await new Promise((res) => setTimeout(res, 20000));
}
await r.bgsave();
for (let i = 0; i < 30; i++) {
  await new Promise((res) => setTimeout(res, 3000));
  const p = await r.info('persistence');
  if (!/rdb_bgsave_in_progress:1/.test(p)) {
    console.log('FINAL_BGSAVE ' + (p.split('\n').find((l) => l.startsWith('rdb_last_bgsave_status')) ?? '').trim());
    break;
  }
}
const mem = await r.info('memory');
console.log('MEM=' + (mem.split('\n').find((l) => l.startsWith('used_memory_human')) ?? '').trim());
await r.quit();
