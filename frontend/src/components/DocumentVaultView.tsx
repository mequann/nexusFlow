import React, { useEffect, useState } from 'react';
import {
  Archive,
  Download,
  FileCheck,
  FileText,
  HardDrive,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { api } from '../api';

export interface StoredFile {
  id: string;
  tenantId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  storageDriver: 'local' | 'database' | 's3_compatible';
  storagePath: string;
  metadata: Record<string, unknown>;
  uploadedBy?: string | null;
  createdAt: string;
}

export function DocumentVaultView() {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.listFiles();
      setFiles(res.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to list stored documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setError(null);
      setNotice(null);

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = reader.result as string;
          // extract base64 part
          const base64 = result.includes(',') ? result.split(',')[1] : result;
          await api.uploadFile(
            file.name,
            base64,
            file.type || 'application/octet-stream',
            { originalName: file.name, uploadedVia: 'DocumentVaultUI' },
          );
          setNotice(`Document "${file.name}" uploaded successfully`);
          fetchFiles();
        } catch (uploadErr: any) {
          setError(uploadErr.message || 'File upload failed');
        } finally {
          setUploading(false);
        }
      };
      reader.onerror = () => {
        setError('Failed reading local file');
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(err.message);
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete document "${name}" permanently?`)) return;
    try {
      await api.deleteFile(id);
      setNotice(`Deleted "${name}"`);
      fetchFiles();
    } catch (err: any) {
      setError(err.message || 'Delete failed');
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const filtered = files.filter(
    (f) =>
      f.filename.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.mimeType.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (f.uploadedBy && f.uploadedBy.toLowerCase().includes(searchTerm.toLowerCase())),
  );

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Top Header Card */}
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <HardDrive size={22} color="var(--primary)" /> Enterprise Document Vault & Storage
          </h2>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
            Pluggable high-performance document attachments supporting Local Disk, PostgreSQL chunking, and S3-compatible object stores (Cloudflare R2, MinIO, AWS S3).
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label className="btn btn-primary" style={{ cursor: uploading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <UploadCloud size={16} />
            {uploading ? 'Uploading...' : 'Upload Document'}
            <input type="file" onChange={handleFileUpload} disabled={uploading} style={{ display: 'none' }} />
          </label>
          <button className="btn" onClick={fetchFiles} disabled={loading} title="Refresh">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {notice && (
        <div style={{ padding: '10px 14px', background: '#ecfdf5', color: '#065f46', borderRadius: 6, fontSize: 13, border: '1px solid #a7f3d0' }}>
          {notice}
        </div>
      )}
      {error && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: 13, border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {/* Storage Drivers Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <div className="card" style={{ borderLeft: '4px solid #10b981' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Active Storage Node</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Archive size={18} /> Zero-Config Hybrid Engine
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Local NVMe Disk &amp; Postgres BLOB Chunking
          </div>
        </div>
        <div className="card" style={{ borderLeft: '4px solid #3b82f6' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Documents</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{files.length}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Total payload: {formatBytes(files.reduce((acc, f) => acc + (f.sizeBytes || 0), 0))}
          </div>
        </div>
        <div className="card" style={{ borderLeft: '4px solid #8b5cf6' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Audit Integrity</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileCheck size={18} color="#8b5cf6" /> SHA-256 Checksums
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Cryptographically verifiable attachments</div>
        </div>
      </div>

      {/* Search and Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ position: 'relative', width: 320 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--muted)' }} />
            <input
              type="text"
              placeholder="Search by filename, MIME type or uploader..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ paddingLeft: 32, width: '100%' }}
            />
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Showing {filtered.length} of {files.length} documents
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
            <FileText size={40} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            <div style={{ fontWeight: 600 }}>No documents stored yet</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Upload attachments, requisition PDFs, or contract scans to view them here.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                  <th style={{ padding: '10px 12px' }}>Filename</th>
                  <th style={{ padding: '10px 12px' }}>MIME Type</th>
                  <th style={{ padding: '10px 12px' }}>Size</th>
                  <th style={{ padding: '10px 12px' }}>Driver</th>
                  <th style={{ padding: '10px 12px' }}>SHA-256 Checksum</th>
                  <th style={{ padding: '10px 12px' }}>Uploaded By</th>
                  <th style={{ padding: '10px 12px' }}>Created</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileText size={16} color="var(--primary)" />
                        <span>{f.filename}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                      <code>{f.mimeType}</code>
                    </td>
                    <td style={{ padding: '10px 12px' }}>{formatBytes(f.sizeBytes)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span className="badge badge-blue">{f.storageDriver}</span>
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)' }} title={f.checksumSha256}>
                      {f.checksumSha256 ? `${f.checksumSha256.substring(0, 12)}...` : '-'}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{f.uploadedBy || 'system'}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12 }}>
                      {new Date(f.createdAt).toLocaleDateString()} {new Date(f.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <a
                          className="btn"
                          href={api.downloadFileUrl(f.id)}
                          download={f.filename}
                          title="Download document"
                          style={{ padding: '4px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <Download size={13} /> Download
                        </a>
                        <button
                          className="btn"
                          onClick={() => handleDelete(f.id, f.filename)}
                          title="Delete file"
                          style={{ padding: '4px 8px', fontSize: 12, color: 'var(--danger, #ef4444)' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
