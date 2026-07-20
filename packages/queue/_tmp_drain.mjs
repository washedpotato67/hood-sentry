import Redis from 'ioredis';
const r = new Redis(process.env.REDIS_PUBLIC_URL, { maxRetriesPerRequest: 3, family: 0 });
const before = await r.llen('bull:derived-jobs:wait');
console.log('WAIT_BEFORE=' + before);

// Drop only the waiting backlog. Active, failed and dead-letter entries are left
// alone: those are in flight or are evidence of a problem worth inspecting.
await r.del('bull:derived-jobs:wait');

// The job hashes the list pointed at are now unreachable; remove them so the
// memory is actually returned rather than merely unreferenced.
let cursor = '0';
let removed = 0;
do {
  const [next, keys] = await r.scan(cursor, 'MATCH', 'bull:derived-jobs:*', 'COUNT', 1000);
  cursor = next;
  const orphans = keys.filter((k) => /^bull:derived-jobs:[0-9a-f-]{8,}$/i.test(k));
  if (orphans.length > 0) {
    await r.del(...orphans);
    removed += orphans.length;
  }
} while (cursor !== '0');
console.log('JOB_HASHES_REMOVED=' + removed);
console.log('WAIT_AFTER=' + (await r.llen('bull:derived-jobs:wait')));
console.log('DBSIZE_AFTER=' + (await r.dbsize()));
const mem = await r.info('memory');
console.log('MEM_AFTER=' + (mem.split('\n').find((l) => l.startsWith('used_memory_human')) ?? '').trim());
await r.quit();
