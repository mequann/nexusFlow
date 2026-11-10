import type { AppConfig } from '../../config/env.js';
import { ExternalServiceError, ValidationError } from '../../domain/errors.js';
import {
  type DecisionTableDefinition,
  evaluateDecisionTable,
} from '../../domain/workflow/decision-table.js';
import type { EdgeDefinition, NodeDefinition } from '../../domain/workflow/types.js';
import type { CircuitBreakerRegistry } from '../../infrastructure/resilience/circuit-breaker.js';
import { assertSafeOutboundUrl } from '../../infrastructure/security/ssrf-guard.js';
import {
  type ExpressionScope,
  evaluateExpression,
  resolveTemplates,
} from '../expressions/evaluator.js';
import type { CredentialService } from '../services/credential-service.js';

export type NodeExecutionOutcome =
  | {
      kind: 'CONTINUE';
      output: Record<string, unknown>;
      variablesPatch?: Record<string, unknown>;
      selectedBranch?: string;
      forkEdges?: EdgeDefinition[];
    }
  | {
      kind: 'WAIT_USER_TASK';
      taskConfig: {
        title: string;
        description: string;
        candidateGroup: string | null;
        assignee: string | null;
        formSchema: Record<string, unknown>;
        payload: Record<string, unknown>;
        dueAt: Date | null;
        escalateTo: string | null;
        requiredApprovals: number;
      };
    }
  | {
      kind: 'WAIT_TIMER';
      triggerAt: Date;
    }
  | {
      kind: 'WAIT_MESSAGE';
      messageName: string;
      correlationKey: string | null;
    }
  | {
      kind: 'END';
      output: Record<string, unknown>;
      variablesPatch?: Record<string, unknown>;
    };

export interface NodeExecutionContext {
  node: NodeDefinition;
  scope: ExpressionScope;
  outgoingEdges: EdgeDefinition[];
  credentialService: CredentialService;
  circuitBreaker: CircuitBreakerRegistry;
  config: AppConfig;
}

export type NodeExecutorFn = (ctx: NodeExecutionContext) => Promise<NodeExecutionOutcome>;

async function executeHttpNode(ctx: NodeExecutionContext): Promise<NodeExecutionOutcome> {
  const cfg = resolveTemplates(ctx.node.config, ctx.scope) as Record<string, unknown>;
  const rawUrl = String(cfg.url ?? '');
  if (!rawUrl) {
    throw new ValidationError(`action.http node '${ctx.node.id}' requires config.url`);
  }

  const parsedUrl = await assertSafeOutboundUrl(
    rawUrl,
    ctx.config.ALLOW_PRIVATE_NETWORK_HTTP,
  );
  const method = String(cfg.method ?? 'GET').toUpperCase();
  const timeoutMs = Number(cfg.timeoutMs ?? 10_000);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((cfg.headers as Record<string, string> | undefined) ?? {}),
  };

  if (typeof cfg.credentialName === 'string' && cfg.credentialName.trim()) {
    const cred = await ctx.credentialService.getDecryptedSecretByName(cfg.credentialName);
    if (cred.type === 'bearer' && typeof cred.data.token === 'string') {
      headers.authorization = `Bearer ${cred.data.token}`;
    } else if (cred.type === 'api_key') {
      const headerName = String(cred.data.headerName ?? 'x-api-key');
      headers[headerName] = String(cred.data.apiKey ?? '');
    } else if (cred.type === 'basic') {
      const encoded = Buffer.from(
        `${String(cred.data.username ?? '')}:${String(cred.data.password ?? '')}`,
      ).toString('base64');
      headers.authorization = `Basic ${encoded}`;
    } else if (cred.data.headers && typeof cred.data.headers === 'object') {
      Object.assign(headers, cred.data.headers);
    }
  }

  const body =
    cfg.body !== undefined && method !== 'GET' && method !== 'HEAD'
      ? typeof cfg.body === 'string'
        ? cfg.body
        : JSON.stringify(cfg.body)
      : undefined;

  const responseData = await ctx.circuitBreaker.execute(parsedUrl.host, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(parsedUrl.toString(), {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const text = await res.text();
      let parsedBody: unknown = text;
      try {
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        // Keep raw text when response is not JSON
      }

      if (res.status >= 500) {
        throw new ExternalServiceError(
          `HTTP ${res.status} from ${parsedUrl.host}`,
          true,
          { status: res.status, body: parsedBody },
        );
      }

      if (res.status >= 400) {
        throw new ExternalServiceError(
          `HTTP ${res.status} client error from ${parsedUrl.host}`,
          false,
          { status: res.status, body: parsedBody },
        );
      }

      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: parsedBody,
      };
    } catch (err) {
      if (err instanceof ExternalServiceError) throw err;
      throw new ExternalServiceError(
        err instanceof Error ? err.message : 'Outbound HTTP call failed',
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  });

  return {
    kind: 'CONTINUE',
    output: responseData,
  };
}

export class NodeExecutorRegistry {
  private readonly executors = new Map<string, NodeExecutorFn>();

  constructor() {
    this.registerDefaults();
  }

  register(type: string, fn: NodeExecutorFn): void {
    this.executors.set(type, fn);
  }

  get(type: string): NodeExecutorFn {
    const fn = this.executors.get(type);
    if (!fn) {
      throw new ValidationError(`No executor registered for node type '${type}'`);
    }
    return fn;
  }

