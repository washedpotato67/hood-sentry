import type { CircuitBreakerState, CircuitState } from './types.js';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxRequests: number;
}

export class CircuitBreaker {
  private state: CircuitBreakerState;
  private readonly config: CircuitBreakerConfig;
  private readonly providerUrl: string;

  constructor(providerUrl: string, config: CircuitBreakerConfig) {
    this.providerUrl = providerUrl;
    this.config = config;
    this.state = {
      state: 'closed',
      failureCount: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      halfOpenAttempts: 0,
    };
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  getCircuitState(): CircuitState {
    // Check if we should transition from open to half-open
    if (this.state.state === 'open' && this.state.lastFailureTime !== null) {
      const timeSinceFailure = Date.now() - this.state.lastFailureTime;
      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        this.transitionToHalfOpen();
      }
    }
    return this.state.state;
  }

  canExecute(): boolean {
    const currentState = this.getCircuitState();

    switch (currentState) {
      case 'closed':
        return true;
      case 'open':
        return false;
      case 'half-open':
        return this.state.halfOpenAttempts < this.config.halfOpenMaxRequests;
      default:
        return false;
    }
  }

  recordSuccess(): void {
    const currentState = this.getCircuitState();

    if (currentState === 'half-open') {
      this.state.halfOpenAttempts++;

      // If we've had enough successful attempts in half-open, close the circuit
      if (this.state.halfOpenAttempts >= this.config.halfOpenMaxRequests) {
        this.transitionToClosed();
      }
    } else if (currentState === 'closed') {
      // Reset failure count on success in closed state
      this.state.failureCount = 0;
      this.state.lastSuccessTime = Date.now();
    }
  }

  recordFailure(): void {
    const currentState = this.getCircuitState();
    const now = Date.now();

    this.state.failureCount++;
    this.state.lastFailureTime = now;

    if (currentState === 'half-open') {
      // Any failure in half-open state trips the circuit back to open
      this.transitionToOpen();
    } else if (currentState === 'closed') {
      // Check if we've exceeded the failure threshold
      if (this.state.failureCount >= this.config.failureThreshold) {
        this.transitionToOpen();
      }
    }
  }

  private transitionToOpen(): void {
    this.state.state = 'open';
    this.state.halfOpenAttempts = 0;
  }

  private transitionToHalfOpen(): void {
    this.state.state = 'half-open';
    this.state.halfOpenAttempts = 0;
  }

  private transitionToClosed(): void {
    this.state.state = 'closed';
    this.state.failureCount = 0;
    this.state.halfOpenAttempts = 0;
    this.state.lastSuccessTime = Date.now();
  }

  reset(): void {
    this.state = {
      state: 'closed',
      failureCount: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      halfOpenAttempts: 0,
    };
  }

  getProviderUrl(): string {
    return this.providerUrl;
  }
}
