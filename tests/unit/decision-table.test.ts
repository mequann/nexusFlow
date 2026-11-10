import { describe, expect, it } from 'vitest';
import {
  type DecisionTableDefinition,
  evaluateDecisionTable,
} from '../../src/domain/workflow/decision-table.js';

describe('Camunda DMN-lite Decision Table', () => {
  const table: DecisionTableDefinition = {
    hitPolicy: 'FIRST',
    rules: [
      {
        id: 'vip-high',
        when: [
          { field: 'customer.tier', op: '==', value: 'VIP' },
          { field: 'amount', op: '>=', value: 1000 },
        ],
        outputs: { requiresApproval: true, discountPct: 15, riskTier: 'MEDIUM' },
      },
      {
        id: 'vip-low',
        when: [{ field: 'customer.tier', op: '==', value: 'VIP' }],
        outputs: { requiresApproval: false, discountPct: 10, riskTier: 'LOW' },
      },
      {
        id: 'blocked-country',
        when: [{ field: 'country', op: 'in', value: ['XX', 'YY'] }],
        outputs: { requiresApproval: true, discountPct: 0, riskTier: 'HIGH' },
      },
    ],
    defaultOutputs: { requiresApproval: false, discountPct: 0, riskTier: 'LOW' },
  };

  it('evaluates FIRST hit policy accurately', () => {
    const res = evaluateDecisionTable(table, {
      customer: { tier: 'VIP' },
      amount: 2500,
      country: 'ET',
    });
    expect(res.matchedRuleIds).toEqual(['vip-high']);
    expect(res.outputs).toEqual({ requiresApproval: true, discountPct: 15, riskTier: 'MEDIUM' });
  });

  it('returns defaultOutputs when no rule matches under FIRST policy', () => {
    const res = evaluateDecisionTable(table, { customer: { tier: 'STANDARD' }, amount: 50 });
    expect(res.matchedRuleIds).toEqual([]);
    expect(res.outputs).toEqual({ requiresApproval: false, discountPct: 0, riskTier: 'LOW' });
  });

  it('supports COLLECT hit policy returning all matching rule outputs', () => {
    const collectTable: DecisionTableDefinition = {
      ...table,
      hitPolicy: 'COLLECT',
    };
    const res = evaluateDecisionTable(collectTable, {
      customer: { tier: 'VIP' },
      amount: 2500,
    });
    expect(res.matchedRuleIds).toEqual(['vip-high', 'vip-low']);
    expect(Array.isArray(res.outputs)).toBe(true);
    expect((res.outputs as unknown[]).length).toBe(2);
  });
});

