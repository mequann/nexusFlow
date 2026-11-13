import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Code2,
  FileCode,
  Layers,
  Sparkles,
  Upload,
  Workflow,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import type { TenantImportValidationResult } from '../types';

interface TenantImporterViewProps {
  onImportComplete: () => void;
  lang: 'en' | 'am';
}

const SAMPLE_TEMPLATE_JSON = {
  _guide: {
    about: 'Full sample for tenant workflow import reverse engineered for NexusFlow.',
    availableWorkflowCodes: {
      EmployeeMaster: ['EmployeeMasterTransfer', 'EmployeeMasterOnboarding'],
    },
  },
  workflows: [
    {
      code: 'EmployeeMasterTransfer',
      name: 'Employee Transfer Approval',
      description: 'Three-step sample: employee submits request, managers review in parallel consensus, HR grants final approval.',
      country: 'ET',
      domainService: 'EmployeeMaster',
      version: 1,
      status: 'Draft',
      tags: ['transfer', 'employee-master', 'sample'],
      steps: [
        {
          stepOrder: 1,
          code: 'REQUEST_SUBMISSION',
          name: 'Request Submission',
          collaborationMode: 'Sequential',
          requiredParticipants: 1,
          buttonLabel: 'SUBMIT',
          timeLimitHours: 48,
          statuses: [
            { statusCode: 'DRAFT', name: 'Draft', isDefault: true, isTerminal: false },
            { statusCode: 'SUBMITTED', name: 'Submitted', isDefault: false, isTerminal: true },
          ],
          fields: [
            { name: 'employeeId', label: 'Employee ID', fieldType: 'Text', isRequired: true },
            { name: 'targetDepartment', label: 'Target Department', fieldType: 'Text', isRequired: true },
            { name: 'transferReason', label: 'Transfer Reason', fieldType: 'Textarea', isRequired: true },
          ],
        },
        {
          stepOrder: 2,
          code: 'MANAGER_REVIEW',
          name: 'Managers Consensus Review',
          collaborationMode: 'Consensus',
          requiredParticipants: 2,
          buttonLabel: 'APPROVE',
          timeLimitHours: 48,
          statuses: [
            { statusCode: 'PENDING_REVIEW', name: 'Pending Review', isDefault: true, isTerminal: false },
            { statusCode: 'APPROVED', name: 'Approved', isDefault: false, isTerminal: true },
            { statusCode: 'REJECTED', name: 'Rejected', isDefault: false, isTerminal: true },
          ],
        },
        {
          stepOrder: 3,
          code: 'HR_FINAL_APPROVAL',
          name: 'HR Final Endorsement',
          collaborationMode: 'Sequential',
          requiredParticipants: 1,
          buttonLabel: 'ENDORSE',
          timeLimitHours: 24,
          statuses: [
            { statusCode: 'PENDING_HR', name: 'Pending HR', isDefault: true, isTerminal: false },
            { statusCode: 'COMPLETED', name: 'Completed', isDefault: false, isTerminal: true },
          ],
        },
      ],
    },
  ],
};

