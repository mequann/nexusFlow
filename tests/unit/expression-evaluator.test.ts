import { describe, expect, it } from 'vitest';
import {
  type ExpressionScope,
  evaluateExpression,
  resolveTemplates,
} from '../../src/application/expressions/evaluator.js';
import { SecurityViolationError } from '../../src/domain/errors.js';

const baseScope: ExpressionScope = {
  $trigger: { body: { orderId: 'ord-42', amount: 1500, country: 'ET' } },
  $vars: { tier: 'VIP', discount: 10, items: ['a', 'b', 'c'] },
  $steps: { fetchUser: { output: { creditLimit: 5000, active: true } } },
};

describe('Safe Expression Evaluator', () => {
  it('evaluates nested paths, comparisons, and boolean logic', () => {
    expect(
      evaluateExpression("$trigger.body.amount > 1000 && $vars.tier == 'VIP'", baseScope),
    ).toBe(true);
    expect(
      evaluateExpression('$steps.fetchUser.output.creditLimit >= $trigger.body.amount', baseScope),
    ).toBe(true);
    expect(evaluateExpression('($trigger.body.amount - 500) * 2', baseScope)).toBe(2000);
  });

  it('resolves exact templates preserving native types and string interpolation', () => {
    const resolved = resolveTemplates(
      {
        amount: '{{ $trigger.body.amount }}',
        summary: 'Order {{ $trigger.body.orderId }} for {{ $upper($vars.tier) }}',
        count: '{{ $len($vars.items) }}',
        fallback: "{{ $coalesce($vars.missing, 'standard') }}",
      },
      baseScope,
    ) as Record<string, unknown>;

    expect(resolved.amount).toBe(1500);
    expect(resolved.summary).toBe('Order ord-42 for VIP');
    expect(resolved.count).toBe(3);
    expect(resolved.fallback).toBe('standard');
  });

  it('blocks prototype pollution and disallowed function calls', () => {
    expect(() => evaluateExpression('$vars.__proto__.polluted', baseScope)).toThrow(
      SecurityViolationError,
    );
    expect(() => evaluateExpression('$vars.constructor', baseScope)).toThrow(
      SecurityViolationError,
    );
    expect(() => evaluateExpression('process.exit(1)', baseScope)).toThrow(
      SecurityViolationError,
    );
  });
});

