/** Durable queue that carries indexer-derived jobs to the worker. */
export const DERIVED_JOBS_QUEUE = 'derived-jobs';

/** Dead-letter queue that receives derived jobs after their retries are exhausted. */
export const DERIVED_JOBS_DEAD_LETTER_QUEUE = 'derived-jobs-dead-letter';

/** Default retry policy for derived jobs. */
export const DEFAULT_JOB_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_MS = 1_000;
