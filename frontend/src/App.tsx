import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Cpu,
  Download,
  FileText,
  HardDrive,
  KeyRound,
  LogOut,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Plug,
  RefreshCw,
  RotateCcw,
  Send,
  Shield,
  Sparkles,
  Stamp,
  Trash2,
  UploadCloud,
  UserPlus,
  Users,
  Webhook,
  Workflow,
} from 'lucide-react';
import { api, getSavedToken, setSavedToken } from './api';
import { DynamicForm } from './components/DynamicForm';
import { WorkflowDesigner } from './components/WorkflowDesigner';
import { WorkflowGraphView } from './components/WorkflowGraphView';
import { RoleHeader } from './components/RoleHeader';
import { NormalUserPortal } from './components/NormalUserPortal';
import { HRManagerPortal } from './components/HRManagerPortal';
import { TenantImporterView } from './components/TenantImporterView';
import { TemporalControlPanel } from './components/TemporalControlPanel';
import { CorrespondenceRegistryView } from './components/CorrespondenceRegistryView';
import { LogsView } from './components/LogsView';
import { DocumentVaultView } from './components/DocumentVaultView';
import type {
  AppPerspective,
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

type Tab =
  | 'overview'
  | 'user-portal'
  | 'hr-desk'
  | 'importer'
  | 'temporal'
  | 'correspondence'
  | 'logs'
  | 'workflows'
  | 'designer'
  | 'cases'
  | 'tasks'
  | 'operations'
  | 'connectors'
  | 'storage';

function statusBadge(status: string) {
  if (status === 'COMPLETED' || status === 'PUBLISHED' || status === 'ON_TRACK' || status === 'ready')
    return 'badge-green';
  if (status === 'WAITING' || status === 'OPEN' || status === 'CLAIMED' || status === 'RUNNING')
    return 'badge-blue';
  if (status === 'DRAFT' || status === 'COMPENSATING' || status === 'COMPENSATED') return 'badge-amber';
  if (
    status === 'INCIDENT_OPEN' ||
    status === 'FAILED' ||
    status === 'BREACHED' ||
    status === 'REJECTED' ||
    status === 'unavailable'
  )
    return 'badge-red';
  return '';
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => getSavedToken());
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loginEmail, setLoginEmail] = useState('admin@nexusflow.local');
  const [loginPassword, setLoginPassword] = useState('AdminChangeMe123!');

  const [perspective, setPerspective] = useState<AppPerspective>('USER');
  const [lang, setLang] = useState<'en' | 'am'>('en');
  const [tab, setTab] = useState<Tab>('user-portal');

  const handlePerspectiveChange = (newPerspective: AppPerspective) => {
    setPerspective(newPerspective);
    if (newPerspective === 'USER') {
      setTab('user-portal');
    } else if (newPerspective === 'HR') {
      setTab('hr-desk');
    } else {
      setTab('overview');
    }
  };
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dbReady, setDbReady] = useState<string>('checking');
  const [autoPoll, setAutoPoll] = useState<boolean>(true);

  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [selectedWf, setSelectedWf] = useState<WorkflowRecord | null>(null);
  const [viewNodeId, setViewNodeId] = useState<string | null>(null);
  const [viewNodeName, setViewNodeName] = useState('');
  const [viewNodeStage, setViewNodeStage] = useState('');
  const [viewNodeConfigText, setViewNodeConfigText] = useState('{}');
  const [designerTarget, setDesignerTarget] = useState<WorkflowRecord | null>(null);
  const [designerKeyCounter, setDesignerKeyCounter] = useState(0);
  const [intakeVars, setIntakeVars] = useState<Record<string, unknown>>({});
  const [webhookSecretInput, setWebhookSecretInput] = useState('procurement-webhook-secret');

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

  // Admin User & API Key creation
  const [regEmail, setRegEmail] = useState('');
  const [regName, setRegName] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regRole, setRegRole] = useState<UserInfo['role']>('OPERATOR');
  const [apiKeyName, setApiKeyName] = useState('');
  const [apiKeyRole, setApiKeyRole] = useState<UserInfo['role']>('OPERATOR');
  const [issuedApiKey, setIssuedApiKey] = useState<string | null>(null);

  const notify = (msg: string) => {
    setError(null);
    setNotice(msg);
  };

  const loadCaseDetails = useCallback(async (instanceId: string) => {
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
  }, []);

  const refreshAll = useCallback(async () => {
    if (!token) return;
    try {
      const [readyRes, meRes, wfRes, instRes, taskRes, incRes, connRes, credRes] = await Promise.all([
        api.ready().catch(() => ({ status: 'unavailable' })),
        api.me(),
        api.listWorkflows().catch(() => ({ items: [] })),
        api.listInstances().catch(() => ({ items: [] })),
        api.listTasks().catch(() => ({ items: [] })),
        api.listIncidents().catch(() => ({ items: [] })),
        api.listConnectors().catch(() => ({ items: [] })),
        api.listCredentials().catch(() => ({ items: [] })),
      ]);

      setDbReady(readyRes.status);
      setUser((prev) => {
        const u: UserInfo = {
          id: meRes.principal.userId,
          email: meRes.principal.email,
          name: meRes.principal.name ?? prev?.name ?? meRes.principal.email.split('@')[0] ?? 'User',
          role: meRes.principal.role,
          department: prev?.department,
        };
        return u;
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

  // Live auto-refresh every 2.5s when enabled so parallel worker progress updates automatically
  useEffect(() => {
    if (!token || !autoPoll) return;
    const timer = setInterval(() => {
      void refreshAll();
      if (selectedCase) {
        void loadCaseDetails(selectedCase.instance.id);
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [token, autoPoll, refreshAll, selectedCase, loadCaseDetails]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.login(loginEmail, loginPassword);
      setToken(res.accessToken);
      setUser(res.user);
      if (res.user.role === 'ADMIN') {
        setPerspective('ADMIN');
        setTab('overview');
      } else if (res.user.role === 'HR') {
        setPerspective('HR');
        setTab('hr-desk');
      } else if (res.user.role === 'OPERATOR') {
        setPerspective('ADMIN');
        setTab('operations');
      } else if (res.user.role === 'BUILDER') {
        setPerspective('ADMIN');
        setTab('workflows');
      } else {
        setPerspective('USER');
        setTab('user-portal');
      }
      notify(`Signed in as ${res.user.name} (${res.user.role})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const quickLoginAs = async (email: string, pass: string = 'AdminChangeMe123!') => {
    setLoginEmail(email);
    setLoginPassword(pass);
    setError(null);
    try {
      const res = await api.login(email, pass);
      setToken(res.accessToken);
      setUser(res.user);
      if (res.user.role === 'ADMIN') {
        setPerspective('ADMIN');
        setTab('overview');
      } else if (res.user.role === 'HR') {
        setPerspective('HR');
        setTab('hr-desk');
      } else if (res.user.role === 'OPERATOR') {
        setPerspective('ADMIN');
        setTab('operations');
      } else if (res.user.role === 'BUILDER') {
        setPerspective('ADMIN');
        setTab('workflows');
      } else {
        setPerspective('USER');
        setTab('user-portal');
      }
      notify(`Signed in as ${res.user.name} (${res.user.role})`);
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
              Default password for seeded accounts: <code>AdminChangeMe123!</code>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                ⚡ Test Differing Roles (One-Click Login):
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => void quickLoginAs('admin@nexusflow.local')}
                  title="Platform Admin: Superuser with access to Temporal Controls, Importer, Credentials Vault & Full Studio"
                >
                  🛡️ Admin
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => void quickLoginAs('hr@nexusflow.local')}
                  title="HR Manager: Consensus Approvals, Transfers, People Operations & Directory"
                >
                  👥 HR Manager
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => void quickLoginAs('operator@nexusflow.local')}
                  title="Operations Lead: Incident Resolution, Worker Monitoring, Instance Lifecycle & Rewinds"
                >
                  ⚡ Operator
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => void quickLoginAs('builder@nexusflow.local')}
                  title="Workflow Builder: Visual Workflow Designer, Credentials Vault, DAG Publish"
                >
                  🏗️ Builder
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => void quickLoginAs('user@nexusflow.local')}
                  title="Normal Employee: My Workspace, Requisitions (Model 20, Per-Diem, Transfer), Tracking"
                >
                  📋 Employee (User)
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => void quickLoginAs('viewer@nexusflow.local')}
                  title="Compliance Auditor: Read-only observation of workflows, cases, and audit logs"
                >
                  👁️ Viewer (Auditor)
                </button>
              </div>
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

  const selectedCaseWorkflow = selectedCase
    ? workflows.find((w) => w.id === selectedCase.instance.workflowId)
    : undefined;

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
          {perspective === 'USER' && (
            <>
              <button
                className={`nav-btn ${tab === 'user-portal' ? 'active' : ''}`}
                onClick={() => setTab('user-portal')}
              >
                <CheckCircle2 size={16} /> {lang === 'am' ? 'የእኔ ዴስክ (My Workspace)' : 'My Desk & Requisitions'}
                {openTasksCount > 0 && <span className="counter-pill" style={{ marginLeft: 'auto' }}>{openTasksCount}</span>}
              </button>
              <button
                className={`nav-btn ${tab === 'correspondence' ? 'active' : ''}`}
                onClick={() => setTab('correspondence')}
              >
                <Stamp size={16} /> {lang === 'am' ? 'ደብዳቤዎችና ማህተሞች' : 'Official Registry & Seals'}
              </button>
              <button
                className={`nav-btn ${tab === 'cases' ? 'active' : ''}`}
                onClick={() => setTab('cases')}
              >
                <Briefcase size={16} /> {lang === 'am' ? 'የጥያቄዎቼ ሁኔታ (Track Cases)' : 'Track My Cases'} ({instances.length})
              </button>
            </>
          )}

          {perspective === 'HR' && (
            <>
              <button
                className={`nav-btn ${tab === 'hr-desk' ? 'active' : ''}`}
                onClick={() => setTab('hr-desk')}
              >
                <Users size={16} /> {lang === 'am' ? 'የHR ሥራ አመራር (People Ops)' : 'HR People Operations & Quorum'}
                {openTasksCount > 0 && <span className="counter-pill" style={{ marginLeft: 'auto' }}>{openTasksCount}</span>}
              </button>
              <button
                className={`nav-btn ${tab === 'tasks' ? 'active' : ''}`}
                onClick={() => setTab('tasks')}
              >
                <CheckCircle2 size={16} /> {lang === 'am' ? 'የተግባራት ዝርዝር (Inbox)' : 'Approval Inbox'} ({openTasksCount})
              </button>
              <button
                className={`nav-btn ${tab === 'cases' ? 'active' : ''}`}
                onClick={() => setTab('cases')}
              >
                <Briefcase size={16} /> Cases & Trace ({instances.length})
              </button>
              <button
                className={`nav-btn ${tab === 'correspondence' ? 'active' : ''}`}
                onClick={() => setTab('correspondence')}
              >
                <Stamp size={16} /> Official Registry & Seals
              </button>
              <button
                className={`nav-btn ${tab === 'logs' ? 'active' : ''}`}
                onClick={() => setTab('logs')}
              >
                <FileText size={16} /> Logs & Compliance Audit
              </button>
              <button
                className={`nav-btn ${tab === 'workflows' ? 'active' : ''}`}
                onClick={() => setTab('workflows')}
              >
                <Workflow size={16} /> Workflows ({workflows.length})
              </button>
              <button
                className={`nav-btn ${tab === 'storage' ? 'active' : ''}`}
                onClick={() => setTab('storage')}
              >
                <HardDrive size={16} /> Document Vault & Storage
              </button>
            </>
          )}

          {perspective === 'ADMIN' && (
            <>
              <button
                className={`nav-btn ${tab === 'overview' ? 'active' : ''}`}
                onClick={() => setTab('overview')}
              >
                <Activity size={16} /> Overview
              </button>
              <button
                className={`nav-btn ${tab === 'importer' ? 'active' : ''}`}
                onClick={() => setTab('importer')}
              >
                <Sparkles size={16} /> Tenant Importer (JSON)
              </button>
              <button
                className={`nav-btn ${tab === 'temporal' ? 'active' : ''}`}
                onClick={() => setTab('temporal')}
              >
                <RotateCcw size={16} /> Temporal Time-Travel & Ops
              </button>
              <button
                className={`nav-btn ${tab === 'correspondence' ? 'active' : ''}`}
                onClick={() => setTab('correspondence')}
              >
                <Stamp size={16} /> Official Registry & Seals
              </button>
              <button
                className={`nav-btn ${tab === 'logs' ? 'active' : ''}`}
                onClick={() => setTab('logs')}
              >
                <FileText size={16} /> Logs & Compliance Audit
              </button>
              <button
                className={`nav-btn ${tab === 'workflows' ? 'active' : ''}`}
                onClick={() => setTab('workflows')}
              >
                <Workflow size={16} /> Workflows ({workflows.length})
              </button>
              <button
                className={`nav-btn ${tab === 'storage' ? 'active' : ''}`}
                onClick={() => setTab('storage')}
              >
                <HardDrive size={16} /> Document Vault & Storage
              </button>
              <button
                className={`nav-btn ${tab === 'designer' ? 'active' : ''}`}
                onClick={() => {
                  setDesignerTarget(null);
                  setDesignerKeyCounter((c) => c + 1);
                  setTab('designer');
                }}
              >
                <Plus size={16} /> Drag & Drop Designer
              </button>
              <button
                className={`nav-btn ${tab === 'cases' ? 'active' : ''}`}
                onClick={() => setTab('cases')}
              >
                <Briefcase size={16} /> Cases & Trace ({instances.length})
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
                <Plug size={16} /> Connectors & Vault
              </button>
            </>
          )}
        </nav>

        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ marginBottom: 10 }}>
            <span className={`badge ${statusBadge(dbReady)}`}>DB: {dbReady}</span>
          </div>
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

      <main className="main" style={{ padding: 0 }}>
        <RoleHeader
          user={user}
          perspective={perspective}
          setPerspective={handlePerspectiveChange}
          lang={lang}
          setLang={setLang}
          onLogout={handleLogout}
          onRefresh={() => void refreshAll()}
          autoPoll={autoPoll}
          setAutoPoll={setAutoPoll}
          dbReady={dbReady}
        />

        <div style={{ padding: '20px 24px' }}>
          <div className="topbar">
            <div>
              <h1 style={{ margin: 0, fontSize: 22 }}>
                {tab === 'user-portal' && (lang === 'am' ? 'የሠራተኛ የራስ-አገልግሎት ዴስክ (Self-Service)' : 'Employee Self-Service Desk & Service Catalog')}
                {tab === 'hr-desk' && (lang === 'am' ? 'የሰው ኃይል ሥራ አመራርና ማጽደቂያ (People Operations)' : 'HR People Operations & Consensus Review')}
                {tab === 'importer' && (lang === 'am' ? 'የድርጅት የሥራ ፍሰት መጫኛ (Tenant Workflow Importer)' : 'Enterprise Tenant Workflow Importer')}
                {tab === 'temporal' && (lang === 'am' ? 'የቴምፖራል ኦፕሬሽንና የጊዜ ጉዞ (Temporal Ops)' : 'Temporal Point-in-Time Reset & Control Panel')}
                {tab === 'correspondence' && (lang === 'am' ? 'የደብዳቤዎችና ሰነዶች መዝገብ (Registry & Seals)' : 'Inbound / Outbound Correspondence & Digital Seals')}
                {tab === 'logs' && (lang === 'am' ? 'የሎግና የቁጥጥር ኦዲት መዝገብ (Logging & Compliance)' : 'Enterprise Logging & Compliance Audit Trail')}
                {tab === 'overview' && 'Executive Control Plane'}
                {tab === 'workflows' && 'Published Workflows & Runner'}
                {tab === 'designer' && 'Drag & Drop Workflow Designer (Sequential & Parallel)'}
                {tab === 'cases' && 'Kissflow Business Cases & Live Execution Trace'}
                {tab === 'tasks' && 'Human Approval & Task Inbox'}
                {tab === 'operations' && 'Camunda Incidents & Polyglot Workers'}
                {tab === 'connectors' && 'Dynamic Connectors, Vault & RBAC Access'}
                {tab === 'storage' && 'Enterprise Document Vault & Attachment Storage'}
              </h1>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                NexusFlow Orchestration Engine · Multi-Tenant · Bilingual (Amharic/English) · Ethiopian Ge'ez Calendar
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn btn-primary" onClick={() => void refreshAll()}>
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {notice && <div className="alert alert-ok">{notice}</div>}

        {tab === 'overview' && (
          <>
            <div className="grid-kpis">
              <div className="card">
                <div className="kpi-label">Published Workflows</div>
                <div className="kpi-value">
                  {workflows.filter((w) => w.status === 'PUBLISHED').length}
                </div>
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
                <div
                  className="kpi-value"
                  style={{ color: openIncidentsCount > 0 ? '#fca5a5' : '#6ee7b7' }}
                >
                  {openIncidentsCount}
                </div>
              </div>
              <div className="card">
                <div className="kpi-label">Dynamic Connectors</div>
                <div className="kpi-value">{connectors.length}</div>
              </div>
            </div>

            <div className="split">
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ marginTop: 0 }}>Published Workflows</h3>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setDesignerTarget(null);
                      setDesignerKeyCounter((c) => c + 1);
                      setTab('designer');
                    }}
                  >
                    <Plus size={14} /> New Flow
                  </button>
                </div>
                {workflows
                  .filter((w) => w.status === 'PUBLISHED')
                  .map((wf) => (
                    <div
                      key={wf.id}
                      className="list-item"
                      onClick={() => {
                        setSelectedWf(wf);
                        setTab('workflows');
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{wf.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        <code>{wf.key}</code> · v{wf.version} · {wf.definition.nodes.length} steps
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
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>All Versions</h3>
                <div style={{ display: 'flex', gap: 6 }}>
                  <label className="btn" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, margin: 0 }} title="Import standard BPMN 2.0 XML">
                    <UploadCloud size={13} /> Import BPMN 2.0
                    <input
                      type="file"
                      accept=".bpmn,.xml"
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const text = await file.text();
                          const created = await api.importBpmn(text);
                          setNotice(`Imported BPMN 2.0 process: ${created.name} (${created.key})`);
                          await refreshAll();
                          setSelectedWf(created);
                        } catch (err: any) {
                          setError(err.message || 'BPMN import failed');
                        }
                      }}
                    />
                  </label>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setDesignerTarget(null);
                      setDesignerKeyCounter((c) => c + 1);
                      setTab('designer');
                    }}
                  >
                    <Plus size={14} /> Designer
                  </button>
                </div>
              </div>
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

            {selectedWf && (
              <div style={{ display: 'grid', gap: 16 }}>
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <h3 style={{ margin: 0 }}>{selectedWf.name}</h3>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedWf.description}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn"
                        onClick={() => {
                          setDesignerTarget(selectedWf);
                          setDesignerKeyCounter((c) => c + 1);
                          setTab('designer');
                        }}
                      >
                        <Pencil size={13} />{' '}
                        {selectedWf.status === 'DRAFT' ? 'Edit in Designer' : 'Clone as New Version'}
                      </button>
                      <a
                        className="btn"
                        href={api.exportBpmnUrl(selectedWf.id)}
                        download={`${selectedWf.key}.bpmn`}
                        target="_blank"
                        rel="noreferrer"
                        title="Export standard BPMN 2.0 XML (Camunda / Signavio compatible)"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      >
                        <Download size={13} /> Export BPMN 2.0
                      </a>
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
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: viewNodeId ? '1fr 310px' : '1fr', gap: 14 }}>
                    <WorkflowGraphView
                      nodes={selectedWf.definition.nodes}
                      edges={selectedWf.definition.edges}
                      selectedNodeId={viewNodeId}
                      onSelectNode={(nid) => {
                        const found = selectedWf.definition.nodes.find((n) => n.id === nid);
                        setViewNodeId(nid);
                        setViewNodeName(found?.name ?? '');
                        setViewNodeStage(found?.stage ?? '');
                        setViewNodeConfigText(JSON.stringify(found?.config ?? {}, null, 2));
                      }}
                    />

                    {viewNodeId && (
                      <div className="card" style={{ background: '#0e1528' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <strong style={{ fontSize: 13 }}>Step Editor ({viewNodeId})</strong>
                          <button className="port-btn" onClick={() => setViewNodeId(null)}>
                            ×
                          </button>
                        </div>
                        <div style={{ display: 'grid', gap: 8 }}>
                          <div>
                            <label style={{ fontSize: 11, color: 'var(--muted)' }}>Step Name</label>
                            <input
                              className="input"
                              value={viewNodeName}
                              onChange={(e) => setViewNodeName(e.target.value)}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: 'var(--muted)' }}>Kissflow Stage</label>
                            <input
                              className="input"
                              value={viewNodeStage}
                              onChange={(e) => setViewNodeStage(e.target.value)}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: 'var(--muted)' }}>Config (JSON)</label>
                            <textarea
                              className="textarea"
                              rows={8}
                              value={viewNodeConfigText}
                              onChange={(e) => setViewNodeConfigText(e.target.value)}
                            />
                          </div>
                          <button
                            className="btn btn-primary"
                            onClick={async () => {
                              try {
                                const parsedConfig = JSON.parse(viewNodeConfigText) as Record<string, unknown>;
                                const updatedDef = {
                                  ...selectedWf.definition,
                                  nodes: selectedWf.definition.nodes.map((n) =>
                                    n.id === viewNodeId
                                      ? {
                                          ...n,
                                          name: viewNodeName,
                                          stage: viewNodeStage || undefined,
                                          config: parsedConfig,
                                        }
                                      : n,
                                  ),
                                };
                                if (selectedWf.status === 'DRAFT') {
                                  const upd = await api.updateWorkflow(selectedWf.id, {
                                    definition: updatedDef,
                                  });
                                  setSelectedWf(upd);
                                  notify(`Updated step '${viewNodeId}' in draft v${upd.version}`);
                                } else {
                                  const draft = await api.createWorkflow({
                                    key: selectedWf.key,
                                    name: selectedWf.name,
                                    description: selectedWf.description,
                                    definition: updatedDef,
                                  });
                                  setSelectedWf(draft);
                                  notify(
                                    `Created new draft v${draft.version} with updated step '${viewNodeId}'`,
                                  );
                                }
                                await refreshAll();
                              } catch (err) {
                                setError(
                                  err instanceof Error ? err.message : 'Failed to save step edit',
                                );
                              }
                            }}
                          >
                            {selectedWf.status === 'DRAFT'
                              ? 'Save Step to Draft'
                              : 'Save Step as New Draft'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {selectedWf.status === 'PUBLISHED' && (
                  <div className="card">
                    <h3 style={{ marginTop: 0 }}>
                      <Play size={15} /> Launch Instance ({selectedWf.key})
                    </h3>
                    <DynamicForm
                      fields={selectedWf.definition.intakeFormSchema?.fields}
                      values={intakeVars}
                      onChange={setIntakeVars}
                    />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12, alignItems: 'center' }}>
                      <button
                        className="btn btn-primary"
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
                        <Play size={14} /> Start via API
                      </button>

                      {selectedWf.webhookPath && (
                        <>
                          <input
                            className="input"
                            style={{ width: 220 }}
                            value={webhookSecretInput}
                            onChange={(e) => setWebhookSecretInput(e.target.value)}
                            placeholder="x-webhook-secret"
                          />
                          <button
                            className="btn"
                            onClick={async () => {
                              try {
                                const res = await api.triggerWebhook(
                                  selectedWf.webhookPath!,
                                  intakeVars,
                                  webhookSecretInput || undefined,
                                );
                                notify(`Webhook accepted! Instance ${res.instanceId}`);
                                await refreshAll();
                                await loadCaseDetails(res.instanceId);
                                setTab('cases');
                              } catch (err) {
                                setError(err instanceof Error ? err.message : 'Webhook failed');
                              }
                            }}
                          >
                            <Webhook size={14} /> Trigger Webhook (/{selectedWf.webhookPath})
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'designer' && (
          <WorkflowDesigner
            key={designerKeyCounter}
            connectors={connectors}
            credentials={credentials}
            workflows={workflows}
            editingWorkflow={designerTarget}
            onSaveDraft={async (payload) => {
              const res = payload.id
                ? await api.updateWorkflow(payload.id, {
                    name: payload.name,
                    description: payload.description,
                    definition: payload.definition,
                    webhookSecret: payload.webhookSecret,
                  })
                : await api.createWorkflow({
                    key: payload.key,
                    name: payload.name,
                    description: payload.description,
                    definition: payload.definition,
                    webhookSecret: payload.webhookSecret,
                  });
              notify(`Saved workflow draft '${res.key}' v${res.version}`);
              await refreshAll();
              return res;
            }}
            onPublish={async (id) => {
              const pub = await api.publishWorkflow(id);
              notify(`Published '${pub.key}' v${pub.version}`);
              await refreshAll();
            }}
            onLaunch={(key) => {
              const found = workflows.find((w) => w.key === key && w.status === 'PUBLISHED');
              if (found) setSelectedWf(found);
              setTab('workflows');
            }}
          />
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

                  {selectedCaseWorkflow && (
                    <div style={{ marginTop: 12 }}>
                      <h4 style={{ marginBottom: 8 }}>Live Execution Topology</h4>
                      <WorkflowGraphView
                        nodes={selectedCaseWorkflow.definition.nodes}
                        edges={selectedCaseWorkflow.definition.edges}
                        activeNodeIds={selectedTrace.tokens
                          .filter((t) => t.status === 'ACTIVE' || t.status === 'WAITING')
                          .map((t) => t.currentNodeId)}
                        completedNodeIds={selectedTrace.steps
                          .filter((s) => s.status === 'COMPLETED')
                          .map((s) => s.nodeId)}
                      />
                    </div>
                  )}

                  <h4 style={{ marginBottom: 8, marginTop: 16 }}>Step Execution Trace</h4>
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
                          {s.durationMs !== null && (
                            <span style={{ color: 'var(--muted)' }}>{s.durationMs}ms</span>
                          )}
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
                                const tok =
                                  selectedTrace.tokens.find(
                                    (t) => t.status === 'WAITING' || t.status === 'ACTIVE',
                                  ) ?? selectedTrace.tokens[0];
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
              <div className="card">
                Select an instance on the left to inspect its Kissflow case view, live topology, and execution trace.
              </div>
            )}
          </div>
        )}

        {tab === 'tasks' && (
          <div style={{ display: 'grid', gap: 16 }}>
            {tasks.length === 0 && (
              <div className="card">
                No user tasks found. Launch a workflow with an approval step to see tasks here.
              </div>
            )}
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
                <Cpu size={15} /> Polyglot External Service Task Worker
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
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-success"
                      onClick={async () => {
                        await api.completeExternalTask(et.id, 'studio-worker', {
                          completedBy: 'studio-worker',
                        });
                        notify(`Completed external task ${et.id}`);
                        setExternalTasks((prev) => prev.filter((x) => x.id !== et.id));
                        await refreshAll();
                      }}
                    >
                      Complete
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={async () => {
                        await api.failExternalTask(et.id, 'studio-worker', 'Simulated worker failure');
                        notify(`Reported failure on external task ${et.id}`);
                        setExternalTasks((prev) => prev.filter((x) => x.id !== et.id));
                        await refreshAll();
                      }}
                    >
                      Fail / Retry
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'connectors' && (
          <div className="split">
            <div style={{ display: 'grid', gap: 16 }}>
              <div className="card">
                <h3 style={{ marginTop: 0 }}>Register Custom HTTP Connector</h3>
                <div style={{ display: 'grid', gap: 10 }}>
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
              </div>

              <div className="card">
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
                  <div
                    key={c.id}
                    className="list-item"
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <div>
                      <strong>{c.name}</strong> <span className="badge">{c.type}</span>{' '}
                      <span className="badge badge-green">key:{c.keyId}</span>
                    </div>
                    <button
                      className="btn btn-danger"
                      onClick={async () => {
                        await api.deleteCredential(c.id);
                        notify(`Deleted credential '${c.name}'`);
                        await refreshAll();
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>

              {user?.role === 'ADMIN' && (
                <div className="card">
                  <h3 style={{ marginTop: 0 }}>
                    <UserPlus size={15} /> Admin: Users & Service API Keys
                  </h3>
                  <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
                    <input
                      className="input"
                      placeholder="New user email"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                    />
                    <input
                      className="input"
                      placeholder="Full name"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                    />
                    <input
                      className="input"
                      type="password"
                      placeholder="Password (min 8 chars)"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                    />
                    <select
                      className="select"
                      value={regRole}
                      onChange={(e) => setRegRole(e.target.value as UserInfo['role'])}
                    >
                      {(['OPERATOR', 'BUILDER', 'VIEWER', 'HR', 'USER', 'ADMIN'] as const).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn-primary"
                      onClick={async () => {
                        try {
                          const u = await api.registerUser({
                            email: regEmail,
                            name: regName,
                            password: regPassword,
                            role: regRole,
                          });
                          setRegEmail('');
                          setRegName('');
                          setRegPassword('');
                          notify(`Created user '${u.email}' (${u.role})`);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Create user failed');
                        }
                      }}
                    >
                      Create RBAC User
                    </button>
                  </div>

                  <div style={{ display: 'grid', gap: 8 }}>
                    <input
                      className="input"
                      placeholder="Service API key name"
                      value={apiKeyName}
                      onChange={(e) => setApiKeyName(e.target.value)}
                    />
                    <select
                      className="select"
                      value={apiKeyRole}
                      onChange={(e) => setApiKeyRole(e.target.value as UserInfo['role'])}
                    >
                      {(['OPERATOR', 'BUILDER', 'VIEWER', 'HR', 'USER', 'ADMIN'] as const).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn"
                      onClick={async () => {
                        try {
                          const res = await api.createApiKey({ name: apiKeyName, role: apiKeyRole });
                          setIssuedApiKey(res.rawKey);
                          setApiKeyName('');
                          notify(`Issued API key ${res.keyPrefix}...`);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Issue API key failed');
                        }
                      }}
                    >
                      Issue Service API Key
                    </button>
                    {issuedApiKey && (
                      <div className="alert alert-ok" style={{ wordBreak: 'break-all' }}>
                        Copy once: <code>{issuedApiKey}</code>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Available Dynamic Connectors & Step Catalog</h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: 12,
                }}
              >
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

        {/* 8. NORMAL USER SELF-SERVICE PORTAL */}
        {tab === 'user-portal' && (
          <NormalUserPortal
            user={user}
            tasks={tasks}
            instances={instances}
            workflows={workflows}
            onActionComplete={() => void refreshAll()}
            lang={lang}
          />
        )}

        {/* 9. HR MANAGER DESK & QUORUM */}
        {tab === 'hr-desk' && (
          <HRManagerPortal
            user={user}
            tasks={tasks}
            instances={instances}
            workflows={workflows}
            onActionComplete={() => void refreshAll()}
            lang={lang}
          />
        )}

        {/* 10. TENANT WORKFLOW IMPORTER (REVERSE ENGINEERED JSON ENGINE) */}
        {tab === 'importer' && (
          <TenantImporterView
            onImportComplete={() => void refreshAll()}
            lang={lang}
          />
        )}

        {/* 11. TEMPORAL OPS CONTROL PANEL */}
        {tab === 'temporal' && (
          <TemporalControlPanel
            instances={instances}
            externalTasks={externalTasks}
            workflows={workflows}
            onActionComplete={() => void refreshAll()}
            lang={lang}
          />
        )}

        {/* 12. ETHIOPIAN PAPERLESS REGISTRY & DIGITAL SEALS */}
        {tab === 'correspondence' && (
          <CorrespondenceRegistryView
            user={user}
            lang={lang}
          />
        )}

        {/* 13. LOGGING & COMPLIANCE AUDIT SYSTEMS */}
        {tab === 'logs' && (
          <LogsView
            onNotify={notify}
            onError={setError}
          />
        )}

        {/* 14. ENTERPRISE STORAGE VAULT */}
        {tab === 'storage' && <DocumentVaultView />}
        </div>
      </main>
    </div>
  );
}
