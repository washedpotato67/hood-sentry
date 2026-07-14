import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';
import { RateLimitError } from '../types.js';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter('http://test.com', {
      requestsPerSecond: 10,
      burstSize: 10,
    });
  });

  describe('token acquisition', () => {
    it('should allow requests within rate limit', async () => {
      await expect(rateLimiter.acquire()).resolves.toBeUndefined();
      await expect(rateLimiter.acquire()).resolves.toBeUndefined();
    });

    it('should throw RateLimitError when tokens exhausted', async () => {
      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        await rateLimiter.acquire();
      }

      await expect(rateLimiter.acquire()).rejects.toThrow(RateLimitError);
    });

    it('should include retry-after in RateLimitError', async () => {
      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        await rateLimiter.acquire();
      }

      try {
        await rateLimiter.acquire();
        expect.fail('Should have thrown RateLimitError');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as RateLimitError).retryAfterMs).toBeGreaterThan(0);
      }
    });
  });

  describe('token refill', () => {
    it('should refill tokens over time', async () => {
      vi.useFakeTimers();

      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        await rateLimiter.acquire();
      }

      // Wait for 1 second (should refill 10 tokens)
      vi.advanceTimersByTime(1000);

      await expect(rateLimiter.acquire()).resolves.toBeUndefined();

      vi.useRealTimers();
    });

    it('should not exceed burst size', async () => {
      vi.useFakeTimers();

      // Wait for 10 seconds (would refill 100 tokens, but capped at burst size)
      vi.advanceTimersByTime(10000);

      const availableTokens = rateLimiter.getAvailableTokens();
      expect(availableTokens).toBe(10); // burstSize

      vi.useRealTimers();
    });
  });

  describe('waitForToken', () => {
    it('should wait for next token when exhausted', async () => {
      vi.useFakeTimers();

      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        await rateLimiter.acquire();
      }

      const promise = rateLimiter.waitForToken();

      // Advance time to allow token refill
      vi.advanceTimersByTime(100);

      await expect(promise).resolves.toBeUndefined();

      vi.useRealTimers();
    });

    it('should not wait when tokens available', async () => {
      await expect(rateLimiter.waitForToken()).resolves.toBeUndefined();
    });
  });

  describe('getAvailableTokens', () => {
    it('should return correct available tokens', async () => {
      expect(rateLimiter.getAvailableTokens()).toBe(10);

      await rateLimiter.acquire();
      expect(rateLimiter.getAvailableTokens()).toBe(9);

      await rateLimiter.acquire();
      expect(rateLimiter.getAvailableTokens()).toBe(8);
    });

    it('should account for token refill', async () => {
      vi.useFakeTimers();

      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        await rateLimiter.acquire();
      }

      expect(rateLimiter.getAvailableTokens()).toBe(0);

      // Wait for 0.5 seconds (should refill 5 tokens)
      vi.advanceTimersByTime(500);

      expect(rateLimiter.getAvailableTokens()).toBe(5);

      vi.useRealTimers();
    });
  });

  describe('configuration', () => {
    it('should return configuration', () => {
      const config = rateLimiter.getConfig();

      expect(config.requestsPerSecond).toBe(10);
      expect(config.burstSize).toBe(10);
    });

    it('should use requestsPerSecond as default burstSize', () => {
      const limiter = new RateLimiter('http://test.com', {
        requestsPerSecond: 5,
      });

      const config = limiter.getConfig();
      expect(config.burstSize).toBe(5);
    });

    it('should allow custom burstSize', () => {
      const limiter = new RateLimiter('http://test.com', {
        requestsPerSecond: 5,
        burstSize: 20,
      });

      const config = limiter.getConfig();
      expect(config.burstSize).toBe(20);
    });
  });

  describe('reset', () => {
    it('should reset tokens to burst size', async () => {
      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        await rateLimiter.acquire();
      }

      expect(rateLimiter.getAvailableTokens()).toBe(0);

      rateLimiter.reset();

      expect(rateLimiter.getAvailableTokens()).toBe(10);
    });
  });

  describe('getProviderUrl', () => {
    it('should return the provider URL', () => {
      expect(rateLimiter.getProviderUrl()).toBe('http://test.com');
    });
  });

  describe('burst behavior', () => {
    it('should allow burst up to burstSize', async () => {
      const limiter = new RateLimiter('http://test.com', {
        requestsPerSecond: 1,
        burstSize: 5,
      });

      // Should allow 5 requests immediately
      for (let i = 0; i < 5; i++) {
        await expect(limiter.acquire()).resolves.toBeUndefined();
      }

      // 6th request should fail
      await expect(limiter.acquire()).rejects.toThrow(RateLimitError);
    });
  });
});
