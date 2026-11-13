/**
 * NexusFlow Polyglot Client SDK
 * Lightweight, zero-dependency client library for integrating any external service,
 * microservice, script, or worker with NexusFlow.
 */

export interface NexusFlowClientOptions {
  baseUrl: string;
  apiKey?: string;
  bearerToken?: string;
  tenantId?: string;
  timeoutMs?: number;
}

export interface StartWorkflowOptions {
  variables?: Record<string, unknown>;
  triggerPayload?: Record<string, unknown>;
  version?: number;
  correlationKey?: string;
  idempotencyKey?: string;
  parentInstanceId?: string;
  parentTokenId?: string;
  tenantId?: string;
}

export interface WorkerOptions {
  topic: string | string[];
  workerId: string;
  concurrency?: number;
  pollIntervalMs?: number;
  lockDurationMs?: number;
  heartbeatIntervalMs?: number;
}

export interface LockedTask {
  id: string;
  instanceId: string;
  tokenId: string;
  nodeId: string;
  topic: string;
  variables: Record<string, unknown>;
  retries: number;
  lockExpiresAt: string | null;
}

export interface BoundTask extends LockedTask {
  heartbeat: (progress?: Record<string, unknown>, extendLockMs?: number) => Promise<void>;
}

export type TaskHandler = (task: BoundTask) => Promise<Record<string, unknown> | void>;

export interface ActiveWorker {
  start: () => void;
  stop: () => Promise<void>;
  isRunning: () => boolean;
}

