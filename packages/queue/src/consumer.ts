import { type ConnectionOptions, type Job, Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { DERIVED_JOBS_DEAD_LETTER_QUEUE, DERIVED_JOBS_QUEUE } from './constants.js';
import type { DeadLetteredJob, DerivedJobHandler, DerivedJobPayload } from './types.js';

export interface DerivedJobWorkerOptions {
  connection: Redis;
  /** A second connection dedicated to the dead-letter queue writer. */
  deadLetterConnection: Redis;
  handler: DerivedJobHandler;
  queueName?: string;
  deadLetterQueueName?: string;
  concurrency?: number;
  /** Optional hooks for observability. */
  onCompleted?: (jobId: string) => void;
  onDeadLetter?: (record: DeadLetteredJob) => void;
  onError?: (error: Error) => void;
}

/**
 * Runs a durable worker over the derived-jobs queue.
 *
 * - Retries are handled by BullMQ per the job's attempts policy.
 * - When a job's retries are exhausted, it is moved to the dead-letter queue
 *   rather than silently dropped.
 */
export function createDerivedJobWorker(options: DerivedJobWorkerOptions): {
  worker: Worker;
  deadLetterQueue: Queue;
  close: () => Promise<void>;
} {
  const deadLetterQueue = new Queue(options.deadLetterQueueName ?? DERIVED_JOBS_DEAD_LETTER_QUEUE, {
    connection: options.deadLetterConnection as unknown as ConnectionOptions,
  });

  const worker = new Worker(
    options.queueName ?? DERIVED_JOBS_QUEUE,
    async (job: Job) => {
      await options.handler(job.data as DerivedJobPayload);
    },
    {
      connection: options.connection as unknown as ConnectionOptions,
      concurrency: options.concurrency ?? 4,
    },
  );

  worker.on('completed', (job) => {
    if (job.id !== undefined) options.onCompleted?.(job.id);
  });

  worker.on('failed', (job, error) => {
    if (job === undefined) {
      options.onError?.(error);
      return;
    }
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      // Retries remain; BullMQ will re-deliver.
      return;
    }
    const record: DeadLetteredJob = {
      payload: job.data as DerivedJobPayload,
      originalJobId: job.id ?? 'unknown',
      attemptsMade: job.attemptsMade,
      failedReason: error.message,
      deadLetteredAt: new Date().toISOString(),
    };
    void deadLetterQueue
      .add(job.name, record, { jobId: `dead-${job.id}` })
      .then(() => options.onDeadLetter?.(record))
      .catch((deadLetterError: unknown) => {
        options.onError?.(
          deadLetterError instanceof Error ? deadLetterError : new Error(String(deadLetterError)),
        );
      });
  });

  const close = async (): Promise<void> => {
    await worker.close();
    await deadLetterQueue.close();
  };

  return { worker, deadLetterQueue, close };
}
