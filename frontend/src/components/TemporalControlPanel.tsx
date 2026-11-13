import { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  FastForward,
  Play,
  RotateCcw,
  Search,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import type { ExternalTask, WorkflowInstance } from '../types';

interface TemporalControlPanelProps {
  instances: WorkflowInstance[];
  externalTasks: ExternalTask[];
  onActionComplete: () => void;
  lang: 'en' | 'am';
}

export function TemporalControlPanel({
  instances,
  externalTasks,
  onActionComplete,
  lang,
}: TemporalControlPanelProps) {
  // Time Travel Reset state
  const [resetInstanceId, setResetInstanceId] = useState('');
  const [resetTargetNode, setResetTargetNode] = useState('REQUEST_SUBMISSION');
  const [resetReason, setResetReason] = useState('Operator rewound execution to apply retroactive policy update');
  const [resetVarsJson, setResetVarsJson] = useState('{"discountApproved": true, "auditOverride": true}');
  const [resetLoading, setResetLoading] = useState(false);

  // Continue As New state
  const [canInstanceId, setCanInstanceId] = useState('');
  const [canReason, setCanReason] = useState('History compaction after 500 cron cycles');
  const [canCarryoverVars, setCanCarryoverVars] = useState('{"iteration": 2, "lastCheckpoint": 1000}');
  const [canLoading, setCanLoading] = useState(false);

  // Live Query state
  const [queryInstanceId, setQueryInstanceId] = useState('');
  const [queryExpr, setQueryExpr] = useState('{{ $vars.transferSalaryEtb || $vars.totalAmount || "ACTIVE" }}');
  const [queryResult, setQueryResult] = useState<unknown>(null);
  const [queryLoading, setQueryLoading] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExecuteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetInstanceId) {
      setError('Please select an instance ID to reset');
      return;
    }
    setResetLoading(true);
    setError(null);
    try {
      let varsOverride: Record<string, unknown> = {};
      if (resetVarsJson.trim()) {
        varsOverride = JSON.parse(resetVarsJson);
      }
      await api.resetInstance(resetInstanceId, {
        targetNodeId: resetTargetNode,
        reason: resetReason,
        variablesOverride: varsOverride,
      });
      setNotice(
        lang === 'am'
          ? `የሥራ ፍሰት #${resetInstanceId.slice(0, 8)} ወደ ቀደመው ደረጃ (${resetTargetNode}) በተሳካ ሁኔታ ተመልሷል (Rewound)!`
          : `Workflow #${resetInstanceId.slice(0, 8)} rewound to node '${resetTargetNode}' with clean tokens. Execution resumed forward!`,
      );
      onActionComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetLoading(false);
    }
  };

  const handleExecuteContinueAsNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canInstanceId) {
      setError('Please select an instance ID to compact');
      return;
    }
    setCanLoading(true);
    setError(null);
    try {
      let carryover: Record<string, unknown> = {};
      if (canCarryoverVars.trim()) {
        carryover = JSON.parse(canCarryoverVars);
      }
      const newGen = await api.continueAsNew(canInstanceId, {
        carryoverVariables: carryover,
        reason: canReason,
      });
      setNotice(
        lang === 'am'
          ? `የታሪክ ማጠቃለያ (ContinueAsNew) ተከናውኗል! አዲስ ትውልድ (Generation ${newGen.generation || 2}) ተጀምሯል።`
          : `Compacted instance #${canInstanceId.slice(0, 8)} into new Generation ${newGen.generation || 2} (#${newGen.id.slice(0, 8)})!`,
      );
      onActionComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Continue-As-New failed');
    } finally {
      setCanLoading(false);
    }
  };

  const handleExecuteQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryInstanceId) {
      setError('Please select an instance ID to query');
      return;
    }
    setQueryLoading(true);
    setError(null);
    try {
      const res = await api.queryInstance(queryInstanceId, {
        expression: queryExpr,
      });
      setQueryResult(res.result);
      setNotice(`Query evaluated at ${new Date(res.evaluatedAt).toLocaleTimeString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setQueryLoading(false);
    }
  };

  return (
    <div className="temporal-panel-container">
      {notice && (
        <div className="alert alert-success" style={{ marginBottom: 14 }}>
          <CheckCircle2 size={16} />
          <span>{notice}</span>
          <button type="button" className="close-alert-btn" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 14 }}>
          <XCircle size={16} />
          <span>{error}</span>
          <button type="button" className="close-alert-btn" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      <div className="temporal-grid-2">
        {/* Capability 1: Time Travel Reset */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <RotateCcw size={18} color="var(--primary)" />
              {lang === 'am'
                ? 'የጊዜ ጉዞ ወደ ኋላ መልስ (Point-in-Time Reset)'
                : 'Point-in-Time Reset (Temporal Time Travel)'}
            </div>
            <span className="badge badge-blue">Time Travel</span>
          </div>

          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Rewinds execution back to any prior node ID, cancels active tokens/incidents, overrides variables, and restarts forward execution seamlessly.
          </p>

          <form onSubmit={handleExecuteReset} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <div>
              <label className="input-label">Target Workflow Instance</label>
              <select
                className="input"
                value={resetInstanceId}
                onChange={(e) => setResetInstanceId(e.target.value)}
                required
              >
                <option value="">-- Choose an instance --</option>
                {instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.workflowKey} (Status: {i.status}, ID: {i.id.slice(0, 8)}...)
                  </option>
                ))}
              </select>
            </div>

            <div className="form-grid-2">
              <div>
                <label className="input-label">Target Node ID to Rewind</label>
                <input
                  className="input"
                  value={resetTargetNode}
                  onChange={(e) => setResetTargetNode(e.target.value)}
                  placeholder="e.g. REQUEST_SUBMISSION or step1"
                  required
                />
              </div>
              <div>
                <label className="input-label">Reason for Reset</label>
                <input
                  className="input"
                  value={resetReason}
                  onChange={(e) => setResetReason(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="input-label">Variables JSON Override (Optional)</label>
              <textarea
                className="input code-editor-textarea"
                rows={3}
                value={resetVarsJson}
                onChange={(e) => setResetVarsJson(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={resetLoading}>
              <RotateCcw size={14} />
              {resetLoading ? 'Rewinding State...' : 'Rewind Instance to Target Node'}
            </button>
          </form>
        </div>

        {/* Capability 2: Continue As New */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <FastForward size={18} color="var(--accent)" />
              {lang === 'am'
                ? 'ታሪክ ማጠቃለያ (Continue-As-New Compaction)'
                : 'Continue-As-New (State & History Compaction)'}
            </div>
            <span className="badge badge-green">Compaction</span>
          </div>

          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Closes the current instance generation and cleanly launches Generation N+1 with carried-over state, preventing unbounded execution log growth.
          </p>

          <form onSubmit={handleExecuteContinueAsNew} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <div>
              <label className="input-label">Long-Running / Cyclic Instance</label>
              <select
                className="input"
                value={canInstanceId}
                onChange={(e) => setCanInstanceId(e.target.value)}
                required
              >
                <option value="">-- Choose an instance --</option>
                {instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.workflowKey} (Gen {i.generation || 1}, Status: {i.status}, ID: {i.id.slice(0, 8)}...)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="input-label">Compaction Reason</label>
              <input
                className="input"
                value={canReason}
                onChange={(e) => setCanReason(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="input-label">Carryover Variables JSON</label>
              <textarea
                className="input code-editor-textarea"
                rows={3}
                value={canCarryoverVars}
                onChange={(e) => setCanCarryoverVars(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-secondary" disabled={canLoading}>
              <FastForward size={14} />
              {canLoading ? 'Compacting Generation...' : 'Trigger Continue-As-New'}
            </button>
          </form>
        </div>
      </div>

      <div className="temporal-grid-2" style={{ marginTop: 16 }}>
        {/* Capability 3: Activity Heartbeating Monitor */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Activity size={18} color="var(--success)" />
              {lang === 'am'
                ? 'የተግባራት ልብ ትርታ (Activity Heartbeating Monitor)'
                : 'Activity Heartbeating & Worker Progress'}
            </div>
            <span className="badge badge-green">Live Workers</span>
          </div>

          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Tracks worker liveliness and completion percentages without premature timeouts on lengthy external batch jobs.
          </p>

          {externalTasks.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <Activity size={28} color="var(--muted)" style={{ opacity: 0.6 }} />
              <div style={{ fontWeight: 600, marginTop: 6 }}>No active external tasks running</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Lock external tasks via worker SDK to inspect live heartbeats.
              </div>
            </div>
          ) : (
            <div className="table-responsive" style={{ marginTop: 10 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Topic</th>
                    <th>Worker ID</th>
                    <th>Progress</th>
                    <th>Last Heartbeat</th>
                  </tr>
                </thead>
                <tbody>
                  {externalTasks.map((et) => {
                    const prog = et.progress ?? 0;
                    return (
                      <tr key={et.id}>
                        <td>
                          <strong>{et.topic}</strong>
                        </td>
                        <td>
                          <code>{et.workerId || 'Pending'}</code>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="progress-bar-track">
                              <div className="progress-bar-fill" style={{ width: `${prog}%` }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{prog}%</span>
                          </div>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {et.lastHeartbeatAt ? new Date(et.lastHeartbeatAt).toLocaleTimeString() : 'N/A'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Capability 4: Live Sandboxed Query */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Search size={18} color="var(--accent)" />
              {lang === 'am' ? 'የቀጥታ ፍተሻ (Live Synchronous Query)' : 'Synchronous Live Workflow Queries'}
            </div>
            <span className="badge badge-blue">Zero Side-Effect</span>
          </div>

          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Evaluates live sandboxed expressions against active workflow variables without mutating state or triggering token events.
          </p>

          <form onSubmit={handleExecuteQuery} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <div>
              <label className="input-label">Select Workflow Instance</label>
              <select
                className="input"
                value={queryInstanceId}
                onChange={(e) => setQueryInstanceId(e.target.value)}
                required
              >
                <option value="">-- Choose an instance --</option>
                {instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.workflowKey} (ID: {i.id.slice(0, 8)}...)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="input-label">Sandboxed Expression</label>
              <input
                className="input"
                value={queryExpr}
                onChange={(e) => setQueryExpr(e.target.value)}
                placeholder="e.g. {{ $vars.transferSalaryEtb >= 50000 }}"
                required
              />
            </div>

            <button type="submit" className="btn btn-secondary" disabled={queryLoading}>
              <Play size={14} />
              {queryLoading ? 'Evaluating...' : 'Run Read-Only Query'}
            </button>
          </form>

          {queryResult !== null && (
            <div className="query-result-box" style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                Evaluated Result:
              </div>
              <pre style={{ margin: 0, fontSize: 13 }}>{JSON.stringify(queryResult, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
