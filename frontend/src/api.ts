import type {
  CaseComment,
  CaseSummary,
  ConnectorDescriptor,
  ExternalTask,
  Incident,
  InstanceTrace,
  MaskedCredential,
  UserInfo,
  UserTask,
  WorkflowInstance,
  WorkflowRecord,
} from './types';

const TOKEN_KEY = 'nexusflow_jwt';

export function getSavedToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setSavedToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getSavedToken();
  const headers = new Headers(init.headers);
  if (!headers.has('content-type') && init.body) {
    headers.set('content-type', 'application/json');
  }
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, { ...init, headers });
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } }).error?.message ??
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  health: () => request<{ status: string; timestamp: string }>('/healthz'),
  ready: () => request<{ status: string; timestamp: string }>('/readyz'),

  login: async (email: string, password: string) => {
    const res = await request<{ accessToken: string; user: UserInfo }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setSavedToken(res.accessToken);
    return res;
  },

  me: () => request<{ principal: { userId: string; email: string; role: UserInfo['role'] } }>('/api/v1/auth/me'),

  listWorkflows: () => request<{ items: WorkflowRecord[] }>('/api/v1/workflows'),
  createWorkflow: (payload: {
    key: string;
    name: string;
    description?: string;
    definition: WorkflowRecord['definition'];
    webhookSecret?: string;
  }) =>
    request<WorkflowRecord>('/api/v1/workflows', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateWorkflow: (
    id: string,
    payload: {
      name?: string;
      description?: string;
      definition?: WorkflowRecord['definition'];
      webhookSecret?: string;
    },
  ) =>
    request<WorkflowRecord>(`/api/v1/workflows/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  publishWorkflow: (id: string) =>
    request<WorkflowRecord>(`/api/v1/workflows/${id}/publish`, { method: 'POST' }),

  triggerWebhook: (path: string, body: Record<string, unknown>, secret?: string) =>
    request<{ accepted: boolean; instanceId: string; workflowKey: string; workflowVersion: number }>(
      `/webhooks/${path.split('/').map(encodeURIComponent).join('%2F')}`,
      {
        method: 'POST',
        headers: secret ? { 'x-webhook-secret': secret } : undefined,
        body: JSON.stringify(body),
      },
    ),

  registerUser: (payload: {
    email: string;
    name: string;
    password: string;
    role: UserInfo['role'];
  }) =>
    request<UserInfo>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createApiKey: (payload: { name: string; role: UserInfo['role']; expiresInDays?: number }) =>
    request<{ id: string; rawKey: string; keyPrefix: string; role: UserInfo['role'] }>(
      '/api/v1/auth/api-keys',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  startInstance: (key: string, variables: Record<string, unknown>, payload: Record<string, unknown> = {}) =>
    request<WorkflowInstance>(`/api/v1/workflows/${encodeURIComponent(key)}/instances`, {
      method: 'POST',
      body: JSON.stringify({ variables, payload }),
    }),

  listInstances: () => request<{ items: WorkflowInstance[] }>('/api/v1/instances?limit=50'),
  getTrace: (id: string) => request<InstanceTrace>(`/api/v1/instances/${id}/trace`),
  cancelInstance: (id: string) =>
    request<WorkflowInstance>(`/api/v1/instances/${id}/cancel`, { method: 'POST' }),
  patchVariables: (id: string, variables: Record<string, unknown>) =>
    request<WorkflowInstance>(`/api/v1/instances/${id}/variables`, {
      method: 'PATCH',
      body: JSON.stringify({ variables }),
    }),
  moveToken: (id: string, tokenId: string, targetNodeId: string, reason?: string) =>
    request(`/api/v1/instances/${id}/tokens/move`, {
      method: 'POST',
      body: JSON.stringify({ tokenId, targetNodeId, reason }),
    }),

  getCase: (id: string) => request<CaseSummary>(`/api/v1/cases/${id}`),
  addComment: (id: string, body: string) =>
    request<CaseComment>(`/api/v1/cases/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  listTasks: () => request<{ items: UserTask[] }>('/api/v1/tasks'),
  claimTask: (id: string) => request<UserTask>(`/api/v1/tasks/${id}/claim`, { method: 'POST' }),
  delegateTask: (id: string, toAssignee: string, reason?: string) =>
    request<UserTask>(`/api/v1/tasks/${id}/delegate`, {
      method: 'POST',
      body: JSON.stringify({ toAssignee, reason }),
    }),
  completeTask: (id: string, resolution: Record<string, unknown>, rejected = false) =>
    request<UserTask>(`/api/v1/tasks/${id}/${rejected ? 'reject' : 'complete'}`, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    }),

  listIncidents: () => request<{ items: Incident[] }>('/api/v1/incidents'),
  resolveIncident: (id: string, action: 'RETRY' | 'COMPENSATE' | 'FAIL', note?: string) =>
    request<Incident>(`/api/v1/incidents/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action, note }),
    }),

  correlateMessage: (messageName: string, correlationKey: string, payload: Record<string, unknown>) =>
    request<{ matchedSubscriptions: number; resumedInstanceIds: string[] }>(
      '/api/v1/messages/correlate',
      {
        method: 'POST',
        body: JSON.stringify({ messageName, correlationKey, payload }),
      },
    ),

  listConnectors: () => request<{ items: ConnectorDescriptor[] }>('/api/v1/connectors'),
  registerConnector: (payload: {
    type: string;
    title: string;
    description: string;
    endpointUrl: string;
    method?: string;
    credentialName?: string;
  }) =>
    request<ConnectorDescriptor>('/api/v1/connectors/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listCredentials: () => request<{ items: MaskedCredential[] }>('/api/v1/credentials'),
  createCredential: (payload: {
    name: string;
    type: 'bearer' | 'api_key' | 'basic' | 'custom';
    secretData: Record<string, unknown>;
  }) =>
    request<MaskedCredential>('/api/v1/credentials', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteCredential: (id: string) =>
    request<void>(`/api/v1/credentials/${id}`, { method: 'DELETE' }),

  fetchAndLockExternalTasks: (workerId: string, topics: string[]) =>
    request<{ items: ExternalTask[] }>('/api/v1/external-tasks/fetch-and-lock', {
      method: 'POST',
      body: JSON.stringify({ workerId, topics, maxTasks: 10, lockDurationMs: 30000 }),
    }),
  completeExternalTask: (id: string, workerId: string, variables: Record<string, unknown>) =>
    request<ExternalTask>(`/api/v1/external-tasks/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ workerId, variables }),
    }),
  failExternalTask: (
    id: string,
    workerId: string,
    errorMessage: string,
    retriesRemaining?: number,
  ) =>
    request<ExternalTask>(`/api/v1/external-tasks/${id}/failure`, {
      method: 'POST',
      body: JSON.stringify({ workerId, errorMessage, retriesRemaining }),
    }),
};

