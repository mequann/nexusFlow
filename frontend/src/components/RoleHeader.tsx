import {
  Calendar,
  LogOut,
  Shield,
  User,
  Users,
} from 'lucide-react';
import type { AppPerspective, UserInfo } from '../types';

interface RoleHeaderProps {
  user: UserInfo | null;
  perspective: AppPerspective;
  setPerspective: (perspective: AppPerspective) => void;
  lang: 'en' | 'am';
  setLang: (lang: 'en' | 'am') => void;
  onLogout: () => void;
  onRefresh: () => void;
  autoPoll: boolean;
  setAutoPoll: (enabled: boolean) => void;
  dbReady: string;
}

export function RoleHeader({
  user,
  perspective,
  setPerspective,
  lang,
  setLang,
  onLogout,
  onRefresh,
  autoPoll,
  setAutoPoll,
  dbReady,
}: RoleHeaderProps) {
  // Approximate Ethiopian date for header banner
  const todayEth = 'ኅዳር 4 ቀን 2019 ዓ.ም';

  return (
    <header className="role-header-banner">
      <div className="role-header-left">
        <div className="brand-logo small">NF</div>
        <div>
          <div className="role-header-title">
            NexusFlow Enterprise
            <span className={`db-status-pill ${dbReady === 'ready' ? 'status-ok' : 'status-warn'}`}>
              {dbReady === 'ready' ? 'System Online' : 'Connecting'}
            </span>
          </div>
          <div className="role-header-sub">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Calendar size={12} /> {todayEth} (Nov 13, 2026)
            </span>
            <span style={{ margin: '0 6px', opacity: 0.5 }}>•</span>
            <span>Tenant: <strong>Federal Gov / Ministry / Enterprise</strong></span>
          </div>
        </div>
      </div>

      <div className="role-header-center">
        <div className="perspective-selector-wrap">
          <span className="perspective-label">
            {lang === 'am' ? 'የተጠቃሚ ሚና (Perspective):' : 'Active Role / View:'}
          </span>
          <div className="perspective-btn-group">
            <button
              type="button"
              className={`perspective-btn ${perspective === 'USER' ? 'active user-active' : ''}`}
              onClick={() => setPerspective('USER')}
              title="Normal Employee: My Tasks, Requests, Store Vouchers, Per-Diem"
            >
              <User size={14} />
              <span>{lang === 'am' ? 'መደበኛ ሠራተኛ (Employee)' : 'Normal Employee'}</span>
            </button>
            <button
              type="button"
              className={`perspective-btn ${perspective === 'HR' ? 'active hr-active' : ''}`}
              onClick={() => setPerspective('HR')}
              title="HR Manager: Consensus Approvals, Transfers, People Operations"
            >
              <Users size={14} />
              <span>{lang === 'am' ? 'የሰው ኃይል ሥራ አስኪያጅ (HR)' : 'HR Manager'}</span>
            </button>
            <button
              type="button"
              className={`perspective-btn ${perspective === 'ADMIN' ? 'active admin-active' : ''}`}
              onClick={() => setPerspective('ADMIN')}
              title="System Admin & Architect: Temporal Controls, Importer, Studio"
            >
              <Shield size={14} />
              <span>{lang === 'am' ? 'ሲስተም አድሚን (Admin)' : 'System Admin'}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="role-header-right">
        {/* Language switch */}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ padding: '4px 8px', fontSize: 12 }}
          onClick={() => setLang(lang === 'en' ? 'am' : 'en')}
        >
          {lang === 'en' ? '🇪🇹 አማርኛ' : '🇬🇧 English'}
        </button>

        {/* Live sync switch */}
        <button
          type="button"
          className={`btn btn-sm ${autoPoll ? 'btn-secondary' : 'btn-ghost'}`}
          style={{ fontSize: 11 }}
          onClick={() => setAutoPoll(!autoPoll)}
          title="Auto-refresh every 2.5s"
        >
          {autoPoll ? '⚡ Live Sync' : '⏸ Paused'}
        </button>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onRefresh}
          title="Refresh Data"
        >
          ↻
        </button>

        {/* User profile */}
        <div className="user-profile-tag">
          <div className="user-avatar">{user?.name ? user.name[0]?.toUpperCase() : 'U'}</div>
          <div className="user-meta">
            <span className="user-email">{user?.email}</span>
            <span className="user-badge">{user?.role}</span>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={onLogout}
          title="Sign out"
        >
          <LogOut size={14} />
        </button>
      </div>
    </header>
  );
}
