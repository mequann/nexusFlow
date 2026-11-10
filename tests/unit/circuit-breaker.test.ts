import { describe, expect, it } from 'vitest';
import { ExternalServiceError } from '../../src/domain/errors.js';
import { CircuitBreakerRegistry } from '../../src/infrastructure/resilience/circuit-breaker.js';

describe('Circuit Breaker Registry', () => {
  it('transitions CLOSED -> OPEN -> HALF_OPEN -> CLOSED', async () => {
    let clock = 1000;
    const breaker = new CircuitBreakerRegistry({
      failureThreshold: 2,
      resetTimeoutMs: 5000,
      halfOpenSuccessThreshold: 1,
    });

    await expect(
      breaker.execute(
        'api.stripe.com',
        async () => {
          throw new Error('503');
        },
        () => clock,
      ),
    ).rejects.toThrow('503');

    await expect(
      breaker.execute(
        'api.stripe.com',
        async () => {
          throw new Error('503');
        },
        () => clock,
      ),
    ).rejects.toThrow('503');

    expect(breaker.getState('api.stripe.com', clock)).toBe('OPEN');

    await expect(
      breaker.execute('api.stripe.com', async () => 'ok', () => clock),
    ).rejects.toThrow(ExternalServiceError);

    clock += 6000;
    expect(breaker.getState('api.stripe.com', clock)).toBe('HALF_OPEN');

    const res = await breaker.execute('api.stripe.com', async () => 'recovered', () => clock);
    expect(res).toBe('recovered');
    expect(breaker.getState('api.stripe.com', clock)).toBe('CLOSED');
  });
});

