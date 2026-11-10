import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Cpu,
  KeyRound,
  LogOut,
  MessageSquare,
  Play,
  Plus,
  Plug,
  RefreshCw,
  Send,
  Shield,
  Workflow,
} from 'lucide-react';
import { api, getSavedToken, setSavedToken } from './api';
import { DynamicForm } from './components/DynamicForm';
import { WorkflowGraphView } from './components/WorkflowGraphView';
import type {
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

type Tab = 'overview' | 'workflows' | 'cases' | 'tasks' | 'operations' | 'connectors';

const SAMPLE_WORKFLOW_JSON = JSON.stringify(
  {
    sagaEnabled: true,
    nodes: [
      { id: 'start', name: 'Manual Intake', type: 'trigger.manual', stage: 'Intake', config: {} },
      {
        id: 'matrix',
        name: 'Dynamic Approval Matrix',
        type: 'kissflow.approval_matrix',
        stage: 'Approval',
        config: {
          rules: [
            {
              when: '$vars.amount >= 5000',
              title: 'Executive Review ($vars.amount)',
              candidateGroup: 'finance',
              requiredApprovals: 1,
              slaMinutes: 30,
            },
          ],
          defaultRule: { title: 'Standard Review', candidateGroup: 'ops', requiredApprovals: 1 },
        },
      },
      { id: 'end', name: 'Completed', type: 'bpmn.end', stage: 'Done', config: {} },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'matrix' },
      { id: 'e2', from: 'matrix', to: 'end' },
    ],
  },
  null,
  2,
);