  private registerDefaults(): void {
    const triggerHandler: NodeExecutorFn = async (ctx) => ({
      kind: 'CONTINUE',
      output: { triggered: true, payload: ctx.scope.$trigger },
    });

    this.register('trigger.manual', triggerHandler);
    this.register('trigger.webhook', triggerHandler);
    this.register('trigger.cron', triggerHandler);

    this.register('action.http', executeHttpNode);

    this.register('action.transform', async (ctx) => {
      const mapping = ctx.node.config.mapping ?? ctx.node.config.set ?? ctx.node.config;
      const resolved = resolveTemplates(mapping, ctx.scope);
      const output =
        resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)
          ? (resolved as Record<string, unknown>)
          : { value: resolved };

      const mergeToVars = ctx.node.config.mergeToVariables !== false;
      return {
        kind: 'CONTINUE',
        output,
        variablesPatch: mergeToVars ? output : undefined,
      };
    });

    this.register('logic.if', async (ctx) => {
      const condition = String(ctx.node.config.condition ?? 'false');
      const result = Boolean(evaluateExpression(condition, ctx.scope));
      const branch = result ? 'true' : 'false';
      return {
        kind: 'CONTINUE',
        output: { condition, result, branch },
        selectedBranch: branch,
      };
    });

    this.register('logic.switch', async (ctx) => {
      const expr = String(ctx.node.config.expression ?? '');
      const evaluated = expr ? evaluateExpression(expr, ctx.scope) : undefined;
      const candidateBranch = String(evaluated ?? 'default');
      const hasMatch = ctx.outgoingEdges.some((e) => e.branch === candidateBranch);
      const branch = hasMatch ? candidateBranch : 'default';
      return {
        kind: 'CONTINUE',
        output: { value: evaluated, branch },
        selectedBranch: branch,
      };
    });

    this.register('logic.parallel', async (ctx) => {
      return {
        kind: 'CONTINUE',
        output: { forkedBranches: ctx.outgoingEdges.length },
        forkEdges: ctx.outgoingEdges,
      };
    });

    this.register('logic.join', async () => {
      return {
        kind: 'CONTINUE',
        output: { joined: true },
      };
    });

    this.register('bpmn.decision_table', async (ctx) => {
      const table = ctx.node.config.table as DecisionTableDefinition | undefined;
      if (!table || !Array.isArray(table.rules)) {
        throw new ValidationError(
          `bpmn.decision_table node '${ctx.node.id}' requires config.table`,
        );
      }

      const rawInput = ctx.node.config.input
        ? resolveTemplates(ctx.node.config.input, ctx.scope)
        : ctx.scope.$vars;
      const inputObj =
        rawInput !== null && typeof rawInput === 'object'
          ? (rawInput as Record<string, unknown>)
          : {};

      const result = evaluateDecisionTable(table, inputObj);
      const mergeToVars =
        ctx.node.config.mergeToVariables !== false && !Array.isArray(result.outputs);

      return {
        kind: 'CONTINUE',
        output: {
          matchedRuleIds: result.matchedRuleIds,
          outputs: result.outputs,
        },
        variablesPatch: mergeToVars
          ? (result.outputs as Record<string, unknown>)
          : undefined,
      };
    });

    this.register('bpmn.user_task', async (ctx) => {
      const cfg = resolveTemplates(ctx.node.config, ctx.scope) as Record<string, unknown>;
      const dueInMs = cfg.dueInMs
        ? Number(cfg.dueInMs)
        : cfg.slaMinutes
          ? Number(cfg.slaMinutes) * 60_000
          : null;
      const requiredApprovals = cfg.requiredApprovals
        ? Math.max(1, Number(cfg.requiredApprovals))
        : 1;
      return {
        kind: 'WAIT_USER_TASK',
        taskConfig: {
          title: String(cfg.title ?? ctx.node.name),
          description: String(cfg.description ?? ''),
          candidateGroup: cfg.candidateGroup ? String(cfg.candidateGroup) : null,
          assignee: cfg.assignee ? String(cfg.assignee) : null,
          formSchema: (cfg.formSchema as Record<string, unknown> | undefined) ?? {},
          payload: (cfg.payload as Record<string, unknown> | undefined) ?? { ...ctx.scope.$vars },
          dueAt: dueInMs !== null ? new Date(Date.now() + dueInMs) : null,
          escalateTo: cfg.escalateTo ? String(cfg.escalateTo) : null,
          requiredApprovals,
        },
      };
    });

    this.register('bpmn.timer', async (ctx) => {
      const cfg = resolveTemplates(ctx.node.config, ctx.scope) as Record<string, unknown>;
      let triggerAt: Date;
      if (cfg.untilIso) {
        triggerAt = new Date(String(cfg.untilIso));
      } else {
        const delayMs = Number(cfg.delayMs ?? 1000);
        triggerAt = new Date(Date.now() + Math.max(0, delayMs));
      }
      if (Number.isNaN(triggerAt.getTime())) {
        throw new ValidationError(`Invalid timer configuration on node '${ctx.node.id}'`);
      }
      return {
        kind: 'WAIT_TIMER',
        triggerAt,
      };
    });

    this.register('bpmn.message_catch', async (ctx) => {
      const cfg = resolveTemplates(ctx.node.config, ctx.scope) as Record<string, unknown>;
      const messageName = String(cfg.messageName ?? '');
      if (!messageName) {
        throw new ValidationError(
          `bpmn.message_catch node '${ctx.node.id}' requires config.messageName`,
        );
      }
      const correlationKey =
        cfg.correlationKey !== undefined && cfg.correlationKey !== null
          ? String(cfg.correlationKey)
          : null;
      return {
        kind: 'WAIT_MESSAGE',
        messageName,
        correlationKey,
      };
    });

    this.register('bpmn.end', async (ctx) => {
      const output = ctx.node.config.output
        ? (resolveTemplates(ctx.node.config.output, ctx.scope) as Record<string, unknown>)
        : { completed: true };
      return {
        kind: 'END',
        output,
      };
    });
  }
}
