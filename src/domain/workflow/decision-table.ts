import { ValidationError } from '../errors.js';

export type HitPolicy = 'FIRST' | 'COLLECT';

export type RuleOperator = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'contains' | '*';

export interface RuleCondition {
  field: string;
  op: RuleOperator;
  value?: unknown;
}

export interface DecisionRule {
  id: string;
  when: RuleCondition[];
  outputs: Record<string, unknown>;
}

export interface DecisionTableDefinition {
  hitPolicy: HitPolicy;
  rules: DecisionRule[];
  defaultOutputs?: Record<string, unknown>;
}

export interface DecisionEvaluationResult {
  matchedRuleIds: string[];
  outputs: Record<string, unknown> | Record<string, unknown>[];
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

function matchesCondition(input: Record<string, unknown>, cond: RuleCondition): boolean {
  if (cond.op === '*') return true;
  const actual = getNestedValue(input, cond.field);

  switch (cond.op) {
    case '==':
      return actual === cond.value;
    case '!=':
      return actual !== cond.value;
    case '>':
      return typeof actual === 'number' && typeof cond.value === 'number' && actual > cond.value;
    case '>=':
      return typeof actual === 'number' && typeof cond.value === 'number' && actual >= cond.value;
    case '<':
      return typeof actual === 'number' && typeof cond.value === 'number' && actual < cond.value;
    case '<=':
      return typeof actual === 'number' && typeof cond.value === 'number' && actual <= cond.value;
    case 'in':
      return Array.isArray(cond.value) && cond.value.includes(actual);
    case 'contains':
      if (typeof actual === 'string' && typeof cond.value === 'string') {
        return actual.includes(cond.value);
      }
      if (Array.isArray(actual)) {
        return actual.includes(cond.value);
      }
      return false;
    default:
      throw new ValidationError(`Unsupported decision operator: ${String(cond.op)}`);
  }
}

/**
 * Camunda DMN-lite Decision Table Evaluator supporting FIRST and COLLECT hit policies.
 */
export function evaluateDecisionTable(
  table: DecisionTableDefinition,
  input: Record<string, unknown>,
): DecisionEvaluationResult {
  const matched: DecisionRule[] = [];

  for (const rule of table.rules) {
    const allMatch = rule.when.every((cond) => matchesCondition(input, cond));
    if (allMatch) {
      matched.push(rule);
      if (table.hitPolicy === 'FIRST') {
        return {
          matchedRuleIds: [rule.id],
          outputs: { ...rule.outputs },
        };
      }
    }
  }

  if (table.hitPolicy === 'FIRST') {
    return {
      matchedRuleIds: [],
      outputs: table.defaultOutputs ? { ...table.defaultOutputs } : {},
    };
  }

  return {
    matchedRuleIds: matched.map((r) => r.id),
    outputs: matched.map((r) => ({ ...r.outputs })),
  };
}
