import { Redis, type RedisOptions } from 'ioredis';

/**
 * Create a Redis connection configured for BullMQ.
 * BullMQ requires `maxRetriesPerRequest: null` on blocking connections.
 */
export function createQueueConnection(redisUrl: string, options: RedisOptions = {}): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...options,
  });
}
