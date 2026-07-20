import { Redis, type RedisOptions } from 'ioredis';

/**
 * Create a Redis connection configured for BullMQ.
 * BullMQ requires `maxRetriesPerRequest: null` on blocking connections.
 */
export function createQueueConnection(redisUrl: string, options: RedisOptions = {}): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Resolve both address families. Private networking on some hosts publishes
    // AAAA records only, and ioredis otherwise asks for A records exclusively
    // and fails to resolve the host at all. Zero means "whatever DNS returns",
    // which is correct everywhere rather than only on those hosts.
    family: 0,
    ...options,
  });
}
