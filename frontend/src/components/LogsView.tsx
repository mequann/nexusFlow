import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { AuditLogRecord, SystemLogEntry } from '../types';

interface LogsViewProps {
  onNotify: (msg: string) => void;
  onError: (err: string) => void;
}

export const LogsView: React.FC<LogsViewProps> = ({ onNotify, onError }) => {
  const [activeTab, setActiveTab] = useState<'system' | 'audit'>('system');
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [minLevel, setMinLevel] = useState<string>('debug');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLogRecord | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      if (activeTab === 'system') {
        const res = await api.getSystemLogs({ minLevel, limit: 200 });
        setSystemLogs(res.items);
      } else {
        const res = await api.getAuditLogs({
          action: actionFilter || undefined,
          limit: 150,
        });
        setAuditLogs(res.items);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [activeTab, minLevel, actionFilter, onError]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      void fetchLogs();
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const filteredSystemLogs = systemLogs.filter((entry) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const msg = entry.message.toLowerCase();
    const metaStr = entry.meta ? JSON.stringify(entry.meta).toLowerCase() : '';
    return msg.includes(q) || metaStr.includes(q);
  });

  const filteredAuditLogs = auditLogs.filter((entry) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const actor = (entry.userEmail ?? entry.userId ?? '').toLowerCase();
    const action = entry.action.toLowerCase();
    const res = `${entry.resourceType}:${entry.resourceId}`.toLowerCase();
    return actor.includes(q) || action.includes(q) || res.includes(q);
  });

  const exportAuditLogs = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(auditLogs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `nexusflow-audit-trail-${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    onNotify('Compliance audit trail exported to JSON');
  };

  const getLevelBadgeClass = (level: string) => {
    switch (level) {
      case 'error':
        return 'badge-danger';
      case 'warn':
        return 'badge-warning';
      case 'info':
        return 'badge-info';
      case 'debug':
        return 'badge-neutral';
      default:
        return 'badge-neutral';
    }
  };

  const getActionBadgeClass = (action: string) => {
    if (action.includes('LOGIN')) return 'badge-success';
    if (action.includes('FAIL') || action.includes('CANCEL')) return 'badge-danger';
    if (action.includes('RESET') || action.includes('ESCALAT')) return 'badge-warning';
    return 'badge-info';
  };

  return (
    <div className="logs-view-container" style={{ padding: '16px' }}>
      {/* Top Banner and Tabs */}
      <div className="card" style={{ marginBottom: '16px', padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📑</span> Enterprise Logging & Compliance Systems
            </h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Structured Pino log streaming, live worker telemetry, and immutable SOC 2 / ISO 27001 audit trails.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className={`btn ${activeTab === 'system' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveTab('system')}
              style={{ fontSize: '0.85rem' }}
            >
              💻 Live System Logs ({systemLogs.length})
            </button>
            <button
              type="button"
              className={`btn ${activeTab === 'audit' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveTab('audit')}
              style={{ fontSize: '0.85rem' }}
            >
              🛡️ Audit Trail ({auditLogs.length})
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setAutoRefresh((v) => !v)}
              style={{ fontSize: '0.8rem', color: autoRefresh ? 'var(--color-primary)' : 'var(--text-muted)' }}
              title="Auto-refresh every 3s"
            >
              {autoRefresh ? '🟢 Live Sync On' : '⏸️ Paused'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void fetchLogs()}
              disabled={loading}
              style={{ fontSize: '0.8rem' }}
            >
              {loading ? '↻ Refreshing...' : '↻ Refresh'}
            </button>
            {activeTab === 'audit' && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={exportAuditLogs}
                style={{ fontSize: '0.8rem' }}
              >
                ⬇️ Export JSON
              </button>
            )}
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder={activeTab === 'system' ? 'Filter system logs by keyword...' : 'Search actor, action, or resource...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: '1 1 240px',
              padding: '6px 12px',
              background: 'var(--bg-input, #131722)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '0.85rem',
            }}
          />

          {activeTab === 'system' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label htmlFor="log-level-select" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Min Level:</label>
              <select
                id="log-level-select"
                value={minLevel}
                onChange={(e) => setMinLevel(e.target.value)}
                style={{
                  padding: '6px 10px',
                  background: 'var(--bg-input, #131722)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '0.85rem',
                }}
              >
                <option value="debug">DEBUG & Above</option>
                <option value="info">INFO & Above</option>
                <option value="warn">WARN & Above</option>
                <option value="error">ERROR Only</option>
              </select>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label htmlFor="log-action-select" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Action:</label>
              <select
                id="log-action-select"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                style={{
                  padding: '6px 10px',
                  background: 'var(--bg-input, #131722)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '0.85rem',
                }}
              >
                <option value="">All Actions</option>
                <option value="AUTH_LOGIN">AUTH_LOGIN</option>
                <option value="INSTANCE_STARTED">INSTANCE_STARTED</option>
                <option value="WORKFLOW_PUBLISHED">WORKFLOW_PUBLISHED</option>
                <option value="TASK_APPROVED">TASK_APPROVED</option>
                <option value="INCIDENT_RESOLVED">INCIDENT_RESOLVED</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'system' ? (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <span>Live Structured Ring Buffer (Max 1000 in memory)</span>
            <span>Showing {filteredSystemLogs.length} events</span>
          </div>

          <div style={{ maxHeight: '600px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.82rem', padding: '8px' }}>
            {filteredSystemLogs.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No system logs match the current filter criteria.
              </div>
            ) : (
              filteredSystemLogs.map((log, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    gap: '10px',
                    padding: '6px 10px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    alignItems: 'flex-start',
                    lineHeight: '1.4',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '0.75rem', width: '130px' }}>
                    {log.timestamp.split('T')[1]?.replace('Z', '') ?? log.timestamp}
                  </span>
                  <span className={`badge ${getLevelBadgeClass(log.level)}`} style={{ textTransform: 'uppercase', fontSize: '0.7rem', padding: '2px 6px', width: '50px', textAlign: 'center' }}>
                    {log.level}
                  </span>
                  <div style={{ flex: 1, wordBreak: 'break-word' }}>
                    <span style={{ color: log.level === 'error' ? '#ff6b6b' : log.level === 'warn' ? '#ffd166' : '#eee' }}>
                      {log.message}
                    </span>
                    {log.meta && Object.keys(log.meta).length > 0 && (
                      <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontSize: '0.75rem' }}>
                        {JSON.stringify(log.meta)}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selectedAuditLog ? '1fr 380px' : '1fr', gap: '16px' }}>
          <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <span>Immutable Compliance Audit Trail</span>
              <span>Showing {filteredAuditLogs.length} events</span>
            </div>

            <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '10px 14px' }}>Timestamp</th>
                    <th style={{ padding: '10px 14px' }}>Action</th>
                    <th style={{ padding: '10px 14px' }}>Actor</th>
                    <th style={{ padding: '10px 14px' }}>Resource</th>
                    <th style={{ padding: '10px 14px' }}>Tenant</th>
                    <th style={{ padding: '10px 14px' }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No audit events found.
                      </td>
                    </tr>
                  ) : (
                    filteredAuditLogs.map((entry) => (
                      <tr
                        key={entry.id}
                        onClick={() => setSelectedAuditLog(entry)}
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          cursor: 'pointer',
                          background: selectedAuditLog?.id === entry.id ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '8px 14px', whiteSpace: 'nowrap', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {new Date(entry.timestamp).toLocaleTimeString()} · {new Date(entry.timestamp).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '8px 14px' }}>
                          <span className={`badge ${getActionBadgeClass(entry.action)}`}>
                            {entry.action}
                          </span>
                        </td>
                        <td style={{ padding: '8px 14px' }}>
                          <span style={{ fontWeight: 500 }}>{entry.userEmail ?? entry.userId ?? 'system'}</span>
                        </td>
                        <td style={{ padding: '8px 14px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          <span style={{ color: '#aaa' }}>{entry.resourceType}</span>: {entry.resourceId.slice(0, 8)}...
                        </td>
                        <td style={{ padding: '8px 14px', fontSize: '0.8rem' }}>
                          <code>{entry.tenantId}</code>
                        </td>
                        <td style={{ padding: '8px 14px' }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedAuditLog(entry);
                            }}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Audit Details Drawer */}
          {selectedAuditLog && (
            <div className="card" style={{ padding: '16px', height: 'fit-content' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Audit Event Details</h3>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '2px 6px', fontSize: '0.8rem' }}
                  onClick={() => setSelectedAuditLog(null)}
                >
                  ✕
                </button>
              </div>

              <div style={{ fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Audit UUID:</span>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{selectedAuditLog.id}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Action:</span>
                  <div><span className={`badge ${getActionBadgeClass(selectedAuditLog.action)}`}>{selectedAuditLog.action}</span></div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Actor:</span>
                  <div>{selectedAuditLog.userEmail ?? selectedAuditLog.userId ?? 'system'}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Target Resource:</span>
                  <div>{selectedAuditLog.resourceType} ({selectedAuditLog.resourceId})</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Tenant:</span>
                  <div><code>{selectedAuditLog.tenantId}</code></div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Timestamp:</span>
                  <div>{new Date(selectedAuditLog.timestamp).toISOString()}</div>
                </div>

                <div style={{ marginTop: '8px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Payload Snapshot:</span>
                  <pre style={{
                    margin: '6px 0 0',
                    background: '#0d1117',
                    padding: '8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    overflowX: 'auto',
                    border: '1px solid var(--border-color)',
                  }}>
                    {JSON.stringify(selectedAuditLog.details, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
