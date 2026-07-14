import { type ConnectionOptions, type JobsOptions, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { DEFAULT_BACKOFF_MS, DEFAULT_JOB_ATTEMPTS, DERIVED_JOBS_QUEUE } from './constants.js';
import { jobIdFromKey } from './job-id.js';
import { toPayload } from './serialization.js';
import type { DerivedJobInput, DerivedJobPublisher } from './types.js';

export interface QueueJobPublisherOptions {
  connection: Redis;
  queueName?: string;
  attempts?: number;
  backoffMs?: number;
}

/**
 * Publishes derived jobs to a durable BullMQ queue.
 *
 * - Idempotent: the idempotency key is used as the BullMQ jobId, so a replayed
 *   block never enqueues a duplicate while the job still exists.
 * - Durable retries: jobs carry an attempts + exponential backoff policy.
 */
export class QueueJobPublisher implements DerivedJobPublisher {
  private readonly queue: Queue;
  private readonly attempts: number;
  private readonly backoffMs: number;

  constructor(options: QueueJobPublisherOptions) {
    this.queue = new Queue(options.queueName ?? DERIVED_JOBS_QUEUE, {
      connection: options.connection as unknown as ConnectionOptions,
    });
    this.attempts = options.attempts ?? DEFAULT_JOB_ATTEMPTS;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  }

  async publish(job: DerivedJobInput, idempotencyKey: string): Promise<void> {
    const jobOptions: JobsOptions = {
      jobId: jobIdFromKey(idempotencyKey),
      attempts: this.attempts,
      backoff: { type: 'exponential', delay: this.backoffMs },
      removeOnComplete: true,
      // Keep failed jobs so exhausted retries can be inspected before dead-lettering.
      removeOnFail: false,
    };
    await this.queue.add(job.type, toPayload(job), jobOptions);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