export class NexusFlowClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private bearerToken?: string;
  private readonly defaultTenant: string;
  private readonly timeoutMs: number;

  constructor(options: NexusFlowClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.bearerToken = options.bearerToken;
    this.defaultTenant = options.tenantId ?? 'default';
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  setBearerToken(token: string): void {
    this.bearerToken = token;
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-tenant-id': this.defaultTenant,
      ...(options.headers ?? {}),
    };

    if (this.bearerToken) {
      headers.Authorization = `Bearer ${this.bearerToken}`;
    }
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      let data: unknown;
      try {
        data = text.length > 0 ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        const errorMsg =
          typeof data === 'object' && data !== null && 'message' in data
            ? String((data as { message: unknown }).message)
            : `HTTP ${res.status} ${res.statusText}`;
        const error = new Error(`NexusFlow API Error (${res.status}): ${errorMsg}`);
        (error as unknown as Record<string, unknown>).status = res.status;
        (error as unknown as Record<string, unknown>).response = data;
        throw error;
      }

      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // ==========================================
  // Workflows API
  // ==========================================
  readonly workflows = {
    start: async (key: string, options: StartWorkflowOptions = {}) => {
      const headers: Record<string, string> = {};
      if (options.idempotencyKey) {
        headers['idempotency-key'] = options.idempotencyKey;
      }
      return this.request<{ id: string; status: string; workflowKey: string }>(
        `/api/v1/workflows/${encodeURIComponent(key)}/instances`,
        {
          method: 'POST',
          headers,
          body: {
            payload: options.triggerPayload ?? {},
            variables: options.variables ?? {},
            version: options.version,
            correlationKey: options.correlationKey,
          },
        },
      );
    },

    get: async (instanceId: string) => {
      return this.request<{
        id: string;
        workflowKey: string;
        workflowVersion: number;
        status: string;
        currentStage: string | null;
        variables: Record<string, unknown>;
        completedAt: string | null;
      }>(`/api/v1/instances/${encodeURIComponent(instanceId)}`);
    },

    list: async (filters: { status?: string; workflowKey?: string; limit?: number } = {}) => {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.workflowKey) params.set('workflowKey', filters.workflowKey);
      if (filters.limit) params.set('limit', String(filters.limit));
      const qs = params.toString();
      return this.request<Array<{ id: string; status: string; workflowKey: string }>>(
        `/api/v1/instances${qs ? `?${qs}` : ''}`,
      );
    },

    cancel: async (instanceId: string, reason?: string) => {
      return this.request(`/api/v1/instances/${encodeURIComponent(instanceId)}/cancel`, {
        method: 'POST',
        body: { reason },
      });
    },

    terminate: async (instanceId: string, reason?: string) => {
      return this.request(`/api/v1/instances/${encodeURIComponent(instanceId)}/terminate`, {
        method: 'POST',
        body: { reason },
      });
    },

    reset: async (instanceId: string, targetNodeId: string, reason?: string) => {
      return this.request(`/api/v1/instances/${encodeURIComponent(instanceId)}/reset`, {
        method: 'POST',
        body: { targetNodeId, reason },
      });
    },

    waitForCompletion: async (
      instanceId: string,
      options: { timeoutMs?: number; pollIntervalMs?: number } = {},
    ) => {
      const timeout = options.timeoutMs ?? 60000;
      const pollInterval = options.pollIntervalMs ?? 500;
      const deadline = Date.now() + timeout;

      while (Date.now() < deadline) {
        const instance = await this.workflows.get(instanceId);
        if (['COMPLETED', 'FAILED', 'CANCELLED', 'CONTINUED_AS_NEW'].includes(instance.status)) {
          return instance;
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
      throw new Error(`Instance '${instanceId}' timed out after ${timeout}ms without completing`);
    },
  };

  // ==========================================
  // External Tasks & Polyglot Workers
  // ==========================================
  readonly tasks = {
    fetchAndLock: async (
      workerId: string,
      topics: string[],
      maxTasks = 10,
      lockDurationMs = 30000,
    ) => {
      const res = await this.request<{ items: LockedTask[] }>(
        '/api/v1/external-tasks/fetch-and-lock',
        {
          method: 'POST',
          body: { workerId, topics, maxTasks, lockDurationMs },
        },
      );
      return res.items;
    },

    complete: async (
      taskId: string,
      workerId: string,
      variables: Record<string, unknown> = {},
    ) => {
      return this.request(`/api/v1/external-tasks/${encodeURIComponent(taskId)}/complete`, {
        method: 'POST',
        body: { workerId, variables },
      });
    },

    fail: async (
      taskId: string,
      workerId: string,
      errorMessage: string,
      retriesRemaining?: number,
    ) => {
      return this.request(`/api/v1/external-tasks/${encodeURIComponent(taskId)}/failure`, {
        method: 'POST',
        body: { workerId, errorMessage, retriesRemaining },
      });
    },

    heartbeat: async (
      taskId: string,
      workerId: string,
      progress?: Record<string, unknown>,
      extendLockMs?: number,
    ) => {
      return this.request(`/api/v1/external-tasks/${encodeURIComponent(taskId)}/heartbeat`, {
        method: 'POST',
        body: { workerId, progress, extendLockMs },
      });
    },

    getProgress: async (taskId: string) => {
      return this.request<{
        taskId: string;
        progress: Record<string, unknown> | null;
        lastHeartbeatAt: string | null;
        lockExpiresAt: string | null;
      }>(`/api/v1/external-tasks/${encodeURIComponent(taskId)}/progress`);
    },
  };

  // ==========================================
  // Autonomous Resilient Worker Loop
  // ==========================================
  createWorker(options: WorkerOptions, handler: TaskHandler): ActiveWorker {
    const topics = Array.isArray(options.topic) ? options.topic : [options.topic];
    const workerId = options.workerId;
    const pollIntervalMs = options.pollIntervalMs ?? 500;
    const lockDurationMs = options.lockDurationMs ?? 30000;
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10000;
    let running = false;
    let pollTimer: NodeJS.Timeout | null = null;
    let activeWorkCount = 0;

    const tick = async () => {
      if (!running) return;
      try {
        const tasks = await this.tasks.fetchAndLock(
          workerId,
          topics,
          options.concurrency ?? 5,
          lockDurationMs,
        );

        if (tasks && tasks.length > 0) {
          await Promise.all(
            tasks.map(async (task) => {
              activeWorkCount += 1;
              let heartbeatTimer: NodeJS.Timeout | null = null;

              const boundTask: BoundTask = {
                ...task,
                heartbeat: async (progress, extendMs) => {
                  await this.tasks.heartbeat(task.id, workerId, progress, extendMs ?? lockDurationMs);
                },
              };

              // Automatic periodic heartbeating while handler runs
              heartbeatTimer = setInterval(() => {
                void boundTask.heartbeat().catch(() => undefined);
              }, heartbeatIntervalMs);

              try {
                const output = await handler(boundTask);
                await this.tasks.complete(task.id, workerId, (output as Record<string, unknown>) ?? {});
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                await this.tasks.fail(task.id, workerId, msg);
              } finally {
                if (heartbeatTimer) clearInterval(heartbeatTimer);
                activeWorkCount -= 1;
              }
            }),
          );
        }
      } catch {
        // network / backoff jitter
      } finally {
        if (running) {
          pollTimer = setTimeout(() => void tick(), pollIntervalMs);
        }
      }
    };

    return {
      start: () => {
        if (running) return;
        running = true;
        void tick();
      },
      stop: async () => {
        running = false;
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        // Wait for active tasks to gracefully drain
        const start = Date.now();
        while (activeWorkCount > 0 && Date.now() - start < 10000) {
          await new Promise((r) => setTimeout(r, 100));
        }
      },
      isRunning: () => running,
    };
  }

  // ==========================================
  // Webhooks Trigger Gateway
  // ==========================================
  readonly webhooks = {
    trigger: async (
      webhookPath: string,
      payload: Record<string, unknown>,
      options: { signature?: string; correlationId?: string } = {},
    ) => {
      const headers: Record<string, string> = {};
      if (options.signature) {
        headers['x-nexusflow-signature'] = options.signature;
      }
      if (options.correlationId) {
        headers['x-correlation-id'] = options.correlationId;
      }
      const cleanPath = webhookPath.replace(/^\/+/, '');
      return this.request<{ instanceId: string; status: string }>(
        `/webhooks/${encodeURIComponent(cleanPath)}`,
        {
          method: 'POST',
          headers,
          body: payload,
        },
      );
    },
  };

  // ==========================================
  // Industry Templates
  // ==========================================
  readonly templates = {
    listCatalog: async (category?: string) => {
      const qs = category ? `?category=${encodeURIComponent(category)}` : '';
      const res = await this.request<{ items: Array<{ key: string; name: string; category: string; description: string }> }>(
        `/api/v1/templates/catalog${qs}`,
      );
      return res.items;
    },
    instantiate: async (templateKey: string, tenantId?: string) => {
      const res = await this.request<{ message: string; workflow: { id: string; key: string; name: string; version: number } }>(
        `/api/v1/templates/${encodeURIComponent(templateKey)}/instantiate`,
        {
          method: 'POST',
          body: { tenantId },
        },
      );
      return res.workflow;
    },
  };
}