function statusBadge(status: string) {
  if (status === 'COMPLETED' || status === 'PUBLISHED' || status === 'ON_TRACK') return 'badge-green';
  if (status === 'WAITING' || status === 'OPEN' || status === 'CLAIMED' || status === 'RUNNING')
    return 'badge-blue';
  if (status === 'DRAFT' || status === 'COMPENSATING' || status === 'COMPENSATED') return 'badge-amber';
  if (status === 'INCIDENT_OPEN' || status === 'FAILED' || status === 'BREACHED' || status === 'REJECTED')
    return 'badge-red';
  return '';
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => getSavedToken());
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loginEmail, setLoginEmail] = useState('admin@nexusflow.local');
  const [loginPassword, setLoginPassword] = useState('AdminChangeMe123!');

  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [selectedWf, setSelectedWf] = useState<WorkflowRecord | null>(null);
  const [intakeVars, setIntakeVars] = useState<Record<string, unknown>>({});

  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [selectedCase, setSelectedCase] = useState<CaseSummary | null>(null);
  const [selectedTrace, setSelectedTrace] = useState<InstanceTrace | null>(null);
  const [commentText, setCommentText] = useState('');
  const [jumpTarget, setJumpTarget] = useState('');
  const [varPatchJson, setVarPatchJson] = useState('{"priority": "HIGH"}');

  const [tasks, setTasks] = useState<UserTask[]>([]);
  const [taskForms, setTaskForms] = useState<Record<string, Record<string, unknown>>>({});
  const [delegateTarget, setDelegateTarget] = useState<Record<string, string>>({});

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [connectors, setConnectors] = useState<ConnectorDescriptor[]>([]);
  const [credentials, setCredentials] = useState<MaskedCredential[]>([]);
  const [externalTasks, setExternalTasks] = useState<ExternalTask[]>([]);
  const [extTopic, setExtTopic] = useState('external.sap_create_invoice');

  // Create workflow form
  const [newWfKey, setNewWfKey] = useState('custom-dynamic-flow');
  const [newWfName, setNewWfName] = useState('Custom Dynamic Flow');
  const [newWfDefJson, setNewWfDefJson] = useState(SAMPLE_WORKFLOW_JSON);

  // Register custom connector form
  const [connType, setConnType] = useState('connector.slack_alert');
  const [connTitle, setConnTitle] = useState('Slack Alert Connector');
  const [connUrl, setConnUrl] = useState('https://hooks.example.com/services/demo');

  // Credential Vault form
  const [credName, setCredName] = useState('erp_bearer_token');
  const [credToken, setCredToken] = useState('');

  // Message Correlation form
  const [msgName, setMsgName] = useState('goods.received');
  const [msgKey, setMsgKey] = useState('PO-2026-088');

  const notify = (msg: string) => {
    setError(null);
    setNotice(msg);
  };

  const refreshAll = useCallback(async () => {
    if (!token) return;
    try {
      const [meRes, wfRes, instRes, taskRes, incRes, connRes, credRes] = await Promise.all([
        api.me(),
        api.listWorkflows(),
        api.listInstances(),
        api.listTasks(),
        api.listIncidents(),
        api.listConnectors(),
        api.listCredentials(),
      ]);

      setUser({
        id: meRes.principal.userId,
        email: meRes.principal.email,
        name: meRes.principal.email.split('@')[0] ?? 'User',
        role: meRes.principal.role,
      });
      setWorkflows(wfRes.items);
      if (wfRes.items.length > 0) {
        setSelectedWf((prev) =>
          prev ? (wfRes.items.find((w) => w.id === prev.id) ?? wfRes.items[0]!) : wfRes.items[0]!,
        );
      }
      setInstances(instRes.items);
      setTasks(taskRes.items);
      setIncidents(incRes.items);
      setConnectors(connRes.items);
      setCredentials(credRes.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load data';
      setError(message);
      if (message.toLowerCase().includes('token') || message.toLowerCase().includes('unauthorized')) {
        setSavedToken(null);
        setToken(null);
      }
    }
  }, [token]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const loadCaseDetails = async (instanceId: string) => {
    try {
      const [caseRes, traceRes] = await Promise.all([
        api.getCase(instanceId),
        api.getTrace(instanceId),
      ]);
      setSelectedCase(caseRes);
      setSelectedTrace(traceRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load case');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.login(loginEmail, loginPassword);
      setToken(res.accessToken);
      setUser(res.user);
      notify('Signed in to NexusFlow Control Plane');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const handleLogout = () => {
    setSavedToken(null);
    setToken(null);
    setUser(null);
  };

  if (!token) {
    return (
      <div className="login-wrap">
        <form className="card login-card" onSubmit={handleLogin}>
          <div className="brand" style={{ padding: 0, marginBottom: 18 }}>
            <div className="brand-logo">NF</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>NexusFlow Studio</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Camunda BPMN + n8n + Kissflow Control Plane
              </div>
            </div>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Email</label>
              <input
                className="input"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Password</label>
              <input
                className="input"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>
            <button className="btn btn-primary" type="submit" style={{ justifyContent: 'center' }}>
              Sign In to Studio
            </button>
            <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
              Default dev admin: <code>admin@nexusflow.local</code> / <code>AdminChangeMe123!</code>
            </div>
          </div>
        </form>
      </div>
    );
  }

  const openTasksCount = tasks.filter((t) => t.status === 'OPEN' || t.status === 'CLAIMED').length;
  const openIncidentsCount = incidents.filter((i) => i.status === 'OPEN').length;
  const waitingInstancesCount = instances.filter(
    (i) => i.status === 'WAITING' || i.status === 'RUNNING',
  ).length;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">NF</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>NexusFlow</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Enterprise Orchestrator</div>
          </div>
        </div>

        <nav className="nav">
          <button
            className={`nav-btn ${tab === 'overview' ? 'active' : ''}`}
            onClick={() => setTab('overview')}
          >
            <Activity size={16} /> Overview
          </button>
          <button
            className={`nav-btn ${tab === 'workflows' ? 'active' : ''}`}
            onClick={() => setTab('workflows')}
          >
            <Workflow size={16} /> Workflow Studio ({workflows.length})
          </button>
          <button
            className={`nav-btn ${tab === 'cases' ? 'active' : ''}`}
            onClick={() => setTab('cases')}
          >
            <Briefcase size={16} /> Cases & Instances ({instances.length})
          </button>
          <button
            className={`nav-btn ${tab === 'tasks' ? 'active' : ''}`}
            onClick={() => setTab('tasks')}
          >
            <CheckCircle2 size={16} /> Approval Inbox ({openTasksCount})
          </button>
          <button
            className={`nav-btn ${tab === 'operations' ? 'active' : ''}`}
            onClick={() => setTab('operations')}
          >
            <AlertTriangle size={16} /> Incidents & Workers ({openIncidentsCount})
          </button>
          <button
            className={`nav-btn ${tab === 'connectors' ? 'active' : ''}`}
            onClick={() => setTab('connectors')}
          >
            <Plug size={16} /> Connectors & Vault ({connectors.length})
          </button>
        </nav>

        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          {user && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{user.email}</div>
              <span className="badge badge-blue" style={{ marginTop: 4 }}>
                <Shield size={10} style={{ marginRight: 4 }} /> {user.role}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => void refreshAll()} style={{ flex: 1 }}>
              <RefreshCw size={14} /> Sync
            </button>
            <button className="btn btn-danger" onClick={handleLogout}>
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1 style={{ margin: 0, fontSize: 22 }}>
              {tab === 'overview' && 'Executive Control Plane'}
              {tab === 'workflows' && 'Hybrid Workflow Studio'}
              {tab === 'cases' && 'Kissflow Business Cases & Trace'}
              {tab === 'tasks' && 'Human Approval & Task Inbox'}
              {tab === 'operations' && 'Camunda Incidents & Polyglot Workers'}
              {tab === 'connectors' && 'Dynamic Connectors & AES-256-GCM Vault'}
            </h1>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              NestJS · Drizzle ORM · PostgreSQL · Swagger OpenAPI at{' '}
              <a href="http://localhost:3000/docs" target="_blank" rel="noreferrer" style={{ color: '#67e8f9' }}>
                /docs
              </a>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => void refreshAll()}>
            <RefreshCw size={14} /> Refresh Live State
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-ok">{notice}</div>}

        {tab === 'overview' && (
          <>
            <div className="grid-kpis">
              <div className="card">
                <div className="kpi-label">Published Workflows</div>
                <div className="kpi-value">{workflows.filter((w) => w.status === 'PUBLISHED').length}</div>
              </div>
              <div className="card">
                <div className="kpi-label">Active / Waiting Cases</div>
                <div className="kpi-value">{waitingInstancesCount}</div>
              </div>
              <div className="card">
                <div className="kpi-label">Pending Approvals</div>
                <div className="kpi-value">{openTasksCount}</div>
              </div>
              <div className="card">
                <div className="kpi-label">Open Incidents</div>
                <div className="kpi-value" style={{ color: openIncidentsCount > 0 ? '#fca5a5' : '#6ee7b7' }}>
                  {openIncidentsCount}
                </div>
              </div>
              <div className="card">
                <div className="kpi-label">Registered Connectors</div>
                <div className="kpi-value">{connectors.length}</div>
              </div>
            </div>

            <div className="split">
              <div className="card">
                <h3 style={{ marginTop: 0 }}>Quick-Start a Business Case</h3>
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Select any published workflow to fill its dynamic Kissflow intake form and launch a live instance.
                </p>
                {workflows
                  .filter((w) => w.status === 'PUBLISHED')
                  .map((wf) => (
                    <div key={wf.id} className="list-item" onClick={() => { setSelectedWf(wf); setTab('workflows'); }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{wf.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        key: <code>{wf.key}</code> · v{wf.version} · {wf.definition.nodes.length} steps
                      </div>
                    </div>
                  ))}
              </div>

              <div className="card">
                <h3 style={{ marginTop: 0 }}>Recent Cases & Executions</h3>
                {instances.slice(0, 6).map((inst) => (
                  <div
                    key={inst.id}
                    className="list-item"
                    onClick={() => {
                      void loadCaseDetails(inst.id);
                      setTab('cases');
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>{inst.workflowKey}</strong>
                      <span className={`badge ${statusBadge(inst.status)}`}>{inst.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                      Stage: {inst.currentStage ?? 'N/A'} · SLA:{' '}
                      <span style={{ color: inst.slaStatus === 'BREACHED' ? '#fca5a5' : '#6ee7b7' }}>
                        {inst.slaStatus}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'workflows' && (
          <div className="split">
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <h3 style={{ marginTop: 0 }}>Workflow Definitions</h3>
                {workflows.map((wf) => (
                  <div
                    key={wf.id}
                    className={`list-item ${selectedWf?.id === wf.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedWf(wf);
                      setIntakeVars({});
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>{wf.name}</strong>
                      <span className={`badge ${statusBadge(wf.status)}`}>{wf.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                      <code>{wf.key}</code> v{wf.version}
                    </div>
                  </div>
                ))}
              </div>

              <div className="card">
                <h3 style={{ marginTop: 0 }}>
                  <Plus size={15} /> Create Dynamic Workflow
                </h3>
                <div style={{ display: 'grid', gap: 10 }}>
                  <input
                    className="input"
                    placeholder="Workflow key (e.g. vendor-onboarding)"
                    value={newWfKey}
                    onChange={(e) => setNewWfKey(e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="Workflow name"
                    value={newWfName}
                    onChange={(e) => setNewWfName(e.target.value)}
                  />
                  <textarea
                    className="textarea"
                    rows={10}
                    value={newWfDefJson}
                    onChange={(e) => setNewWfDefJson(e.target.value)}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      try {
                        const created = await api.createWorkflow({
                          key: newWfKey,
                          name: newWfName,
                          definition: JSON.parse(newWfDefJson),
                        });
                        await api.publishWorkflow(created.id);
                        notify(`Created & published '${created.key}' v${created.version}`);
                        await refreshAll();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Failed to create workflow');
                      }
                    }}
                  >
                    Save & Publish Workflow
                  </button>
                </div>
              </div>
            </div>

            {selectedWf && (
              <div style={{ display: 'grid', gap: 16 }}>
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <h3 style={{ margin: 0 }}>{selectedWf.name}</h3>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedWf.description}</div>
                    </div>
                    {selectedWf.status === 'DRAFT' && (
                      <button
                        className="btn btn-success"
                        onClick={async () => {
                          await api.publishWorkflow(selectedWf.id);
                          notify(`Published ${selectedWf.key}`);
                          await refreshAll();
                        }}
                      >
                        Publish Version
                      </button>
                    )}
                  </div>

                  <WorkflowGraphView
                    nodes={selectedWf.definition.nodes}
                    edges={selectedWf.definition.edges}
                  />
                </div>

                {selectedWf.status === 'PUBLISHED' && (
                  <div className="card">
                    <h3 style={{ marginTop: 0 }}>
                      <Play size={15} /> Launch New Instance ({selectedWf.key})
                    </h3>
                    <DynamicForm
                      fields={selectedWf.definition.intakeFormSchema?.fields}
                      values={intakeVars}
                      onChange={setIntakeVars}
                    />
                    <button
                      className="btn btn-primary"
                      style={{ marginTop: 12 }}
                      onClick={async () => {
                        try {
                          const inst = await api.startInstance(selectedWf.key, intakeVars, intakeVars);
                          notify(`Started instance ${inst.id}`);
                          await refreshAll();
                          await loadCaseDetails(inst.id);
                          setTab('cases');
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed to start instance');
                        }
                      }}
                    >
                      <Play size={14} /> Start Case / Instance
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'cases' && (
          <div className="split">
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Workflow Instances</h3>
              {instances.map((inst) => (
                <div
                  key={inst.id}
                  className={`list-item ${selectedCase?.instance.id === inst.id ? 'selected' : ''}`}
                  onClick={() => void loadCaseDetails(inst.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{inst.workflowKey}</strong>
                    <span className={`badge ${statusBadge(inst.status)}`}>{inst.status}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    {inst.id.slice(0, 8)}... · Stage: {inst.currentStage ?? 'N/A'}
                  </div>
                </div>
              ))}
            </div>

            {selectedCase && selectedTrace ? (
              <div style={{ display: 'grid', gap: 16 }}>
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ margin: 0 }}>
                        {selectedCase.instance.workflowKey} ({selectedCase.progressPercent}% complete)
                      </h3>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        Instance ID: <code>{selectedCase.instance.id}</code>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span className={`badge ${statusBadge(selectedCase.instance.status)}`}>
                        {selectedCase.instance.status}
                      </span>
                      <span className={`badge ${statusBadge(selectedCase.instance.slaStatus)}`}>
                        SLA: {selectedCase.instance.slaStatus}
                      </span>
                    </div>
                  </div>

                  {selectedCase.stages.length > 0 && (
                    <div className="stage-track">
                      {selectedCase.stages.map((st) => {
                        const idx = selectedCase.stages.indexOf(st);
                        const curIdx = selectedCase.currentStage
                          ? selectedCase.stages.indexOf(selectedCase.currentStage)
                          : -1;
                        const cls =
                          selectedCase.instance.status === 'COMPLETED' || idx < curIdx
                            ? 'done'
                            : idx === curIdx
                              ? 'current'
                              : '';
                        return (
                          <span key={st} className={`stage-pill ${cls}`}>
                            {st}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <h4 style={{ marginBottom: 8 }}>Step Execution Trace</h4>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {selectedTrace.steps.map((s) => (
                      <div
                        key={s.id}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: '1px solid var(--border)',
                          background: '#0d1426',
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 12,
                        }}
                      >
                        <div>
                          <strong>{s.nodeName}</strong> <span className="badge">{s.nodeType}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {s.durationMs !== null && <span style={{ color: 'var(--muted)' }}>{s.durationMs}ms</span>}
                          <span className={`badge ${statusBadge(s.status)}`}>{s.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedCase.instance.status !== 'COMPLETED' &&
                  selectedCase.instance.status !== 'CANCELLED' && (
                    <div className="card">
                      <h4 style={{ marginTop: 0 }}>Dynamic Runtime Modification</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <label style={{ fontSize: 12, color: 'var(--muted)' }}>Patch Variables JSON</label>
                          <textarea
                            className="textarea"
                            rows={3}
                            value={varPatchJson}
                            onChange={(e) => setVarPatchJson(e.target.value)}
                          />
                          <button
                            className="btn"
                            style={{ marginTop: 8 }}
                            onClick={async () => {
                              try {
                                await api.patchVariables(
                                  selectedCase.instance.id,
                                  JSON.parse(varPatchJson),
                                );
                                notify('Patched runtime variables');
                                await loadCaseDetails(selectedCase.instance.id);
                              } catch (err) {
                                setError(err instanceof Error ? err.message : 'Patch failed');
                              }
                            }}
                          >
                            Apply Variable Patch
                          </button>
                        </div>
                        <div>
                          <label style={{ fontSize: 12, color: 'var(--muted)' }}>
                            Jump Token to Node ID
                          </label>
                          <input
                            className="input"
                            placeholder="Target nodeId (e.g. end)"
                            value={jumpTarget}
                            onChange={(e) => setJumpTarget(e.target.value)}
                          />
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <button
                              className="btn btn-primary"
                              onClick={async () => {
                                const tok = selectedTrace.tokens[0];
                                if (!tok) return;
                                try {
                                  await api.moveToken(selectedCase.instance.id, tok.id, jumpTarget);
                                  notify(`Moved token to '${jumpTarget}'`);
                                  await loadCaseDetails(selectedCase.instance.id);
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : 'Move token failed');
                                }
                              }}
                            >
                              Move Token
                            </button>
                            <button
                              className="btn btn-danger"
                              onClick={async () => {
                                await api.cancelInstance(selectedCase.instance.id);
                                notify('Instance cancelled');
                                await loadCaseDetails(selectedCase.instance.id);
                              }}
                            >
                              Cancel Case
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                <div className="card">
                  <h4 style={{ marginTop: 0 }}>
                    <MessageSquare size={14} /> Case Collaboration ({selectedCase.comments.length})
                  </h4>
                  <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                    {selectedCase.comments.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          padding: 10,
                          borderRadius: 8,
                          background: '#0d1426',
                          border: '1px solid var(--border)',
                          fontSize: 13,
                        }}
                      >
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {c.authorEmail} · {new Date(c.createdAt).toLocaleString()}
                        </div>
                        <div style={{ marginTop: 4 }}>{c.body}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="input"
                      placeholder="Add collaboration note for approvers..."
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={async () => {
                        if (!commentText.trim()) return;
                        await api.addComment(selectedCase.instance.id, commentText);
                        setCommentText('');
                        await loadCaseDetails(selectedCase.instance.id);
                      }}
                    >
                      <Send size={14} /> Post
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card">Select an instance on the left to inspect its Kissflow case view and execution trace.</div>
            )}
          </div>
        )}

        {tab === 'tasks' && (
          <div style={{ display: 'grid', gap: 16 }}>
            {tasks.length === 0 && <div className="card">No user tasks found. Launch a workflow with an approval step to see tasks here.</div>}
            {tasks.map((t) => {
              const formState = taskForms[t.id] ?? {};
              const isActionable = t.status === 'OPEN' || t.status === 'CLAIMED';
              return (
                <div key={t.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ fontSize: 16 }}>{t.title}</strong>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        Stage: {t.stage ?? 'N/A'} · Group: {t.candidateGroup ?? 'any'} · Quorum:{' '}
                        {t.approvalsReceived.length}/{t.requiredApprovals}
                        {t.delegatedFrom && ` · Delegated from ${t.delegatedFrom}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {t.slaBreached && <span className="badge badge-red">SLA BREACHED</span>}
                      <span className={`badge ${statusBadge(t.status)}`}>{t.status}</span>
                    </div>
                  </div>

                  {isActionable && (
                    <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                      <DynamicForm
                        fields={t.formSchema?.fields}
                        values={formState}
                        onChange={(next) => setTaskForms({ ...taskForms, [t.id]: next })}
                      />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <button
                          className="btn"
                          onClick={async () => {
                            await api.claimTask(t.id);
                            notify(`Claimed task '${t.title}'`);
                            await refreshAll();
                          }}
                        >
                          Claim
                        </button>
                        <button
                          className="btn btn-success"
                          onClick={async () => {
                            try {
                              await api.completeTask(t.id, formState, false);
                              notify(`Submitted approval for '${t.title}'`);
                              await refreshAll();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Task completion failed');
                            }
                          }}
                        >
                          Approve & Complete
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={async () => {
                            await api.completeTask(t.id, formState, true);
                            notify(`Rejected '${t.title}'`);
                            await refreshAll();
                          }}
                        >
                          Reject
                        </button>
                        <input
                          className="input"
                          style={{ width: 200 }}
                          placeholder="Delegate to user/email"
                          value={delegateTarget[t.id] ?? ''}
                          onChange={(e) => setDelegateTarget({ ...delegateTarget, [t.id]: e.target.value })}
                        />
                        <button
                          className="btn"
                          onClick={async () => {
                            const target = delegateTarget[t.id];
                            if (!target) return;
                            await api.delegateTask(t.id, target, 'Delegated via Studio');
                            notify(`Delegated task to ${target}`);
                            await refreshAll();
                          }}
                        >
                          Delegate
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'operations' && (
          <div className="split">
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Operational Incidents</h3>
              {incidents.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>No incidents recorded.</div>
              )}
              {incidents.map((inc) => (
                <div key={inc.id} className="list-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{inc.incidentType}</strong>
                    <span className={`badge ${statusBadge(inc.status)}`}>{inc.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 4 }}>{inc.message}</div>
                  {inc.status === 'OPEN' && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      {(['RETRY', 'COMPENSATE', 'FAIL'] as const).map((action) => (
                        <button
                          key={action}
                          className="btn"
                          onClick={async () => {
                            await api.resolveIncident(inc.id, action, `Resolved via Studio (${action})`);
                            notify(`Resolved incident via ${action}`);
                            await refreshAll();
                          }}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              <h3 style={{ marginTop: 24 }}>Correlate Business Message</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                <input
                  className="input"
                  value={msgName}
                  onChange={(e) => setMsgName(e.target.value)}
                  placeholder="Message name (e.g. goods.received)"
                />
                <input
                  className="input"
                  value={msgKey}
                  onChange={(e) => setMsgKey(e.target.value)}
                  placeholder="Correlation key (e.g. PO-2026-088)"
                />
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    const res = await api.correlateMessage(msgName, msgKey, { correlatedVia: 'studio' });
                    notify(`Matched ${res.matchedSubscriptions} subscription(s)`);
                    await refreshAll();
                  }}
                >
                  Correlate Message
                </button>
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>
                <Cpu size={15} /> Polyglot External Service Task Worker Simulator
              </h3>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  className="input"
                  value={extTopic}
                  onChange={(e) => setExtTopic(e.target.value)}
                  placeholder="Topic (e.g. external.sap_create_invoice)"
                />
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    const res = await api.fetchAndLockExternalTasks('studio-worker', [extTopic]);
                    setExternalTasks(res.items);
                    notify(`Locked ${res.items.length} external task(s)`);
                  }}
                >
                  Fetch & Lock
                </button>
              </div>
              {externalTasks.map((et) => (
                <div key={et.id} className="list-item">
                  <div>
                    <strong>{et.topic}</strong> <span className="badge badge-blue">{et.status}</span>
                  </div>
                  <pre style={{ fontSize: 11, color: 'var(--muted)', overflowX: 'auto' }}>
                    {JSON.stringify(et.variables, null, 2)}
                  </pre>
                  <button
                    className="btn btn-success"
                    onClick={async () => {
                      await api.completeExternalTask(et.id, 'studio-worker', { completedBy: 'studio-worker' });
                      notify(`Completed external task ${et.id}`);
                      setExternalTasks((prev) => prev.filter((x) => x.id !== et.id));
                      await refreshAll();
                    }}
                  >
                    Complete External Task
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'connectors' && (
          <div className="split">
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Register Custom HTTP Connector</h3>
              <div style={{ display: 'grid', gap: 10, marginBottom: 24 }}>
                <input
                  className="input"
                  value={connType}
                  onChange={(e) => setConnType(e.target.value)}
                  placeholder="connector.my_service"
                />
                <input
                  className="input"
                  value={connTitle}
                  onChange={(e) => setConnTitle(e.target.value)}
                  placeholder="Display title"
                />
                <input
                  className="input"
                  value={connUrl}
                  onChange={(e) => setConnUrl(e.target.value)}
                  placeholder="https://api.example.com/hook"
                />
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      await api.registerConnector({
                        type: connType,
                        title: connTitle,
                        description: 'Runtime custom HTTP connector',
                        endpointUrl: connUrl,
                      });
                      notify(`Registered dynamic connector '${connType}'`);
                      await refreshAll();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Registration failed');
                    }
                  }}
                >
                  Register Connector
                </button>
              </div>

              <h3 style={{ marginTop: 0 }}>
                <KeyRound size={15} /> AES-256-GCM Credential Vault
              </h3>
              <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                <input
                  className="input"
                  value={credName}
                  onChange={(e) => setCredName(e.target.value)}
                  placeholder="Credential name"
                />
                <input
                  className="input"
                  type="password"
                  value={credToken}
                  onChange={(e) => setCredToken(e.target.value)}
                  placeholder="Bearer secret token"
                />
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    await api.createCredential({
                      name: credName,
                      type: 'bearer',
                      secretData: { token: credToken },
                    });
                    setCredToken('');
                    notify(`Encrypted & stored credential '${credName}'`);
                    await refreshAll();
                  }}
                >
                  Encrypt & Store Secret
                </button>
              </div>
              {credentials.map((c) => (
                <div key={c.id} className="list-item">
                  <strong>{c.name}</strong> <span className="badge">{c.type}</span>{' '}
                  <span className="badge badge-green">key:{c.keyId}</span>
                </div>
              ))}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Available Dynamic Connectors & Step Catalog</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                {connectors.map((c) => (
                  <div
                    key={c.type}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: '#0e1528',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span className="badge badge-blue">{c.category}</span>
                      <span className="badge">{c.builtin ? 'built-in' : 'custom'}</span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{c.title}</div>
                    <div style={{ fontSize: 11, color: '#67e8f9', marginTop: 2 }}>
                      <code>{c.type}</code>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{c.description}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

