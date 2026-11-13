import { useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  FileCheck,
  Package,
  Plane,
  Plus,
  Send,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import { DynamicForm } from './DynamicForm';
import type { UserInfo, UserTask, WorkflowInstance, WorkflowRecord } from '../types';

interface NormalUserPortalProps {
  user: UserInfo | null;
  tasks: UserTask[];
  instances: WorkflowInstance[];
  workflows: WorkflowRecord[];
  onActionComplete: () => void;
  lang: 'en' | 'am';
}

type UserSubTab = 'inbox' | 'services' | 'my-requests';

export function NormalUserPortal({
  user,
  tasks,
  instances,
  onActionComplete,
  lang,
}: NormalUserPortalProps) {
  const [activeSubTab, setActiveSubTab] = useState<UserSubTab>('inbox');
  const [selectedTask, setSelectedTask] = useState<UserTask | null>(null);
  const [taskFormData, setTaskFormData] = useState<Record<string, unknown>>({});
  const [serviceAction, setServiceAction] = useState<string | null>(null);
  const [serviceSubmitting, setServiceSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form states for self-service requests
  const [transferForm, setTransferForm] = useState({
    employeeName: user?.name ?? 'Abebe Bikila',
    employeeId: 'EMP-ET-0428',
    currentDepartment: 'Operations / IT',
    targetDepartment: 'Finance & Accounts',
    targetLocation: 'Addis Ababa - Head Office',
    transferReason: 'Professional career development and internal vacancy transfer',
    proposedEffectiveDate: '2026-12-01',
    transferType: 'Permanent',
  });

  const [model20Form, setModel20Form] = useState({
    requestorName: user?.name ?? 'Kebede Chala',
    department: 'Civil Engineering Directorate',
    storeType: 'General Stationery & Equipment Store',
    items: '1. Lenovo ThinkPad T14 (Qty: 1)\n2. Ergonomic Office Chair (Qty: 1)\n3. A4 Paper Reams (Qty: 5)',
    purpose: 'For newly assigned senior project supervision role',
  });

  const [perDiemForm, setPerDiemForm] = useState({
    travelerName: user?.name ?? 'Almaz Tadesse',
    destinationCity: 'Hawassa / Sidama Region',
    departureDate: '2026-11-20',
    returnDate: '2026-11-25',
    tripPurpose: 'Regional agricultural data center field audit',
    estimatedPerDiemEtb: 14500,
    transportMode: 'Official Vehicle (4WD)',
  });

  // Filter tasks belonging to current user or group
  const myTasks = tasks.filter(
    (t) =>
      !t.assignee ||
      t.assignee === user?.id ||
      t.assignee === user?.email ||
      t.status === 'OPEN' ||
      t.status === 'CLAIMED',
  );

  const handleCompleteTask = async (task: UserTask, rejected = false) => {
    try {
      setErrorMessage(null);
      await api.completeTask(task.id, taskFormData, rejected);
      setStatusMessage(
        rejected
          ? lang === 'am'
            ? 'ተግባሩ ውድቅ ተደርጓል'
            : 'Task has been rejected'
          : lang === 'am'
          ? 'ተግባሩ በተሳካ ሁኔታ ተፈጽሟል'
          : 'Task completed successfully',
      );
      setSelectedTask(null);
      setTaskFormData({});
      onActionComplete();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const handleStartTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setServiceSubmitting(true);
    setErrorMessage(null);
    try {
      await api.startInstance(
        'EmployeeMasterTransfer',
        {
          ...transferForm,
          reason: transferForm.transferReason,
          requestTitle: `Transfer: ${transferForm.employeeName} -> ${transferForm.targetDepartment}`,
          targetDepartment: transferForm.targetDepartment,
          effectiveDate: transferForm.proposedEffectiveDate,
          transferType: transferForm.transferType || 'Permanent',
          requestedBy: user?.email ?? 'user@nexusflow.local',
          submissionDate: new Date().toISOString(),
          currency: 'ETB',
        },
        { source: 'Portal.EmployeeTransfer' },
      );
      setStatusMessage(
        lang === 'am'
          ? 'የዝውውር ጥያቄዎ በተሳካ ሁኔታ ቀርቧል! የሥራ ኃላፊዎች ማጽደቂያ ላይ ደርሷል።'
          : 'Employee Transfer requisition submitted! Forwarded to manager review step.',
      );
      setServiceAction(null);
      setActiveSubTab('my-requests');
      onActionComplete();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to submit transfer request');
    } finally {
      setServiceSubmitting(false);
    }
  };

  const handleStartModel20 = async (e: React.FormEvent) => {
    e.preventDefault();
    setServiceSubmitting(true);
    setErrorMessage(null);
    try {
      await api.startInstance(
        'ethiopian-store-model-20',
        {
          ...model20Form,
          requesterName: model20Form.requestorName,
          itemsRequested: model20Form.items,
          itemCount: 3,
          requestedBy: user?.email ?? 'user@nexusflow.local',
          formType: 'MODEL_20_ISSUE_VOUCHER',
          submissionDate: new Date().toISOString(),
        },
        { source: 'Portal.Model20' },
      );
      setStatusMessage(
        lang === 'am'
          ? 'የሞዴል 20 የዕቃ ወጪ ማዘዣ ጥያቄ በተሳካ ሁኔታ ተመዝግቧል!'
          : 'Model 20 Store issue voucher submitted! Dispatched for department approval.',
      );
      setServiceAction(null);
      setActiveSubTab('my-requests');
      onActionComplete();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to submit Model 20 request');
    } finally {
      setServiceSubmitting(false);
    }
  };

  const handleStartPerDiem = async (e: React.FormEvent) => {
    e.preventDefault();
    setServiceSubmitting(true);
    setErrorMessage(null);
    try {
      await api.startInstance(
        'ethiopian-field-mission-per-diem',
        {
          ...perDiemForm,
          destination: perDiemForm.destinationCity,
          missionObjective: perDiemForm.tripPurpose,
          estimatedDays: 5,
          requestedBy: user?.email ?? 'user@nexusflow.local',
          currency: 'ETB',
          submissionDate: new Date().toISOString(),
        },
        { source: 'Portal.PerDiem' },
      );
      setStatusMessage(
        lang === 'am'
          ? 'የውሎ አበልና የመስክ ጉዞ ጥያቄዎ በተሳካ ሁኔታ ተልኳል!'
          : 'Field mission & per-diem requisition submitted! Route to finance and directorate.',
      );
      setServiceAction(null);
      setActiveSubTab('my-requests');
      onActionComplete();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to submit Per-Diem request');
    } finally {
      setServiceSubmitting(false);
    }
  };

  return (
    <div className="portal-container">
      {/* Sub-tab navigation */}
      <div className="sub-nav-bar">
        <button
          type="button"
          className={`sub-nav-btn ${activeSubTab === 'inbox' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('inbox')}
        >
          <FileCheck size={16} />
          <span>{lang === 'am' ? 'የእኔ ተግባራት (Inbox)' : 'My Pending Tasks'}</span>
          {myTasks.length > 0 && <span className="counter-pill">{myTasks.length}</span>}
        </button>

        <button
          type="button"
          className={`sub-nav-btn ${activeSubTab === 'services' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('services')}
        >
          <Plus size={16} />
          <span>{lang === 'am' ? 'አዲስ ጥያቄ አቅርብ (Service Catalog)' : 'Service Catalog & Requisitions'}</span>
        </button>

        <button
          type="button"
          className={`sub-nav-btn ${activeSubTab === 'my-requests' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('my-requests')}
        >
          <Clock size={16} />
          <span>{lang === 'am' ? 'ያቀረብኳቸው ጥያቄዎች (My Submissions)' : 'Track My Requests'}</span>
          <span className="counter-pill secondary">{instances.length}</span>
        </button>
      </div>

      {statusMessage && (
        <div className="alert alert-success" style={{ margin: '14px 0' }}>
          <CheckCircle2 size={16} />
          <span>{statusMessage}</span>
          <button type="button" className="close-alert-btn" onClick={() => setStatusMessage(null)}>
            ×
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="alert alert-error" style={{ margin: '14px 0' }}>
          <XCircle size={16} />
          <span>{errorMessage}</span>
          <button type="button" className="close-alert-btn" onClick={() => setErrorMessage(null)}>
            ×
          </button>
        </div>
      )}

      {/* 1. MY PENDING TASKS VIEW */}
      {activeSubTab === 'inbox' && (
        <div className="portal-content-grid">
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <FileCheck size={18} color="var(--primary)" />
                {lang === 'am' ? 'ለእርስዎ የተመደቡ ተግባራት' : 'Assigned Tasks Waiting For You'}
              </div>
              <span className="text-muted" style={{ fontSize: 13 }}>
                {myTasks.length} {lang === 'am' ? 'ተግባር ተገኝቷል' : 'actionable tasks'}
              </span>
            </div>

            {myTasks.length === 0 ? (
              <div className="empty-state">
                <CheckCircle2 size={36} color="var(--success)" style={{ opacity: 0.6 }} />
                <div style={{ fontWeight: 600, marginTop: 8 }}>
                  {lang === 'am' ? 'ምንም የሚጠብቅ ተግባር የለም' : 'All caught up! No pending tasks'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {lang === 'am'
                    ? 'አዲስ ጥያቄ ለማቅረብ ከላይ የሚገኘውን Service Catalog ይምረጡ።'
                    : 'Submit a new requisition or check back when a workflow step is assigned to you.'}
                </div>
              </div>
            ) : (
              <div className="task-list-grid">
                {myTasks.map((t) => (
                  <div
                    key={t.id}
                    className={`task-row-card ${selectedTask?.id === t.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedTask(t);
                      setTaskFormData(t.payload || {});
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{t.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                          {t.description || 'Action required to proceed workflow.'}
                        </div>
                      </div>
                      <span className={`badge ${t.slaBreached ? 'badge-red' : 'badge-blue'}`}>
                        {t.slaBreached ? 'SLA BREACHED' : t.status}
                      </span>
                    </div>

                    <div className="task-meta-footer">
                      <span><strong>Stage:</strong> {t.stage || 'General Step'}</span>
                      {t.candidateGroup && <span><strong>Group:</strong> {t.candidateGroup}</span>}
                      <span>
                        <Calendar size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                        {new Date(t.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Task Action Drawer / Inspector */}
          {selectedTask && (
            <div className="card task-inspector-card">
              <div className="card-header">
                <div>
                  <div className="card-title">{selectedTask.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Instance ID: <code>{selectedTask.instanceId.slice(0, 8)}...</code>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelectedTask(null)}
                >
                  ✕
                </button>
              </div>

              {selectedTask.formSchema?.fields && selectedTask.formSchema.fields.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <DynamicForm
                    fields={selectedTask.formSchema.fields}
                    values={taskFormData}
                    onChange={setTaskFormData}
                  />
                  <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ flex: 1 }}
                      onClick={() => void handleCompleteTask(selectedTask, false)}
                    >
                      <CheckCircle2 size={16} />
                      {lang === 'am' ? '✅ አጽድቅና ጨርስ' : 'Approve & Submit Resolution'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => void handleCompleteTask(selectedTask, true)}
                    >
                      <XCircle size={16} />
                      {lang === 'am' ? 'ውድቅ አድርግ' : 'Reject'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 14 }}>
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                    {lang === 'am'
                      ? 'ይህ ተግባር ምንም ተጨማሪ የቅጽ መረጃ አይፈልግም። ፈቃድ መስጠት ወይም ውድቅ ማድረግ ይችላሉ።'
                      : 'This step does not require form input. Review the payload and make your decision.'}
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ flex: 1 }}
                      onClick={() => void handleCompleteTask(selectedTask, false)}
                    >
                      <CheckCircle2 size={16} />
                      {lang === 'am' ? 'ፈቅጃለሁ (Approve)' : 'Approve Step'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => void handleCompleteTask(selectedTask, true)}
                    >
                      <XCircle size={16} />
                      {lang === 'am' ? 'ውድቅ አድርግ (Reject)' : 'Reject'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2. SERVICE CATALOG & REQUISITIONS */}
      {activeSubTab === 'services' && (
        <div>
          <div className="service-catalog-grid">
            {/* Catalog Card 1: Employee Transfer Request */}
            <div className="catalog-card">
              <div className="catalog-icon bg-indigo">
                <UserCheck size={24} color="#fff" />
              </div>
              <div className="catalog-content">
                <div className="catalog-title">
                  {lang === 'am' ? 'የሠራተኛ የውስጥ ዝውውር (Employee Transfer)' : 'Internal Employee Transfer'}
                </div>
                <div className="catalog-desc">
                  {lang === 'am'
                    ? 'በቴምፕሌት የተቀረፀው የ3-ደረጃ የዝውውር ቅጽ፡ ጥያቄ፣ የአለቆች የጋራ ስምምነት (Consensus) እና የHR ማጽደቂያ።'
                    : 'Reverse-engineered from the Enterprise Import template. 3-step workflow with parallel consensus reviews.'}
                </div>
                <div className="catalog-tags">
                  <span className="tag">HR Master</span>
                  <span className="tag">Consensus</span>
                  <span className="tag">48h SLA</span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: 12 }}
                  onClick={() => setServiceAction('transfer')}
                >
                  <Plus size={14} />
                  {lang === 'am' ? 'ጥያቄውን ጀምር' : 'Initiate Transfer'}
                </button>
              </div>
            </div>

            {/* Catalog Card 2: Model 20 Store Issue Voucher */}
            <div className="catalog-card">
              <div className="catalog-icon bg-teal">
                <Package size={24} color="#fff" />
              </div>
              <div className="catalog-content">
                <div className="catalog-title">
                  {lang === 'am' ? 'የዕቃ ወጪ ማዘዣ ሞዴል 20 (Model 20)' : 'Model 20 Store Issue Voucher'}
                </div>
                <div className="catalog-desc">
                  {lang === 'am'
                    ? 'የመንግሥትና የህዝብ ተቋማት የንብረትና የዕቃ ወጪ ማዘዣ ቅጽ ከዲጂታል ማህተም እና ከQR ኮድ ማረጋገጫ ጋር።'
                    : 'Official Ethiopian Government Model 20 Store Requisition with digital minute sheets and HMAC QR seal.'}
                </div>
                <div className="catalog-tags">
                  <span className="tag">Ethiopian Office</span>
                  <span className="tag">Model 20</span>
                  <span className="tag">Digital Seal</span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: 12 }}
                  onClick={() => setServiceAction('model20')}
                >
                  <Plus size={14} />
                  {lang === 'am' ? 'ሞዴል 20 ሙላ' : 'Request Store Item'}
                </button>
              </div>
            </div>

            {/* Catalog Card 3: Field Mission & Per-Diem */}
            <div className="catalog-card">
              <div className="catalog-icon bg-amber">
                <Plane size={24} color="#fff" />
              </div>
              <div className="catalog-content">
                <div className="catalog-title">
                  {lang === 'am' ? 'የመስክ ጉዞና ውሎ አበል (Per-Diem)' : 'Field Mission & Per-Diem Requisition'}
                </div>
                <div className="catalog-desc">
                  {lang === 'am'
                    ? 'የክልል የሥራ ጉዞ፣ የቀን ውሎ አበልና የትራንስፖርት ማዘዣ ከፋይናንስና ዳይሬክቶሬት ማጽደቂያ ጋር።'
                    : 'Domestic field mission per-diem requisition with automated ETB allowance calculation and Telegram notification.'}
                </div>
                <div className="catalog-tags">
                  <span className="tag">Finance</span>
                  <span className="tag">Per-Diem ETB</span>
                  <span className="tag">Telegram Bot</span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: 12 }}
                  onClick={() => setServiceAction('perdiem')}
                >
                  <Plus size={14} />
                  {lang === 'am' ? 'የውሎ አበል ጠይቅ' : 'Request Per-Diem'}
                </button>
              </div>
            </div>
          </div>

          {/* Modal / Dialog for Transfer Form */}
          {serviceAction === 'transfer' && (
            <div className="modal-overlay">
              <div className="modal-content card">
                <div className="modal-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <UserCheck size={20} color="var(--primary)" />
                    <span style={{ fontWeight: 700, fontSize: 16 }}>
                      {lang === 'am' ? 'የሠራተኛ የውስጥ ዝውውር ጥያቄ ማቅረቢያ' : 'Internal Employee Transfer Requisition'}
                    </span>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setServiceAction(null)}>
                    ✕
                  </button>
                </div>

                <form onSubmit={handleStartTransfer} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                  <div className="form-grid-2">
                    <div>
                      <label className="input-label">Employee Full Name</label>
                      <input
                        className="input"
                        value={transferForm.employeeName}
                        onChange={(e) => setTransferForm({ ...transferForm, employeeName: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="input-label">Employee ID</label>
                      <input
                        className="input"
                        value={transferForm.employeeId}
                        onChange={(e) => setTransferForm({ ...transferForm, employeeId: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div>
                      <label className="input-label">Current Department</label>
                      <input
                        className="input"
                        value={transferForm.currentDepartment}
                        onChange={(e) => setTransferForm({ ...transferForm, currentDepartment: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="input-label">Target Department</label>
                      <input
                        className="input"
                        value={transferForm.targetDepartment}
                        onChange={(e) => setTransferForm({ ...transferForm, targetDepartment: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div>
                      <label className="input-label">Target Duty Station</label>
                      <input
                        className="input"
                        value={transferForm.targetLocation}
                        onChange={(e) => setTransferForm({ ...transferForm, targetLocation: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="input-label">Transfer Type</label>
                      <select
                        className="input"
                        value={transferForm.transferType}
                        onChange={(e) => setTransferForm({ ...transferForm, transferType: e.target.value })}
                        required
                      >
                        <option value="Permanent">Permanent (ቋሚ ዝውውር)</option>
                        <option value="Temporary">Temporary (ጊዜያዊ ምደባ)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="input-label">Proposed Effective Date</label>
                    <input
                      type="date"
                      className="input"
                      value={transferForm.proposedEffectiveDate}
                      onChange={(e) => setTransferForm({ ...transferForm, proposedEffectiveDate: e.target.value })}
                      required
                    />
                  </div>

                  <div>
                    <label className="input-label">Justification & Transfer Reason</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={transferForm.transferReason}
                      onChange={(e) => setTransferForm({ ...transferForm, transferReason: e.target.value })}
                      required
                    />
                  </div>

                  <div className="modal-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setServiceAction(null)}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={serviceSubmitting}>
                      <Send size={15} />
                      {serviceSubmitting ? 'Submitting...' : 'Submit Request'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal / Dialog for Model 20 Form */}
          {serviceAction === 'model20' && (
            <div className="modal-overlay">
              <div className="modal-content card">
                <div className="modal-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Package size={20} color="var(--accent)" />
                    <span style={{ fontWeight: 700, fontSize: 16 }}>
                      {lang === 'am' ? 'የዕቃ ወጪ ማዘዣ ሞዴል 20 ማመልከቻ' : 'Model 20 Store Item Requisition'}
                    </span>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setServiceAction(null)}>
                    ✕
                  </button>
                </div>

                <form onSubmit={handleStartModel20} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                  <div className="form-grid-2">
                    <div>
                      <label className="input-label">Requestor Name (የጠያቂው ስም)</label>
                      <input
                        className="input"
                        value={model20Form.requestorName}
                        onChange={(e) => setModel20Form({ ...model20Form, requestorName: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="input-label">Department / Directorate (የሥራ ክፍል)</label>
                      <input
                        className="input"
                        value={model20Form.department}
                        onChange={(e) => setModel20Form({ ...model20Form, department: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="input-label">Store Facility (የመጋዘን ዓይነት)</label>
                    <input
                      className="input"
                      value={model20Form.storeType}
                      onChange={(e) => setModel20Form({ ...model20Form, storeType: e.target.value })}
                      required
                    />
                  </div>

                  <div>
                    <label className="input-label">Requested Items & Quantities (የዕቃዎች ዝርዝርና ብዛት)</label>
                    <textarea
                      className="input"
                      rows={4}
                      value={model20Form.items}
                      onChange={(e) => setModel20Form({ ...model20Form, items: e.target.value })}
                      required
                    />
                  </div>

                  <div>
                    <label className="input-label">Operational Purpose (የዕቃው አገልግሎት ምክንያት)</label>
                    <input
                      className="input"
                      value={model20Form.purpose}
                      onChange={(e) => setModel20Form({ ...model20Form, purpose: e.target.value })}
                      required
                    />
                  </div>

                  <div className="modal-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setServiceAction(null)}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={serviceSubmitting}>
                      <Send size={15} />
                      {serviceSubmitting ? 'Submitting...' : 'Issue Model 20'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal / Dialog for Per-Diem Form */}
          {serviceAction === 'perdiem' && (
            <div className="modal-overlay">
              <div className="modal-content card">
                <div className="modal-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Plane size={20} color="var(--warn)" />
                    <span style={{ fontWeight: 700, fontSize: 16 }}>
                      {lang === 'am' ? 'የአገር ውስጥ የመስክ ጉዞና ውሎ አበል ማዘዣ' : 'Domestic Field Mission & Per-Diem Requisition'}
                    </span>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setServiceAction(null)}>
                    ✕
                  </button>
                </div>

                <form onSubmit={handleStartPerDiem} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                  <div className="form-grid-2">
                    <div>
                      <label className="input-label">Traveler Name (የተጓዡ ስም)</label>
                      <input
                        className="input"
                        value={perDiemForm.travelerName}
                        onChange={(e) => setPerDiemForm({ ...perDiemForm, travelerName: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="input-label">Destination (የጉዞው መዳረሻ ከተማ)</label>
                      <input
                        className="input"
                        value={perDiemForm.destinationCity}
                        onChange={(e) => setPerDiemForm({ ...perDiemForm, destinationCity: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div>
                      <label className="input-label">Departure Date (የመነሻ ቀን)</label>
                      <input
                        type="date"
                        className="input"
                        value={perDiemForm.departureDate}
                        onChange={(e) => setPerDiemForm({ ...perDiemForm, departureDate: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="input-label">Return Date (የመመለሻ ቀን)</label>
                      <input
                        type="date"
                        className="input"
                        value={perDiemForm.returnDate}
                        onChange={(e) => setPerDiemForm({ ...perDiemForm, returnDate: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div>
                      <label className="input-label">Estimated Per-Diem Amount (የውሎ አበል በብር)</label>
                      <input
                        type="number"
                        className="input"
                        value={perDiemForm.estimatedPerDiemEtb}
                        onChange={(e) =>
                          setPerDiemForm({ ...perDiemForm, estimatedPerDiemEtb: Number(e.target.value) })
                        }
                        required
                      />
                    </div>
                    <div>
                      <label className="input-label">Transport Mode (የትራንስፖርት ዓይነት)</label>
                      <input
                        className="input"
                        value={perDiemForm.transportMode}
                        onChange={(e) => setPerDiemForm({ ...perDiemForm, transportMode: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="input-label">Official Purpose (የሥራው ዓላማ)</label>
                    <textarea
                      className="input"
                      rows={2}
                      value={perDiemForm.tripPurpose}
                      onChange={(e) => setPerDiemForm({ ...perDiemForm, tripPurpose: e.target.value })}
                      required
                    />
                  </div>

                  <div className="modal-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setServiceAction(null)}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={serviceSubmitting}>
                      <Send size={15} />
                      {serviceSubmitting ? 'Submitting...' : 'Submit Per-Diem'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. TRACK MY SUBMISSIONS */}
      {activeSubTab === 'my-requests' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Clock size={18} color="var(--primary)" />
              {lang === 'am' ? 'ያቀረቧቸው ጥያቄዎች ዝርዝርና ሁኔታ' : 'Your Submitted Cases & Trackers'}
            </div>
          </div>

          {instances.length === 0 ? (
            <div className="empty-state">
              <Clock size={36} color="var(--muted)" style={{ opacity: 0.6 }} />
              <div style={{ fontWeight: 600, marginTop: 8 }}>
                {lang === 'am' ? 'ምንም ጥያቄ አላቀረቡም' : 'No submitted requests yet'}
              </div>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th>Current Status</th>
                    <th>Current Stage</th>
                    <th>SLA</th>
                    <th>Started At</th>
                    <th>Instance ID</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((inst) => (
                    <tr key={inst.id}>
                      <td>
                        <strong>{inst.workflowKey}</strong>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>v{inst.workflowVersion}</div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            inst.status === 'COMPLETED'
                              ? 'badge-green'
                              : inst.status === 'RUNNING' || inst.status === 'WAITING'
                              ? 'badge-blue'
                              : 'badge-amber'
                          }`}
                        >
                          {inst.status}
                        </span>
                      </td>
                      <td>{inst.currentStage || 'Processing'}</td>
                      <td>
                        <span
                          className={`badge ${
                            inst.slaStatus === 'BREACHED' ? 'badge-red' : 'badge-green'
                          }`}
                        >
                          {inst.slaStatus}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>{new Date(inst.startedAt).toLocaleString()}</td>
                      <td>
                        <code>{inst.id.slice(0, 8)}...</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
