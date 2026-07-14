import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../circuit-breaker.js';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;
  const config = {
    failureThreshold: 3,
    resetTimeoutMs: 1000,
    halfOpenMaxRequests: 2,
  };

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker('http://test.com', config);
  });

  describe('initial state', () => {
    it('should start in closed state', () => {
      expect(circuitBreaker.getCircuitState()).toBe('closed');
      expect(circuitBreaker.canExecute()).toBe(true);
    });

    it('should have zero failure count', () => {
      const state = circuitBreaker.getState();
      expect(state.failureCount).toBe(0);
    });
  });

  describe('closed state', () => {
    it('should allow execution in closed state', () => {
      expect(circuitBreaker.canExecute()).toBe(true);
    });

    it('should record success and reset failure count', () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordSuccess();

      const state = circuitBreaker.getState();
      expect(state.failureCount).toBe(0);
    });

    it('should transition to open after reaching failure threshold', () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();

      expect(circuitBreaker.getCircuitState()).toBe('open');
      expect(circuitBreaker.canExecute()).toBe(false);
    });
  });

  describe('open state', () => {
    beforeEach(() => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
    });

    it('should not allow execution in open state', () => {
      expect(circuitBreaker.canExecute()).toBe(false);
    });

    it('should transition to half-open after reset timeout', async () => {
      vi.useFakeTimers();

      vi.advanceTimersByTime(config.resetTimeoutMs + 100);

      expect(circuitBreaker.getCircuitState()).toBe('half-open');

      vi.useRealTimers();
    });
  });

  describe('half-open state', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      vi.advanceTimersByTime(config.resetTimeoutMs + 100);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should allow limited execution in half-open state', () => {
      expect(circuitBreaker.canExecute()).toBe(true);
    });

    it('should transition to closed after successful half-open attempts', () => {
      circuitBreaker.recordSuccess();
      circuitBreaker.recordSuccess();

      expect(circuitBreaker.getCircuitState()).toBe('closed');
    });

    it('should transition back to open on failure in half-open state', () => {
      circuitBreaker.recordFailure();

      expect(circuitBreaker.getCircuitState()).toBe('open');
    });
  });

  describe('reset', () => {
    it('should reset to closed state', () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();

      circuitBreaker.reset();

      expect(circuitBreaker.getCircuitState()).toBe('closed');
      expect(circuitBreaker.canExecute()).toBe(true);

      const state = circuitBreaker.getState();
      expect(state.failureCount).toBe(0);
      expect(state.lastFailureTime).toBeNull();
    });
  });

  describe('getState', () => {
    it('should return a copy of the state', () => {
      const state1 = circuitBreaker.getState();
      const state2 = circuitBreaker.getState();

      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
    });
  });

  describe('getProviderUrl', () => {
    it('should return the provider URL', () => {
      expect(circuitBreaker.getProviderUrl()).toBe('http://test.com');
    });
  });
});