export function TenantImporterView({ onImportComplete, lang }: TenantImporterViewProps) {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(SAMPLE_TEMPLATE_JSON, null, 2));
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [validationResult, setValidationResult] = useState<TenantImportValidationResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleValidate = async () => {
    setValidating(true);
    setError(null);
    setNotice(null);
    try {
      const parsed = JSON.parse(jsonText);
      const res = await api.validateTenantImport(parsed);
      setValidationResult(res);
      if (res.valid) {
        setNotice(
          lang === 'am'
            ? `የቴምፕሌት ፍተሻ ተሳክቷል! ${res.summary.workflowCount} የሥራ ፍሰት(ቶች) ተረጋግጠዋል።`
            : `Validation passed! Found ${res.summary.workflowCount} valid workflow definition(s).`,
        );
      } else {
        setError(
          lang === 'am'
            ? `የተገኙ ስህተቶች (${res.errors.length}): ${res.errors.join('; ')}`
            : `Validation failed with ${res.errors.length} issue(s): ${res.errors.join('; ')}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON format');
      setValidationResult(null);
    } finally {
      setValidating(false);
    }
  };

  const handleProcessImport = async () => {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const parsed = JSON.parse(jsonText);
      const res = await api.processTenantImport(parsed);
      setNotice(
        lang === 'am'
          ? `በተሳካ ሁኔታ ${res.importedCount} የሥራ ፍሰት ወደ NexusFlow ተጭኖ ዝግጁ ሆኗል!`
          : `Successfully compiled and imported ${res.importedCount} workflow(s) into NexusFlow engine!`,
      );
      onImportComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import execution failed');
    } finally {
      setImporting(false);
    }
  };

  const handleLoadSample = () => {
    setJsonText(JSON.stringify(SAMPLE_TEMPLATE_JSON, null, 2));
    setValidationResult(null);
    setError(null);
    setNotice('Sample template reloaded into editor.');
  };

  return (
    <div className="importer-view-wrap">
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">
              <Sparkles size={18} color="var(--primary)" />
              {lang === 'am'
                ? 'የድርጅት የሥራ ፍሰት መጫኛ (Enterprise Tenant Workflow Importer)'
                : 'Enterprise Tenant Workflow Importer & Reverse-Engineering Engine'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
              Supports schema definitions from <code>tenant-workflow-import-template (1).json</code> with consensus modes, custom form rules, SLA hours, and automated graph compilation.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleLoadSample}>
              <Code2 size={14} />
              Load Sample Template
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleValidate}
              disabled={validating}
            >
              <CheckCircle2 size={14} />
              {validating ? 'Validating...' : 'Validate Schema'}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleProcessImport}
              disabled={importing || (validationResult !== null && !validationResult.valid)}
            >
              <Upload size={14} />
              {importing ? 'Compiling DAG...' : 'Process & Publish Workflow'}
            </button>
          </div>
        </div>

        {notice && (
          <div className="alert alert-success" style={{ margin: '14px 0' }}>
            <CheckCircle2 size={16} />
            <span>{notice}</span>
          </div>
        )}

        {error && (
          <div className="alert alert-error" style={{ margin: '14px 0' }}>
            <XCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="importer-split-grid">
          {/* Left: JSON Editor */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <FileCode size={14} /> Import JSON Definition
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {jsonText.split('\n').length} lines
              </span>
            </div>
            <textarea
              className="input code-editor-textarea"
              rows={18}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
            />
          </div>

          {/* Right: Parsed Structure Preview */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Layers size={14} /> Compiled Architecture Preview
              </span>
              {validationResult?.valid && (
                <span className="badge badge-green">Schema Validated</span>
              )}
            </div>

            {validationResult?.summary?.workflows ? (
              <div className="summary-workflow-container">
                {validationResult.summary.workflows.map((wf) => (
                  <div key={wf.code} className="card-nested">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{wf.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          Code: <code>{wf.code}</code> • Domain: <code>{wf.domainService}</code> • v{wf.version}
                        </div>
                      </div>
                      <span className="badge badge-blue">{wf.stepsCount} Sequential/Parallel Steps</span>
                    </div>

                    <div className="step-pipeline-visual" style={{ marginTop: 14 }}>
                      {wf.steps.map((st, idx) => (
                        <div key={st.code} className="pipeline-step-node">
                          <div className="pipeline-step-header">
                            <span className="step-num">{st.stepOrder}</span>
                            <span className="step-name">{st.name}</span>
                          </div>
                          <div className="pipeline-step-meta">
                            <span className="meta-tag">
                              Mode: <strong>{st.collaborationMode}</strong>
                            </span>
                            <span className="meta-tag">
                              <Clock size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                              SLA: <strong>{st.timeLimitHours}h</strong>
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                            Statuses: {st.statuses.join(', ')}
                          </div>
                          {idx < wf.steps.length - 1 && (
                            <div className="pipeline-step-arrow">
                              <ArrowRight size={14} color="var(--primary)" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ height: '360px', display: 'grid', placeContent: 'center' }}>
                <Workflow size={32} color="var(--muted)" style={{ opacity: 0.5, margin: '0 auto' }} />
                <div style={{ fontWeight: 600, marginTop: 10 }}>No validated preview yet</div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Click <strong>"Validate Schema"</strong> above to parse steps, stages, and SLA quotas.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
