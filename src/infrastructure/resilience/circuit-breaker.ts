import { ExternalServiceError } from '../../domain/errors.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenSuccessThreshold?: number;
}

interface BreakerBucket {
  state: CircuitState;
  failures: number;
  halfOpenSuccesses: number;
  openedAt: number;
}

/**
 * Per-target Circuit Breaker protecting outbound HTTP action nodes from cascading failures.
 */
export class CircuitBreakerRegistry {
  private readonly buckets = new Map<string, BreakerBucket>();
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;

  constructor(options: CircuitBreakerOptions = { failureThreshold: 5, resetTimeoutMs: 30_000 }) {
    this.failureThreshold = options.failureThreshold;
    this.resetTimeoutMs = options.resetTimeoutMs;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 2;
  }

  getState(key: string, now = Date.now()): CircuitState {
    const bucket = this.buckets.get(key);
    if (!bucket) return 'CLOSED';
    if (bucket.state === 'OPEN' && now - bucket.openedAt >= this.resetTimeoutMs) {
      bucket.state = 'HALF_OPEN';
      bucket.halfOpenSuccesses = 0;
    }
    return bucket.state;
  }

  async execute<T>(key: string, fn: () => Promise<T>, nowProvider = () => Date.now()): Promise<T> {
    const now = nowProvider();
    const state = this.getState(key, now);

    if (state === 'OPEN') {
      throw new ExternalServiceError(`Circuit breaker is OPEN for target '${key}'`, true);
    }

    try {
      const result = await fn();
      this.recordSuccess(key);
      return result;
    } catch (err) {
      this.recordFailure(key, nowProvider());
      throw err;
    }
  }

  private recordSuccess(key: string): void {
    const bucket = this.buckets.get(key);
    if (!bucket) return;

    if (bucket.state === 'HALF_OPEN') {
      bucket.halfOpenSuccesses += 1;
      if (bucket.halfOpenSuccesses >= this.halfOpenSuccessThreshold) {
        this.buckets.delete(key);
      }
      return;
    }

    bucket.failures = 0;
  }

  private recordFailure(key: string, now: number): void {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { state: 'CLOSED', failures: 0, halfOpenSuccesses: 0, openedAt: 0 };
      this.buckets.set(key, bucket);
    }

    if (bucket.state === 'HALF_OPEN') {
      bucket.state = 'OPEN';
      bucket.openedAt = now;
      bucket.halfOpenSuccesses = 0;
      return;
    }

    bucket.failures += 1;
    if (bucket.failures >= this.failureThreshold) {
      bucket.state = 'OPEN';
      bucket.openedAt = now;
    }
  }
}

