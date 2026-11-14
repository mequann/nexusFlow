import type {
  CaseComment,
  CaseSummary,
  ConnectorDescriptor,
  CorrespondenceItem,
  ExternalTask,
  Incident,
  InstanceTrace,
  MaskedCredential,
  TenantImportValidationResult,
  UserInfo,
  UserTask,
  WorkflowInstance,
  WorkflowRecord,
  AuditLogRecord,
  SystemLogEntry,
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

  me: () =>
    request<{ principal: { userId: string; email: string; name?: string; role: UserInfo['role'] } }>(
      '/api/v1/auth/me',
    ),

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

  // Temporal Capabilities
  resetInstance: (
    id: string,
    payload: { targetNodeId: string; reason?: string; variablesOverride?: Record<string, unknown> },
  ) =>
    request<WorkflowInstance>(`/api/v1/instances/${id}/reset`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  continueAsNew: (
    id: string,
    payload: { carryoverVariables?: Record<string, unknown>; reason?: string },
  ) =>
    request<WorkflowInstance>(`/api/v1/instances/${id}/continue-as-new`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  queryInstance: (id: string, payload: { expression?: string; variableKey?: string }) =>
    request<{ instanceId: string; status: string; result: unknown; evaluatedAt: string }>(
      `/api/v1/instances/${id}/query`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  heartbeatExternalTask: (
    id: string,
    payload: { workerId: string; progress?: number; extendLockMs?: number },
  ) =>
    request<{ taskId: string; lastHeartbeatAt: string; progress: number }>(
      `/api/v1/external-tasks/${id}/heartbeat`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  getExternalTaskProgress: (id: string) =>
    request<{ taskId: string; progress: number; lastHeartbeatAt: string | null }>(
      `/api/v1/external-tasks/${id}/progress`,
    ),

  // Tenant Workflow Importer (Reverse Engineering Import Template)
  validateTenantImport: (data: unknown) =>
    request<TenantImportValidationResult>('/api/v1/workflows/import/json/validate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  processTenantImport: (data: unknown) =>
    request<{ importedCount: number; workflows: Array<{ id: string; key: string; name: string; version: number }> }>(
      '/api/v1/workflows/import/json/process',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    ),

  // Ethiopian Paperless Office Correspondence & Digital Registry
  listCorrespondence: () => request<{ items: CorrespondenceItem[] }>('/api/v1/correspondence'),

  createCorrespondence: (payload: {
    type: 'INBOUND' | 'OUTBOUND' | 'INTERNAL_MEMO';
    subject: string;
    senderOrg: string;
    recipientOrg: string;
    urgency?: string;
    classification?: string;
    bodyHtml?: string;
    customPrefix?: string;
  }) =>
    request<CorrespondenceItem>('/api/v1/correspondence', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  addMinute: (id: string, payload: { actionTaken: string; comment: string }) =>
    request<CorrespondenceItem>(`/api/v1/correspondence/${id}/minutes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  approveAndSeal: (id: string, payload: { signatoryRole: string; baseUrl?: string }) =>
    request<CorrespondenceItem>(`/api/v1/correspondence/${id}/seal`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Logging & Compliance Systems
  getAuditLogs: (filters?: { action?: string; resourceType?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.action) params.set('action', filters.action);
    if (filters?.resourceType) params.set('resourceType', filters.resourceType);
    if (filters?.limit) params.set('limit', String(filters.limit));
    const qs = params.toString();
    return request<{ items: AuditLogRecord[]; total: number }>(`/api/v1/logs/audit${qs ? `?${qs}` : ''}`);
  },

  getSystemLogs: (filters?: { minLevel?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.minLevel) params.set('minLevel', filters.minLevel);
    if (filters?.limit) params.set('limit', String(filters.limit));
    const qs = params.toString();
    return request<{ items: SystemLogEntry[]; total: number }>(`/api/v1/logs/system${qs ? `?${qs}` : ''}`);
  },

  getInstanceExecutionLogs: (instanceId: string) =>
    request<{ instanceId: string; steps: any[]; total: number }>(`/api/v1/logs/instances/${instanceId}`),

  // Tier-1 Enterprise: BPMN 2.0 Interoperability
  importBpmn: (xml: string, key?: string, name?: string) =>
    request<WorkflowRecord>('/api/v1/workflows/import-bpmn', {
      method: 'POST',
      body: JSON.stringify({ xml, key, name }),
    }),
  exportBpmnUrl: (workflowId: string) => `/api/v1/workflows/${workflowId}/export-bpmn`,

  // Tier-1 Enterprise: Document Vault & Storage
  listFiles: () => request<{ items: any[]; total: number }>('/api/v1/storage/files'),
  uploadFile: (filename: string, contentBase64: string, mimeType?: string, metadata?: Record<string, unknown>) =>
    request<{ file: any; downloadUrl: string }>('/api/v1/storage/upload', {
      method: 'POST',
      body: JSON.stringify({ filename, contentBase64, mimeType, metadata }),
    }),
  downloadFileUrl: (fileId: string) => `/api/v1/storage/files/${fileId}/download`,
  deleteFile: (fileId: string) =>
    request<{ success: boolean }>(`/api/v1/storage/files/${fileId}`, {
      method: 'DELETE',
    }),
};

