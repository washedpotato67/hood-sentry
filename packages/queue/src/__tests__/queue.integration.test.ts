import { type ConnectionOptions, Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueueConnection } from '../connection.js';
import { createDerivedJobWorker } from '../consumer.js';
import { QueueJobPublisher } from '../publisher.js';
import type { DeadLetteredJob, DerivedJobInput, DerivedJobPayload } from '../types.js';

const REDIS_URL = process.env.TEST_REDIS_URL || process.env.REDIS_URL || 'redis://localhost:6379';

function job(overrides: Partial<DerivedJobInput> = {}): DerivedJobInput {
  return {
    type: 'log',
    chainId: 4663n,
    blockNumber: 1n,
    blockHash: '0xabc',
    data: { transactionHash: '0xtx', amountRaw: 1000n },
    ...overrides,
  };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 8000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('waitFor timed out');
}

let uid = 0;
function names(): { queue: string; dlq: string } {
  uid += 1;
  const base = `test-derived-${Date.now()}-${uid}`;
  return { queue: base, dlq: `${base}-dead` };
}

describe('derived job queue', () => {
  let dbAvailable = false;

  beforeAll(async () => {
    const probe = createQueueConnection(REDIS_URL, { connectTimeout: 1500 });
    try {
      await probe.ping();
      dbAvailable = true;
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.warn('Redis not available, skipping tests:', (error as Error).message);
    } finally {
      probe.disconnect();
    }
  });

  afterAll(() => {
    /* connections are closed per test */
  });

  it('publishes a job that the worker consumes', async () => {
    if (!dbAvailable) return;
    const { queue, dlq } = names();
    const workerConn = createQueueConnection(REDIS_URL);
    const sharedConn = createQueueConnection(REDIS_URL);
    const processed: DerivedJobPayload[] = [];
    const runner = createDerivedJobWorker({
      connection: workerConn,
      deadLetterConnection: sharedConn,
      handler: async (payload) => {
        processed.push(payload);
      },
      queueName: queue,
      deadLetterQueueName: dlq,
    });
    const publisher = new QueueJobPublisher({ connection: sharedConn, queueName: queue });
    try {
      await publisher.publish(job(), '4663:0xabc:0xtx:0:log');
      await waitFor(() => processed.length === 1);
      expect(processed[0]?.chainId).toBe('4663');
      expect(processed[0]?.data.amountRaw).toBe('1000');
    } finally {
      await publisher.close();
      await runner.close();
      await workerConn.quit();
      await sharedConn.quit();
    }
  });

  it('deduplicates jobs published with the same idempotency key', async () => {
    if (!dbAvailable) return;
    const { queue, dlq } = names();
    const workerConn = createQueueConnection(REDIS_URL);
    const sharedConn = createQueueConnection(REDIS_URL);
    let handled = 0;
    const runner = createDerivedJobWorker({
      connection: workerConn,
      deadLetterConnection: sharedConn,
      handler: async () => {
        handled += 1;
      },
      queueName: queue,
      deadLetterQueueName: dlq,
    });
    const publisher = new QueueJobPublisher({ connection: sharedConn, queueName: queue });
    try {
      await publisher.publish(job(), '4663:0xabc:0xtx:1:log');
      await publisher.publish(job({ data: { different: true } }), '4663:0xabc:0xtx:1:log');
      await waitFor(() => handled >= 1);
      // Give any duplicate a chance to (not) run.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(handled).toBe(1);
    } finally {
      await publisher.close();
      await runner.close();
      await workerConn.quit();
      await sharedConn.quit();
    }
  });

  it('retries a failing job and eventually succeeds', async () => {
    if (!dbAvailable) return;
    const { queue, dlq } = names();
    const workerConn = createQueueConnection(REDIS_URL);
    const sharedConn = createQueueConnection(REDIS_URL);
    let attempts = 0;
    const runner = createDerivedJobWorker({
      connection: workerConn,
      deadLetterConnection: sharedConn,
      handler: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error(`transient failure ${attempts}`);
      },
      queueName: queue,
      deadLetterQueueName: dlq,
    });
    const publisher = new QueueJobPublisher({
      connection: sharedConn,
      queueName: queue,
      attempts: 5,
      backoffMs: 1,
    });
    try {
      await publisher.publish(job(), '4663:0xabc:0xtx:2:log');
      await waitFor(() => attempts >= 3);
      expect(attempts).toBe(3);
    } finally {
      await publisher.close();
      await runner.close();
      await workerConn.quit();
      await sharedConn.quit();
    }
  });

  it('dead-letters a job after its retries are exhausted', async () => {
    if (!dbAvailable) return;
    const { queue, dlq } = names();
    const workerConn = createQueueConnection(REDIS_URL);
    const sharedConn = createQueueConnection(REDIS_URL);
    const readConn = createQueueConnection(REDIS_URL);
    const deadLettered: DeadLetteredJob[] = [];
    const runner = createDerivedJobWorker({
      connection: workerConn,
      deadLetterConnection: sharedConn,
      handler: async () => {
        throw new Error('permanent failure');
      },
      queueName: queue,
      deadLetterQueueName: dlq,
      onDeadLetter: (record) => {
        deadLettered.push(record);
      },
    });
    const publisher = new QueueJobPublisher({
      connection: sharedConn,
      queueName: queue,
      attempts: 2,
      backoffMs: 1,
    });
    const dlqReader = new Queue(dlq, {
      connection: readConn as unknown as ConnectionOptions,
    });
    try {
      await publisher.publish(job(), '4663:0xabc:0xtx:3:log');
      await waitFor(() => deadLettered.length === 1);
      expect(deadLettered[0]?.attemptsMade).toBe(2);
      expect(deadLettered[0]?.failedReason).toContain('permanent failure');
      const counts = await dlqReader.getJobCounts('waiting');
      expect(counts.waiting).toBeGreaterThanOrEqual(1);
    } finally {
      await dlqReader.close();
      await publisher.close();
      await runner.close();
      await workerConn.quit();
      await sharedConn.quit();
      await readConn.quit();
    }
  });
});
