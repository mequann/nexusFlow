import { useEffect, useState } from 'react';
import {
  Award,
  CheckCircle2,
  FileText,
  MessageSquare,
  Plus,
  QrCode,
  Send,
  Stamp,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import type { CorrespondenceItem, UserInfo } from '../types';

interface CorrespondenceRegistryViewProps {
  user: UserInfo | null;
  lang: 'en' | 'am';
}

export function CorrespondenceRegistryView({ user: _user, lang }: CorrespondenceRegistryViewProps) {
  const [items, setItems] = useState<CorrespondenceItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<CorrespondenceItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New correspondence form
  const [newType, setNewType] = useState<'INBOUND' | 'OUTBOUND' | 'INTERNAL_MEMO'>('INBOUND');
  const [subject, setSubject] = useState('');
  const [senderOrg, setSenderOrg] = useState('');
  const [recipientOrg, setRecipientOrg] = useState('');
  const [urgency, setUrgency] = useState('NORMAL');
  const [bodyHtml, setBodyHtml] = useState('');

  // Minute form
  const [minuteAction, setMinuteAction] = useState<string>('RECOMMENDED');
  const [minuteComment, setMinuteComment] = useState('');

  // Seal form
  const [signatoryRole, setSignatoryRole] = useState('Director General / ዋና ዳይሬክተር');

  const loadCorrespondence = async () => {
    try {
      setLoading(true);
      const res = await api.listCorrespondence();
      setItems(res.items);
      if (res.items.length > 0 && !selectedItem) {
        setSelectedItem(res.items[0]!);
      } else if (selectedItem) {
        const refreshed = res.items.find((i) => i.id === selectedItem.id);
        if (refreshed) setSelectedItem(refreshed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch correspondence');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCorrespondence();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      const created = await api.createCorrespondence({
        type: newType,
        subject,
        senderOrg,
        recipientOrg,
        urgency,
        bodyHtml,
      });
      setNotice(
        lang === 'am'
          ? `ደብዳቤው በምዝገባ ቁጥር ${created.referenceNumber} በተሳካ ሁኔታ ተመዝግቧል!`
          : `Correspondence registered with Reference #${created.referenceNumber}!`,
      );
      setShowCreateModal(false);
      setSubject('');
      setSenderOrg('');
      setRecipientOrg('');
      setBodyHtml('');
      await loadCorrespondence();
      setSelectedItem(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  const handleAddMinute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !minuteComment.trim()) return;
    try {
      setError(null);
      const updated = await api.addMinute(selectedItem.id, {
        actionTaken: minuteAction,
        comment: minuteComment,
      });
      setNotice(
        lang === 'am'
          ? 'ማስታወሻው (Minute) በሰነዱ ላይ ታትሟል!'
          : 'Minute endorsement appended to correspondence!',
      );
      setMinuteComment('');
      setSelectedItem(updated);
      await loadCorrespondence();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to endorse minute');
    }
  };

  const handleApproveAndSeal = async () => {
    if (!selectedItem) return;
    try {
      setError(null);
      const updated = await api.approveAndSeal(selectedItem.id, {
        signatoryRole,
      });
      setNotice(
        lang === 'am'
          ? 'ኦፊሴላዊ ዲጂታል ማህተም እና QR ኮድ በሰነዱ ላይ ተረጋግጧል!'
          : 'Document approved & official cryptographic digital seal applied!',
      );
      setSelectedItem(updated);
      await loadCorrespondence();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sealing failed');
    }
  };

  return (
    <div className="portal-container">
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

      <div className="card-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="card-title">
            <Stamp size={18} color="var(--primary)" />
            {lang === 'am'
              ? 'የደብዳቤዎችና ሰነዶች ኦፊሴላዊ መዝገብ (Inbound / Outbound Registry)'
              : 'Ethiopian Paperless Registry & Official Correspondence Desk'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Bilingual Ge'ez calendar indexing, digital minute sheets (*የማስታወሻ ቅጽ*), and HMAC-SHA256 digital seals (*ኦፊሴላዊ ማህተም*).
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setShowCreateModal(true)}
        >
          <Plus size={14} />
          {lang === 'am' ? 'አዲስ ደብዳቤ መዝግብ' : 'Register New Correspondence'}
        </button>
      </div>

      <div className="correspondence-grid">
        {/* Left: Correspondence list */}
        <div className="card">
          <div className="card-header">
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              {lang === 'am' ? 'የተመዘገቡ ደብዳቤዎች' : 'Registered Documents'} ({items.length})
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={loadCorrespondence}>
              ↻
            </button>
          </div>

          {items.length === 0 ? (
            <div className="empty-state">
              <FileText size={32} color="var(--muted)" style={{ opacity: 0.6 }} />
              <div style={{ fontWeight: 600, marginTop: 8 }}>No correspondence items found</div>
            </div>
          ) : (
            <div className="task-list-grid">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`task-row-card ${selectedItem?.id === item.id ? 'selected' : ''}`}
                  onClick={() => setSelectedItem(item)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="code-pill">{item.referenceNumber}</span>
                    <span
                      className={`badge ${
                        item.status === 'SEALED' ? 'badge-green' : 'badge-amber'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginTop: 6 }}>{item.subject}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    From: <strong>{item.senderOrg}</strong> → To: <strong>{item.recipientOrg}</strong>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    📅 {item.ethiopianDateStr || 'ኅዳር 2019 ዓ.ም'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Document & Digital Seal Details */}
        {selectedItem ? (
          <div className="card">
            <div className="card-header">
              <div>
                <span className="code-pill" style={{ fontSize: 13 }}>
                  {selectedItem.referenceNumber}
                </span>
                <h3 style={{ margin: '8px 0 2px 0', fontSize: 17 }}>{selectedItem.subject}</h3>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  From: <strong>{selectedItem.senderOrg}</strong> | To:{' '}
                  <strong>{selectedItem.recipientOrg}</strong> | Date:{' '}
                  <strong>{selectedItem.ethiopianDateStr}</strong>
                </div>
              </div>

              {selectedItem.digitalSeal ? (
                <div className="digital-seal-badge">
                  <Stamp size={20} color="var(--success)" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--success)' }}>
                      DIGITALLY SEALED
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                      {selectedItem.digitalSeal.sealedBy}
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleApproveAndSeal}
                >
                  <Stamp size={14} />
                  {lang === 'am' ? 'አጽድቅና ማህተም ምታ' : 'Approve & Affix Digital Seal'}
                </button>
              )}
            </div>

            {/* Document Body */}
            <div className="document-body-card">
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>DOCUMENT CONTENT</div>
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                {selectedItem.bodyHtml || 'Official correspondence memo registered in NexusFlow.'}
              </div>
            </div>

            {/* Official Digital Seal QR Section */}
            {selectedItem.digitalSeal && (
              <div className="seal-verification-box">
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <div className="seal-stamp-circle">
                    <Award size={32} color="#10b981" />
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#10b981', textAlign: 'center' }}>
                      MInT SEAL
                    </span>
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Official Cryptographic Seal</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      Signatory: <strong>{selectedItem.digitalSeal.sealedBy}</strong> (
                      {selectedItem.digitalSeal.signatoryRole})
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      Digest: <code>{selectedItem.digitalSeal.digest.slice(0, 24)}...</code>
                    </div>
                    <a
                      href={selectedItem.digitalSeal.verificationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="verification-link"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 12 }}
                    >
                      <QrCode size={13} /> Verify Official Certificate on Public Ledger
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Threaded Digital Minutes Section */}
            <div style={{ marginTop: 18 }}>
              <div className="card-title" style={{ fontSize: 15, marginBottom: 10 }}>
                <MessageSquare size={16} color="var(--primary)" />
                {lang === 'am' ? 'የማስታወሻ ቅጽ (Digital Minute Sheet)' : 'Digital Endorsement Minutes'}
              </div>

              {selectedItem.minutes && selectedItem.minutes.length > 0 ? (
                <div className="minute-timeline">
                  {selectedItem.minutes.map((m) => (
                    <div key={m.id} className="minute-entry-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>{m.authorName}</strong>{' '}
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                            ({m.authorRole} • {m.department})
                          </span>
                        </div>
                        <span className="badge badge-blue">{m.actionTaken}</span>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 13, fontStyle: 'italic' }}>
                        "{m.comment}"
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                        📅 {m.ethiopianDateStr}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', marginBottom: 12 }}>
                  No minutes endorsed yet.
                </div>
              )}

              {/* Endorse Minute Form */}
              <form onSubmit={handleAddMinute} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                <div className="form-grid-2">
                  <div>
                    <label className="input-label">Action / Endorsement</label>
                    <select
                      className="input"
                      value={minuteAction}
                      onChange={(e) => setMinuteAction(e.target.value)}
                    >
                      <option value="RECOMMENDED">RECOMMENDED (ይሁንታ ተሰጥቷል)</option>
                      <option value="APPROVED">APPROVED (ተፈቅዷል)</option>
                      <option value="FORWARDED">FORWARDED (ለሚመለከተው ተመርቷል)</option>
                      <option value="COMMENT">COMMENT (አስተያየት)</option>
                      <option value="REJECTED">REJECTED (ውድቅ ተደርጓል)</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label">Signatory Role</label>
                    <input
                      className="input"
                      value={signatoryRole}
                      onChange={(e) => setSignatoryRole(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="Enter minute endorsement remarks (e.g. ተፈቅዷል አስፈላጊው ቅጽ ተሞልቶ ይፈጸም)..."
                    value={minuteComment}
                    onChange={(e) => setMinuteComment(e.target.value)}
                    required
                  />
                </div>

                <button type="submit" className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }}>
                  <Send size={13} />
                  {lang === 'am' ? 'ማስታወሻውን መዝግብ' : 'Append Minute Endorsement'}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="card" style={{ display: 'grid', placeContent: 'center', height: '400px' }}>
            <Stamp size={40} color="var(--muted)" style={{ opacity: 0.5, margin: '0 auto' }} />
            <div style={{ fontWeight: 600, marginTop: 10 }}>Select a document to inspect minutes and seal</div>
          </div>
        )}
      </div>

      {/* Modal: Register Correspondence */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content card">
            <div className="modal-header">
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                {lang === 'am' ? 'አዲስ ደብዳቤ ምዝገባ' : 'Register New Correspondence'}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              <div className="form-grid-2">
                <div>
                  <label className="input-label">Type</label>
                  <select
                    className="input"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as any)}
                  >
                    <option value="INBOUND">INBOUND (ገቢ ደብዳቤ)</option>
                    <option value="OUTBOUND">OUTBOUND (ወጪ ደብዳቤ)</option>
                    <option value="INTERNAL_MEMO">INTERNAL MEMO (የውስጥ ማስታወሻ)</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Urgency</label>
                  <select
                    className="input"
                    value={urgency}
                    onChange={(e) => setUrgency(e.target.value)}
                  >
                    <option value="NORMAL">NORMAL (መደበኛ)</option>
                    <option value="URGENT">URGENT (አስቸኳይ)</option>
                    <option value="VERY_URGENT">VERY URGENT (እጅግ በጣም አስቸኳይ)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="input-label">Subject (ጉዳዩ)</label>
                <input
                  className="input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. የ2019 በጀት ዓመት የቴክኖሎጂ ግብዓቶች ማጠቃለያ"
                  required
                />
              </div>

              <div className="form-grid-2">
                <div>
                  <label className="input-label">Sender Org / Dept (ላኪ)</label>
                  <input
                    className="input"
                    value={senderOrg}
                    onChange={(e) => setSenderOrg(e.target.value)}
                    placeholder="e.g. Ministry of Innovation & Technology"
                    required
                  />
                </div>
                <div>
                  <label className="input-label">Recipient Org / Dept (ተቀባይ)</label>
                  <input
                    className="input"
                    value={recipientOrg}
                    onChange={(e) => setRecipientOrg(e.target.value)}
                    placeholder="e.g. Ethio Telecom Corporate"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="input-label">Document Body / Brief</label>
                <textarea
                  className="input"
                  rows={4}
                  value={bodyHtml}
                  onChange={(e) => setBodyHtml(e.target.value)}
                  placeholder="Official letter memo or requisition text..."
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <Send size={15} />
                  Register & Generate Ref
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
