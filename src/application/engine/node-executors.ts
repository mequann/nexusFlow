import { Injectable } from '@nestjs/common';
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
      kind: 'WAIT_EXTERNAL_TASK';
      topic: string;
      retries: number;
      variables: Record<string, unknown>;
    }
  | {
      kind: 'WAIT_SUB_WORKFLOW';
      workflowKey: string;
      version?: number;
      variables: Record<string, unknown>;
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

export interface ConnectorDescriptor {
  type: string;
  category: 'trigger' | 'action' | 'logic' | 'bpmn' | 'kissflow' | 'custom';
  title: string;
  description: string;
  builtin: boolean;
  configSchema: Record<string, unknown>;
}

export interface RegisterHttpConnectorInput {
  type: string;
  title: string;
  description: string;
  endpointUrl: string;
  method?: string;
  credentialName?: string;
  defaultHeaders?: Record<string, string>;
  configSchema?: Record<string, unknown>;
}

async function executeOutboundHttp(
  ctx: NodeExecutionContext,
  cfg: Record<string, unknown>,
): Promise<NodeExecutionOutcome> {
  const rawUrl = String(cfg.url ?? '');
  if (!rawUrl) {
    throw new ValidationError(`HTTP node '${ctx.node.id}' requires config.url`);
  }

  const parsedUrl = await assertSafeOutboundUrl(rawUrl, ctx.config.ALLOW_PRIVATE_NETWORK_HTTP);
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
        throw new ExternalServiceError(`HTTP ${res.status} from ${parsedUrl.host}`, true, {
          status: res.status,
          body: parsedBody,
        });
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

@Injectable()
export class NodeExecutorRegistry {
  private readonly executors = new Map<string, NodeExecutorFn>();
  private readonly descriptors = new Map<string, ConnectorDescriptor>();

  constructor() {
    this.registerDefaults();
  }

  register(descriptor: ConnectorDescriptor, fn: NodeExecutorFn): void {
    this.descriptors.set(descriptor.type, descriptor);
    this.executors.set(descriptor.type, fn);
  }

  /**
   * Dynamically registers a custom HTTP-backed connector plugin at runtime
   * (e.g. `connector.sap_create_po`, `connector.slack_notify`) without redeploying the engine.
   */
  registerHttpConnector(input: RegisterHttpConnectorInput): ConnectorDescriptor {
    const descriptor: ConnectorDescriptor = {
      type: input.type,
      category: 'custom',
      title: input.title,
      description: input.description,
      builtin: false,
      configSchema: input.configSchema ?? {
        type: 'object',
        description: 'Dynamic input payload forwarded to the custom connector endpoint',
      },
    };

    this.register(descriptor, async (ctx) => {
      const resolvedInput = resolveTemplates(ctx.node.config, ctx.scope) as Record<string, unknown>;
      return executeOutboundHttp(ctx, {
        url: input.endpointUrl,
        method: input.method ?? 'POST',
        credentialName: input.credentialName,
        headers: input.defaultHeaders,
        body: resolvedInput,
      });
    });

    return descriptor;
  }

  listConnectors(): ConnectorDescriptor[] {
    return [...this.descriptors.values()];
  }

  get(type: string): NodeExecutorFn {
    const fn = this.executors.get(type);
    if (fn) return fn;

    // Enterprise Camunda External Task fallback: any unregistered `external.*` type
    // automatically behaves as a dynamic topic-based External Task queue!
    if (type.startsWith('external.')) {
      return async (ctx) => {
        const resolved = resolveTemplates(ctx.node.config, ctx.scope) as Record<string, unknown>;
        return {
          kind: 'WAIT_EXTERNAL_TASK',
          topic: String(resolved.topic ?? type),
          retries: Number(resolved.retries ?? 3),
          variables: { ...ctx.scope.$vars, ...resolved },
        };
      };
    }

    throw new ValidationError(
      `No executor or dynamic connector registered for node type '${type}' (use 'external.<topic>' or POST /api/v1/connectors)`,
    );
  }

  private registerDefaults(): void {
    const triggerHandler: NodeExecutorFn = async (ctx) => ({
      kind: 'CONTINUE',
      output: { triggered: true, payload: ctx.scope.$trigger },
    });

    this.register(
      {
        type: 'trigger.manual',
        category: 'trigger',
        title: 'Manual / API Trigger',
        description: 'Starts a workflow via REST API',
        builtin: true,
        configSchema: {},
      },
      triggerHandler,
    );

    this.register(
      {
        type: 'trigger.webhook',
        category: 'trigger',
        title: 'Webhook Trigger',
        description: 'Starts a workflow from signed HTTP webhooks',
        builtin: true,
        configSchema: { path: 'string' },
      },
      triggerHandler,
    );

    this.register(
      {
        type: 'trigger.cron',
        category: 'trigger',
        title: 'Cron Schedule Trigger',
        description: 'Starts a workflow on a recurring cron schedule',
        builtin: true,
        configSchema: { expression: 'string' },
      },
      triggerHandler,
    );

    this.register(
      {
        type: 'action.http',
        category: 'action',
        title: 'Outbound HTTP Connector',
        description: 'SSRF-guarded HTTP call with AES-256-GCM credential injection & Circuit Breaker',
        builtin: true,
        configSchema: { url: 'string', method: 'string', headers: 'object', body: 'any', credentialName: 'string' },
      },
      async (ctx) => {
        const cfg = resolveTemplates(ctx.node.config, ctx.scope) as Record<string, unknown>;
        return executeOutboundHttp(ctx, cfg);
      },
    );

    this.register(
      {
        type: 'action.transform',
        category: 'action',
        title: 'Data Mapper & Transform',
        description: 'Maps and enriches variables using sandboxed {{ ... }} templates',
        builtin: true,
        configSchema: { mapping: 'object', mergeToVariables: 'boolean' },
      },
      async (ctx) => {
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
      },
    );

    this.register(
      {
        type: 'action.script',
        category: 'action',
        title: 'Sandboxed Expression Script',
        description: 'Executes dynamic multi-variable assignments safely without eval()',
        builtin: true,
        configSchema: { assignments: 'Record<string, string>' },
      },
      async (ctx) => {
        const assignments = (ctx.node.config.assignments ?? {}) as Record<string, unknown>;
        const localVars = { ...ctx.scope.$vars };
        const result: Record<string, unknown> = {};

        for (const [key, expr] of Object.entries(assignments)) {
          const val = resolveTemplates(expr, { ...ctx.scope, $vars: localVars });
          localVars[key] = val;
          result[key] = val;
        }

        return {
          kind: 'CONTINUE',
          output: result,
          variablesPatch: result,
        };
      },
    );

    this.register(
      {
        type: 'logic.if',
        category: 'logic',
        title: 'Conditional Branch (IF)',
        description: 'Routes execution to true/false branch based on a sandboxed expression',
        builtin: true,
        configSchema: { condition: 'string' },
      },
      async (ctx) => {
        const condition = String(ctx.node.config.condition ?? 'false');
        const result = Boolean(evaluateExpression(condition, ctx.scope));
        const branch = result ? 'true' : 'false';
        return {
          kind: 'CONTINUE',
          output: { condition, result, branch },
          selectedBranch: branch,
        };
      },
    );

    this.register(
      {
        type: 'logic.switch',
        category: 'logic',
        title: 'Dynamic Multi-Way Switch',
        description: 'Routes execution to matching branch label or default',
        builtin: true,
        configSchema: { expression: 'string' },
      },
      async (ctx) => {
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
      },
    );

    this.register(
      {
        type: 'logic.parallel',
        category: 'logic',
        title: 'Parallel Fork Gateway',
        description: 'Splits execution into concurrent child tokens across all outgoing edges',
        builtin: true,
        configSchema: {},
      },
      async (ctx) => ({
        kind: 'CONTINUE',
        output: { forkedBranches: ctx.outgoingEdges.length },
        forkEdges: ctx.outgoingEdges,
      }),
    );

    this.register(
      {
        type: 'logic.join',
        category: 'logic',
        title: 'Parallel Join Barrier',
        description: 'Synchronizes parallel tokens until all incoming branches arrive',
        builtin: true,
        configSchema: {},
      },
      async () => ({
        kind: 'CONTINUE',
        output: { joined: true },
      }),
    );

    this.register(
      {
        type: 'logic.for_each',
        category: 'logic',
        title: 'Dynamic Multi-Instance For-Each Loop',
        description: 'Iterates over a runtime array expression and applies dynamic mapping per item',
        builtin: true,
        configSchema: { items: 'string | array', itemVar: 'string', map: 'object' },
      },
      async (ctx) => {
        const itemsVal = resolveTemplates(ctx.node.config.items, ctx.scope);
        if (!Array.isArray(itemsVal)) {
          throw new ValidationError(
            `logic.for_each node '${ctx.node.id}' requires config.items to resolve to an array`,
          );
        }

        const itemVar = String(ctx.node.config.itemVar ?? 'item');
        const mapTemplate = ctx.node.config.map ?? `{{ $vars.${itemVar} }}`;
        const results: unknown[] = [];

        for (let idx = 0; idx < itemsVal.length; idx += 1) {
          const iterScope: ExpressionScope = {
            ...ctx.scope,
            $vars: {
              ...ctx.scope.$vars,
              [itemVar]: itemsVal[idx],
              $index: idx,
            },
          };
          results.push(resolveTemplates(mapTemplate, iterScope));
        }

        const output = { count: results.length, results };
        return {
          kind: 'CONTINUE',
          output,
          variablesPatch: ctx.node.outputKey ? { [ctx.node.outputKey]: results } : undefined,
        };
      },
    );

    this.register(
      {
        type: 'bpmn.decision_table',
        category: 'bpmn',
        title: 'DMN Decision Table',
        description: 'Evaluates FIRST or COLLECT business rule tables dynamically',
        builtin: true,
        configSchema: { table: 'DecisionTableDefinition', input: 'object' },
      },
      async (ctx) => {
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
      },
    );

    this.register(
      {
        type: 'bpmn.user_task',
        category: 'bpmn',
        title: 'Human User Task',
        description: 'Pauses token for human approval, form submission, delegation, quorum & SLA',
        builtin: true,
        configSchema: {
          title: 'string',
          candidateGroup: 'string',
          assignee: 'string',
          requiredApprovals: 'number',
          slaMinutes: 'number',
          escalateTo: 'string',
          formSchema: 'object',
        },
      },
      async (ctx) => {
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
      },
    );

    this.register(
      {
        type: 'kissflow.approval_matrix',
        category: 'kissflow',
        title: 'Dynamic Kissflow Approval Matrix',
        description:
          'Dynamically resolves approver, candidateGroup, quorum, and SLA from runtime rules',
        builtin: true,
        configSchema: {
          rules: 'Array<{ when?: string; assignee?: string; candidateGroup?: string; requiredApprovals?: number; slaMinutes?: number; escalateTo?: string }>',
          defaultRule: 'object',
          formSchema: 'object',
        },
      },
      async (ctx) => {
        const cfg = ctx.node.config;
        const rules = Array.isArray(cfg.rules)
          ? (cfg.rules as Array<Record<string, unknown>>)
          : [];

        let matchedRule: Record<string, unknown> | undefined;
        for (const rule of rules) {
          if (!rule.when || Boolean(evaluateExpression(String(rule.when), ctx.scope))) {
            matchedRule = rule;
            break;
          }
        }
        const selected = matchedRule ?? (cfg.defaultRule as Record<string, unknown> | undefined) ?? {};
        const resolved = resolveTemplates(selected, ctx.scope) as Record<string, unknown>;
        const slaMinutes = resolved.slaMinutes ? Number(resolved.slaMinutes) : null;

        return {
          kind: 'WAIT_USER_TASK',
          taskConfig: {
            title: String(resolved.title ?? resolveTemplates(cfg.title ?? ctx.node.name, ctx.scope)),
            description: String(resolved.description ?? ''),
            candidateGroup: resolved.candidateGroup ? String(resolved.candidateGroup) : null,
            assignee: resolved.assignee ? String(resolved.assignee) : null,
            formSchema: (cfg.formSchema as Record<string, unknown> | undefined) ?? {},
            payload: { ...ctx.scope.$vars },
            dueAt: slaMinutes !== null ? new Date(Date.now() + slaMinutes * 60_000) : null,
            escalateTo: resolved.escalateTo ? String(resolved.escalateTo) : null,
            requiredApprovals: resolved.requiredApprovals
              ? Math.max(1, Number(resolved.requiredApprovals))
              : 1,
          },
        };
      },
    );

    this.register(
      {
        type: 'bpmn.external_task',
        category: 'bpmn',
        title: 'External Service Task (Polyglot Worker Topic)',
        description:
          'Creates a durable topic task locked and completed asynchronously by external microservices',
        builtin: true,
        configSchema: { topic: 'string', retries: 'number', payload: 'object' },
      },
      async (ctx) => {
        const cfg = resolveTemplates(ctx.node.config, ctx.scope) as Record<string, unknown>;
        const topic = String(cfg.topic ?? '');
        if (!topic) {
          throw new ValidationError(
            `bpmn.external_task node '${ctx.node.id}' requires config.topic`,
          );
        }
        return {
          kind: 'WAIT_EXTERNAL_TASK',
          topic,
          retries: Number(cfg.retries ?? 3),
          variables: {
            ...ctx.scope.$vars,
            ...((cfg.payload as Record<string, unknown> | undefined) ?? {}),
          },
        };
      },
    );

    this.register(
      {
        type: 'bpmn.call_activity',
        category: 'bpmn',
        title: 'Dynamic Sub-Workflow Call Activity',
        description:
          'Dynamically invokes another published workflow by runtime expression and awaits completion',
        builtin: true,
        configSchema: { workflowKey: 'string', version: 'number', inputVariables: 'object' },
      },
      async (ctx) => {
        const cfg = resolveTemplates(ctx.node.config, ctx.scope) as Record<string, unknown>;
        const workflowKey = String(cfg.workflowKey ?? '');
        if (!workflowKey) {
          throw new ValidationError(
            `bpmn.call_activity node '${ctx.node.id}' requires config.workflowKey`,
          );
        }
        return {
          kind: 'WAIT_SUB_WORKFLOW',
          workflowKey,
          version: cfg.version ? Number(cfg.version) : undefined,
          variables: {
            ...ctx.scope.$vars,
            ...((cfg.inputVariables as Record<string, unknown> | undefined) ?? {}),
          },
        };
      },
    );

    this.register(
      {
        type: 'bpmn.timer',
        category: 'bpmn',
        title: 'Durable Timer Event',
        description: 'Pauses token until a relative duration or ISO timestamp',
        builtin: true,
        configSchema: { delayMs: 'number', untilIso: 'string' },
      },
      async (ctx) => {
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
      },
    );

    this.register(
      {
        type: 'bpmn.message_catch',
        category: 'bpmn',
        title: 'Message Correlation Catch Event',
        description: 'Pauses token until an external business message correlates to it',
        builtin: true,
        configSchema: { messageName: 'string', correlationKey: 'string' },
      },
      async (ctx) => {
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
      },
    );

    this.register(
      {
        type: 'bpmn.end',
        category: 'bpmn',
        title: 'End Event',
        description: 'Completes the active execution token (and instance when all tokens finish)',
        builtin: true,
        configSchema: { output: 'object' },
      },
      async (ctx) => {
        const output = ctx.node.config.output
          ? (resolveTemplates(ctx.node.config.output, ctx.scope) as Record<string, unknown>)
          : { completed: true };
        return {
          kind: 'END',
          output,
        };
      },
    );
  }
}
