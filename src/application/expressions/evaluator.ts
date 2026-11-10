import crypto from 'node:crypto';
import { SecurityViolationError, ValidationError } from '../../domain/errors.js';

export interface ExpressionScope {
  $trigger: Record<string, unknown>;
  $vars: Record<string, unknown>;
  $steps: Record<string, { output?: unknown }>;
  $credentials?: Record<string, Record<string, unknown>>;
}

type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'BOOLEAN'
  | 'NULL'
  | 'IDENT'
  | 'OP'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA';

interface Token {
  type: TokenType;
  value: string;
}

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',' });
      i += 1;
      continue;
    }

    const two = input.slice(i, i + 2);
    if (['===', '!=='].includes(input.slice(i, i + 3))) {
      tokens.push({ type: 'OP', value: input.slice(i, i + 2) });
      i += 3;
      continue;
    }
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'OP', value: two });
      i += 2;
      continue;
    }
    if (['>', '<', '!', '+', '-', '*', '/', '%'].includes(ch)) {
      tokens.push({ type: 'OP', value: ch });
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      let str = '';
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          i += 1;
        }
        str += input[i];
        i += 1;
      }
      if (input[i] !== quote) {
        throw new ValidationError(`Unterminated string literal in expression: ${input}`);
      }
      i += 1;
      tokens.push({ type: 'STRING', value: str });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let num = '';
      while (i < input.length && /[0-9.]/.test(input[i]!)) {
        num += input[i];
        i += 1;
      }
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }

    if (/[$a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < input.length && /[$a-zA-Z0-9_.[\]]/.test(input[i]!)) {
        ident += input[i];
        i += 1;
      }
      if (ident === 'true' || ident === 'false') {
        tokens.push({ type: 'BOOLEAN', value: ident });
      } else if (ident === 'null') {
        tokens.push({ type: 'NULL', value: ident });
      } else {
        tokens.push({ type: 'IDENT', value: ident });
      }
      continue;
    }

    throw new ValidationError(`Unexpected token '${ch}' in expression '${input}'`);
  }

  return tokens;
}

