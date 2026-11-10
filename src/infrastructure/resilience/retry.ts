import type { RetryPolicy } from '../../domain/workflow/types.js';

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 500,
  backoffMultiplier: 2,
  maxDelayMs: 30_000,
};

/**
 * Exponential backoff with full jitter to prevent thundering herd retries.
 */
export function computeBackoffDelayMs(attempt: number, policy: RetryPolicy): number {
  const exp = Math.max(0, attempt - 1);
  const raw = Math.min(
    policy.maxDelayMs,
    policy.initialDelayMs * Math.pow(policy.backoffMultiplier, exp),
  );
  return Math.floor(Math.random() * (raw + 1));
}

