import { useState } from 'react';
import {
  Award,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import type { UserInfo, UserTask, WorkflowInstance, WorkflowRecord } from '../types';

interface HRManagerPortalProps {
  user: UserInfo | null;
  tasks: UserTask[];
  instances: WorkflowInstance[];
  workflows: WorkflowRecord[];
  onActionComplete: () => void;
  lang: 'en' | 'am';
}

export function HRManagerPortal({
  user,
  tasks,
  instances: _instances,
  onActionComplete,
  lang,
}: HRManagerPortalProps) {
  const [filterDomain, setFilterDomain] = useState<string>('ALL');
  const [resolvingTaskId, setResolvingTaskId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [syncingHris, setSyncingHris] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter tasks that belong to HR domain or management
  const hrTasks = tasks.filter((t) => {
    if (filterDomain === 'TRANSFER') {
      return (
        t.title.toLowerCase().includes('transfer') ||
        t.candidateGroup === 'hr' ||
        t.candidateGroup === 'management'
      );
    }
    if (filterDomain === 'SLA_RISK') {
      return t.slaBreached || (t.escalationLevel && t.escalationLevel > 0);
    }
    return true;
  });

  const handleResolveTask = async (task: UserTask, decision: 'APPROVED' | 'REJECTED') => {
    try {
      setError(null);
      await api.completeTask(
        task.id,
        {
          decision,
          hrReviewer: user?.email,
          hrDecisionDate: new Date().toISOString(),
          notes: resolutionNote || 'HR final approval granted per enterprise policy.',
        },
        decision === 'REJECTED',
      );
      setNotice(
        decision === 'APPROVED'
          ? lang === 'am'
            ? 'የሰው ኃይል ማጽደቂያ ተመዝግቧል!'
            : 'HR approval registered and instance progressed.'
          : lang === 'am'
          ? 'ጥያቄው በሰው ኃይል ውድቅ ተደርጓል'
          : 'HR review rejected.',
      );
      setResolvingTaskId(null);
      setResolutionNote('');
      onActionComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const handleTriggerHrisSync = async () => {
    setSyncingHris(true);
    setError(null);
    try {
      // Simulate/trigger HRIS sync
      await new Promise((r) => setTimeout(r, 900));
      setNotice(
        lang === 'am'
          ? 'የHRIS ዳይሬክቶሪ ማመሳሰል ተጠናቅቋል፡ 148 ሠራተኞች ተዘምነዋል።'
          : 'HRIS User Directory sync completed: 148 employee profiles, reporting managers, and departments up to date.',
      );
    } catch (err) {
      setError('HRIS sync failed');
    } finally {
      setSyncingHris(false);
    }
  };

  return (
    <div className="portal-container">
      {/* Top HR KPI Cards */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">
            <Users size={16} color="var(--primary)" />
            <span>{lang === 'am' ? 'የሚጠበቁ የHR ተግባራት' : 'Pending HR Approvals'}</span>
          </div>
          <div className="stat-val">{tasks.length}</div>
          <div className="stat-desc">
            {lang === 'am' ? 'የዝውውርና የቅጥር ማጽደቂያዎችን ጨምሮ' : 'Transfers, Promotions, Onboarding'}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">
            <UserCheck size={16} color="var(--success)" />
            <span>{lang === 'am' ? 'የጋራ ስምምነት (Consensus)' : 'Consensus Quorum Steps'}</span>
          </div>
          <div className="stat-val">
            {tasks.filter((t) => t.requiredApprovals && t.requiredApprovals > 1).length}
          </div>
          <div className="stat-desc">
            {lang === 'am' ? 'ባለብዙ-ፈራሚ የውሳኔ ደረጃዎች' : 'Multi-manager review stages'}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">
            <ShieldAlert size={16} color="var(--warn)" />
            <span>{lang === 'am' ? 'የSLA ማስጠንቀቂያ' : 'SLA Breaches / At Risk'}</span>
          </div>
          <div className="stat-val">
            {tasks.filter((t) => t.slaBreached || (t.escalationLevel ?? 0) > 0).length}
          </div>
          <div className="stat-desc">
            {lang === 'am' ? 'የተቀመጠላቸውን 48 ሰዓት ያለፉ' : 'Exceeding 48h resolution SLA'}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">
            <Award size={16} color="var(--accent)" />
            <span>{lang === 'am' ? 'የHRIS ማመሳሰል' : 'HRIS Directory Status'}</span>
          </div>
          <div className="stat-val" style={{ fontSize: 18, color: 'var(--success)' }}>
            Connected
          </div>
          <div className="stat-desc">Workday / AD Auto-Sync</div>
        </div>
      </div>

      {notice && (
        <div className="alert alert-success" style={{ margin: '14px 0' }}>
          <CheckCircle2 size={16} />
          <span>{notice}</span>
          <button type="button" className="close-alert-btn" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ margin: '14px 0' }}>
          <XCircle size={16} />
          <span>{error}</span>
          <button type="button" className="close-alert-btn" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      {/* Main HR Controls */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="card-title">
              <Users size={18} color="var(--primary)" />
              {lang === 'am' ? 'የሰው ኃይል ሥራ አመራር ተግባራት (HR Action Desk)' : 'People Operations & Review Desk'}
            </div>
            {/* Filter Pills */}
            <div className="filter-pill-group">
              <button
                type="button"
                className={`filter-pill ${filterDomain === 'ALL' ? 'active' : ''}`}
                onClick={() => setFilterDomain('ALL')}
              >
                All Tasks ({tasks.length})
              </button>
              <button
                type="button"
                className={`filter-pill ${filterDomain === 'TRANSFER' ? 'active' : ''}`}
                onClick={() => setFilterDomain('TRANSFER')}
              >
                Transfers
              </button>
              <button
                type="button"
                className={`filter-pill ${filterDomain === 'SLA_RISK' ? 'active' : ''}`}
                onClick={() => setFilterDomain('SLA_RISK')}
              >
                SLA Alerts
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleTriggerHrisSync}
            disabled={syncingHris}
          >
            <RefreshCw size={13} className={syncingHris ? 'spin' : ''} />
            {syncingHris ? 'Syncing...' : 'Sync HRIS Directory'}
          </button>
        </div>

        {hrTasks.length === 0 ? (
          <div className="empty-state">
            <CheckCircle2 size={36} color="var(--success)" style={{ opacity: 0.6 }} />
            <div style={{ fontWeight: 600, marginTop: 8 }}>
              {lang === 'am' ? 'ምንም የሚጠበቅ የHR ተግባር የለም' : 'No HR approval tasks pending'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              All employee transfers, promotions, and consensus steps are on schedule.
            </div>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Task / Step</th>
                  <th>Collaboration Mode & Quorum</th>
                  <th>Assignee / Group</th>
                  <th>SLA Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {hrTasks.map((t) => {
                  const reqCount = t.requiredApprovals || 1;
                  const receivedCount = t.approvalsReceived?.length || 0;
                  const isConsensus = reqCount > 1;

                  return (
                    <tr key={t.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{t.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          Stage: <code>{t.stage || 'General'}</code>
                        </div>
                      </td>
                      <td>
                        {isConsensus ? (
                          <div className="consensus-badge-wrap">
                            <span className="badge badge-amber">
                              Consensus: {receivedCount} of {reqCount} Signed
                            </span>
                            <div className="quorum-meter-bar">
                              <div
                                className="quorum-meter-fill"
                                style={{
                                  width: `${Math.min(100, Math.round((receivedCount / reqCount) * 100))}%`,
                                }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="badge badge-blue">Sequential / Direct</span>
                        )}
                      </td>
                      <td>
                        <span className="code-pill">{t.candidateGroup || t.assignee || 'Unassigned'}</span>
                      </td>
                      <td>
                        <span className={`badge ${t.slaBreached ? 'badge-red' : 'badge-green'}`}>
                          {t.slaBreached ? 'EXPIRED' : 'WITHIN 48H'}
                        </span>
                        {t.escalationLevel > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>
                            Escalated Lv{t.escalationLevel}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>{new Date(t.createdAt).toLocaleDateString()}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => setResolvingTaskId(t.id)}
                        >
                          Review & Decide
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review Modal Dialog */}
      {resolvingTaskId && (
        <div className="modal-overlay">
          <div className="modal-content card">
            <div className="modal-header">
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                {lang === 'am' ? 'የሰው ኃይል ውሳኔ ማሳለፊያ' : 'HR Review & Final Decision'}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setResolvingTaskId(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
              <div>
                <label className="input-label">HR Endorsement Note & Minutes (የማስታወሻ አስተያየት)</label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="e.g. Approved transfer to Finance & Accounts effective Dec 1, 2026."
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setResolvingTaskId(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    const task = tasks.find((t) => t.id === resolvingTaskId);
                    if (task) void handleResolveTask(task, 'REJECTED');
                  }}
                >
                  <XCircle size={15} />
                  Reject Requisition
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const task = tasks.find((t) => t.id === resolvingTaskId);
                    if (task) void handleResolveTask(task, 'APPROVED');
                  }}
                >
                  <CheckCircle2 size={15} />
                  Grant HR Approval
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