function resolvePath(scope: ExpressionScope, path: string): unknown {
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  const segments = normalized.split('.');
  const rootKey = segments[0];
  if (!rootKey || FORBIDDEN_SEGMENTS.has(rootKey)) {
    throw new SecurityViolationError(`Forbidden expression root '${path}'`);
  }

  let current: unknown;
  if (rootKey === '$trigger') current = scope.$trigger;
  else if (rootKey === '$vars') current = scope.$vars;
  else if (rootKey === '$steps') current = scope.$steps;
  else if (rootKey === '$credentials') current = scope.$credentials ?? {};
  else return undefined;

  for (let i = 1; i < segments.length; i += 1) {
    const seg = segments[i]!;
    if (FORBIDDEN_SEGMENTS.has(seg)) {
      throw new SecurityViolationError(`Forbidden property access '${seg}' in expression`);
    }
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

class ExpressionParser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly scope: ExpressionScope,
  ) {}

  parse(): unknown {
    if (this.tokens.length === 0) return undefined;
    const val = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new ValidationError(`Unexpected token '${this.tokens[this.pos]!.value}' in expression`);
    }
    return val;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    const tok = this.tokens[this.pos];
    if (!tok) throw new ValidationError('Unexpected end of expression');
    this.pos += 1;
    return tok;
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.peek()?.type === 'OP' && this.peek()?.value === '||') {
      this.consume();
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseEquality();
    while (this.peek()?.type === 'OP' && this.peek()?.value === '&&') {
      this.consume();
      const right = this.parseEquality();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseEquality(): unknown {
    let left = this.parseComparison();
    while (this.peek()?.type === 'OP' && (this.peek()?.value === '==' || this.peek()?.value === '!=')) {
      const op = this.consume().value;
      const right = this.parseComparison();
      left = op === '==' ? left === right : left !== right;
    }
    return left;
  }

  private parseComparison(): unknown {
    let left = this.parseAdditive();
    while (
      this.peek()?.type === 'OP' &&
      ['>', '>=', '<', '<='].includes(this.peek()!.value)
    ) {
      const op = this.consume().value;
      const right = this.parseAdditive();
      const lNum = Number(left);
      const rNum = Number(right);
      if (op === '>') left = lNum > rNum;
      else if (op === '>=') left = lNum >= rNum;
      else if (op === '<') left = lNum < rNum;
      else left = lNum <= rNum;
    }
    return left;
  }

  private parseAdditive(): unknown {
    let left = this.parseMultiplicative();
    while (this.peek()?.type === 'OP' && (this.peek()?.value === '+' || this.peek()?.value === '-')) {
      const op = this.consume().value;
      const right = this.parseMultiplicative();
      if (op === '+') {
        if (typeof left === 'string' || typeof right === 'string') {
          left = `${String(left ?? '')}${String(right ?? '')}`;
        } else {
          left = Number(left) + Number(right);
        }
      } else {
        left = Number(left) - Number(right);
      }
    }
    return left;
  }

  private parseMultiplicative(): unknown {
    let left = this.parseUnary();
    while (
      this.peek()?.type === 'OP' &&
      ['*', '/', '%'].includes(this.peek()!.value)
    ) {
      const op = this.consume().value;
      const right = this.parseUnary();
      if (op === '*') left = Number(left) * Number(right);
      else if (op === '/') {
        const denom = Number(right);
        if (denom === 0) throw new ValidationError('Division by zero in expression');
        left = Number(left) / denom;
      } else {
        left = Number(left) % Number(right);
      }
    }
    return left;
  }

  private parseUnary(): unknown {
    if (this.peek()?.type === 'OP' && this.peek()?.value === '!') {
      this.consume();
      return !this.parseUnary();
    }
    if (this.peek()?.type === 'OP' && this.peek()?.value === '-') {
      this.consume();
      return -Number(this.parseUnary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): unknown {
    const tok = this.consume();
    if (tok.type === 'NUMBER') return Number(tok.value);
    if (tok.type === 'STRING') return tok.value;
    if (tok.type === 'BOOLEAN') return tok.value === 'true';
    if (tok.type === 'NULL') return null;

    if (tok.type === 'LPAREN') {
      const expr = this.parseOr();
      const close = this.consume();
      if (close.type !== 'RPAREN') {
        throw new ValidationError('Expected closing parenthesis in expression');
      }
      return expr;
    }

    if (tok.type === 'IDENT') {
      if (this.peek()?.type === 'LPAREN') {
        return this.parseFunctionCall(tok.value);
      }
      return resolvePath(this.scope, tok.value);
    }

    throw new ValidationError(`Unexpected token '${tok.value}' in expression`);
  }

  private parseFunctionCall(name: string): unknown {
    this.consume(); // '('
    const args: unknown[] = [];
    if (this.peek()?.type !== 'RPAREN') {
      args.push(this.parseOr());
      while (this.peek()?.type === 'COMMA') {
        this.consume();
        args.push(this.parseOr());
      }
    }
    const close = this.consume();
    if (close.type !== 'RPAREN') {
      throw new ValidationError(`Expected ')' after arguments to '${name}'`);
    }

    switch (name) {
      case '$now':
        return new Date().toISOString();
      case '$uuid':
        return crypto.randomUUID();
      case '$upper':
        return String(args[0] ?? '').toUpperCase();
      case '$lower':
        return String(args[0] ?? '').toLowerCase();
      case '$len':
        if (Array.isArray(args[0]) || typeof args[0] === 'string') return args[0].length;
        return 0;
      case '$coalesce':
        return args.find((a) => a !== undefined && a !== null) ?? null;
      default:
        throw new SecurityViolationError(`Disallowed expression function '${name}'`);
    }
  }
}

/**
 * Sandboxed AST-like recursive-descent expression evaluator (zero eval/Function).
 */
export function evaluateExpression(expr: string, scope: ExpressionScope): unknown {
  const tokens = tokenize(expr.trim());
  return new ExpressionParser(tokens, scope).parse();
}

/**
 * Resolves `{{ ... }}` templates inside strings, objects, and arrays.
 * If the entire string is a single `{{ expr }}`, preserves the native JS type (number/boolean/object).
 */
export function resolveTemplates(value: unknown, scope: ExpressionScope): unknown {
  if (typeof value === 'string') {
    const exactMatch = /^\{\{([\s\S]+?)\}\}$/.exec(value.trim());
    if (exactMatch && value.trim().indexOf('{{', 2) === -1) {
      return evaluateExpression(exactMatch[1]!, scope);
    }

    return value.replace(/\{\{([\s\S]+?)\}\}/g, (_, expr: string) => {
      const evaluated = evaluateExpression(expr, scope);
      if (evaluated === undefined || evaluated === null) return '';
      if (typeof evaluated === 'object') return JSON.stringify(evaluated);
      return String(evaluated);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplates(item, scope));
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveTemplates(v, scope);
    }
    return out;
  }

  return value;
}
