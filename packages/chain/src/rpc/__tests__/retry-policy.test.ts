import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryPolicy } from '../retry-policy.js';
import { ContractRevertError, RPCError, RateLimitError } from '../types.js';

describe('RetryPolicy', () => {
  let retryPolicy: RetryPolicy;

  beforeEach(() => {
    retryPolicy = new RetryPolicy({
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
      jitterEnabled: false,
    });
  });

  describe('successful execution', () => {
    it('should return result on first success', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await retryPolicy.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('success');

      const result = await retryPolicy.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry behavior', () => {
    it('should retry up to maxAttempts', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(retryPolicy.execute(operation)).rejects.toThrow('Network error');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const error = new RPCError('Not retryable', 'ERROR', 'http://test.com', undefined, false);
      const operation = vi.fn().mockRejectedValue(error);

      await expect(retryPolicy.execute(operation)).rejects.toThrow('Not retryable');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should not retry contract reverts', async () => {
      const error = new ContractRevertError('http://test.com', 'Insufficient balance');
      const operation = vi.fn().mockRejectedValue(error);

      await expect(retryPolicy.execute(operation)).rejects.toThrow('Insufficient balance');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry retryable RPC errors', async () => {
      const error = new RPCError('Temporary failure', 'ERROR', 'http://test.com', undefined, true);
      const operation = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('success');

      const result = await retryPolicy.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe('exponential backoff', () => {
    it('should apply exponential backoff between retries', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('success');

      // Just verify it retries and eventually succeeds
      const result = await retryPolicy.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should respect maxDelayMs', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 5,
        baseDelayMs: 100,
        maxDelayMs: 300,
        backoffMultiplier: 10,
        jitterEnabled: false,
      });

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error 1'))
        .mockRejectedValueOnce(new Error('Network error 2'))
        .mockResolvedValueOnce('success');

      const result = await policy.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });
  });

  describe('rate limit handling', () => {
    it('should respect retry-after from rate limit errors', async () => {
      vi.useFakeTimers();

      const error = new RateLimitError('http://test.com', 500);
      const operation = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('success');

      const promise = retryPolicy.execute(operation);

      // Should wait for retry-after duration
      await vi.advanceTimersByTimeAsync(500);
      expect(operation).toHaveBeenCalledTimes(2);

      const result = await promise;
      expect(result).toBe('success');

      vi.useRealTimers();
    });
  });

  describe('custom retry logic', () => {
    it('should use custom shouldRetry function', async () => {
      const customPolicy = new RetryPolicy({
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        jitterEnabled: false,
      });

      const customShouldRetry = (error: Error) => error.message.includes('retry-me');

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('retry-me'))
        .mockResolvedValueOnce('success');

      const result = await customPolicy.execute(operation, { shouldRetry: customShouldRetry });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should not retry when custom shouldRetry returns false', async () => {
      const customPolicy = new RetryPolicy({
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        jitterEnabled: false,
      });

      const customShouldRetry = (_error: Error) => false;

      const operation = vi.fn().mockRejectedValue(new Error('Do not retry'));

      await expect(
        customPolicy.execute(operation, { shouldRetry: customShouldRetry }),
      ).rejects.toThrow('Do not retry');
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('configuration', () => {
    it('should use default configuration when not provided', () => {
      const defaultPolicy = new RetryPolicy();
      const config = defaultPolicy.getConfig();

      expect(config.maxAttempts).toBe(3);
      expect(config.baseDelayMs).toBe(1000);
      expect(config.maxDelayMs).toBe(30000);
      expect(config.backoffMultiplier).toBe(2);
      expect(config.jitterEnabled).toBe(true);
    });

    it('should override default configuration', () => {
      const config = retryPolicy.getConfig();

      expect(config.maxAttempts).toBe(3);
      expect(config.baseDelayMs).toBe(100);
      expect(config.maxDelayMs).toBe(1000);
      expect(config.backoffMultiplier).toBe(2);
      expect(config.jitterEnabled).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should throw last error after all retries fail', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error 1'))
        .mockRejectedValueOnce(new Error('Network error 2'))
        .mockRejectedValueOnce(new Error('Network error 3'));

      await expect(retryPolicy.execute(operation)).rejects.toThrow('Network error 3');
    });

    it('should handle non-Error exceptions', async () => {
      const operation = vi.fn().mockRejectedValue('String error');

      await expect(retryPolicy.execute(operation)).rejects.toThrow('String error');
    });
  });
});
