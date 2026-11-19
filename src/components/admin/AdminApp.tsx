import React, { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck,
  LayoutDashboard,
  Send,
  Sliders,
  Settings,
  Wrench,
  ClipboardList,
  LogOut,
  ArrowLeft,
} from 'lucide-react';
import { ThemeToggle, ThemeMode } from '../ThemeToggle';
import {
  fetchAdminMe,
  adminLogout,
  AdminSessionInfo,
} from '../../services/adminApi';
import { AdminLoginView } from './AdminLoginView';
import { AdminOverviewSection } from './AdminOverviewSection';
import { AdminTelegramSection } from './AdminTelegramSection';
import { AdminStrategySection } from './AdminStrategySection';
import { AdminSettingsSection } from './AdminSettingsSection';
import { AdminDiagnosticsSection } from './AdminDiagnosticsSection';
import { AdminAuditLogSection } from './AdminAuditLogSection';

type AdminTab = 'overview' | 'telegram' | 'strategy' | 'settings' | 'diagnostics' | 'audit';

interface AdminAppProps {
  theme: ThemeMode;
  onThemeChange: (next: ThemeMode) => void;
}

const ADMIN_TABS: Array<{ id: AdminTab; label: string; icon: React.FC<{ className?: string; strokeWidth?: number }> }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'telegram', label: 'Telegram', icon: Send },
  { id: 'strategy', label: 'Strategy', icon: Sliders },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'diagnostics', label: 'Diagnostics', icon: Wrench },
  { id: 'audit', label: 'Audit Log', icon: ClipboardList },
];

export const AdminApp: React.FC<AdminAppProps> = ({ theme, onThemeChange }) => {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [session, setSession] = useState<AdminSessionInfo>({
    ok: true,
    authenticated: false,
    configured: true,
  });
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [loggingOut, setLoggingOut] = useState(false);

  // Enforce noindex meta tag & admin page title while mounted
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Admin Console — Crex Scorer';

    let robotsMeta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const created = !robotsMeta;
    const prevContent = robotsMeta?.getAttribute('content') ?? null;

    if (!robotsMeta) {
      robotsMeta = document.createElement('meta');
      robotsMeta.name = 'robots';
      document.head.appendChild(robotsMeta);
    }
    robotsMeta.content = 'noindex, nofollow, noarchive';

    return () => {
      document.title = prevTitle;
      if (created && robotsMeta?.parentNode) {
        robotsMeta.parentNode.removeChild(robotsMeta);
      } else if (robotsMeta && prevContent !== null) {
        robotsMeta.content = prevContent;
      }
    };
  }, []);

  const checkSession = useCallback(async () => {
    setCheckingAuth(true);
    try {
      const me = await fetchAdminMe();
      setSession(me);
    } catch {
      setSession({ ok: false, authenticated: false, configured: true });
    } finally {
      setCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const handleSessionExpired = useCallback((msg?: string) => {
    setSession((prev) => ({
      ...prev,
      authenticated: false,
      username: undefined,
      expiresAt: undefined,
    }));
    setSessionNotice(
      msg || 'Your admin session has expired. Please sign in again to continue.'
    );
  }, []);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await adminLogout();
    } catch {
      // Clear local auth view even if request fails
    } finally {
      setLoggingOut(false);
      setSession((prev) => ({
        ...prev,
        authenticated: false,
        username: undefined,
        expiresAt: undefined,
      }));
      setSessionNotice('You have been signed out.');
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--tx)] flex items-center justify-center p-4">
        <div className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] px-6 py-5 text-xs font-semibold text-[var(--mu)]">
          Checking admin session...
        </div>
      </div>
    );
  }

  if (!session.authenticated) {
    return (
      <AdminLoginView
        theme={theme}
        onThemeChange={onThemeChange}
        configured={session.configured}
        sessionNotice={sessionNotice}
        onLoginSuccess={(info) => {
          setSessionNotice(null);
          setSession({ ...info, configured: true, authenticated: true });
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--tx)] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col justify-between w-[240px] shrink-0 bg-[var(--sf)] border-r border-[var(--bd)] sticky top-0 h-screen p-4 z-30">
        <div className="space-y-6">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[var(--rd)] text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight text-[var(--tx)] truncate">
                Crex Admin
              </div>
              <div className="text-[11px] text-[var(--mu)] truncate">
                Signed in as {session.username}
              </div>
            </div>
          </div>

          <nav aria-label="Admin sections" className="space-y-1">
            {ADMIN_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full min-h-[44px] flex items-center gap-3 px-3 rounded-xl text-xs font-semibold transition-colors ${
                    isActive
                      ? 'bg-[var(--rds)] text-[var(--rdt)]'
                      : 'text-[var(--tx)] hover:bg-[var(--sf-2)]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" strokeWidth={1.8} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-2 pt-4 border-t border-[var(--bd)]">
          <a
            href="/"
            className="w-full min-h-[44px] px-3 rounded-xl bg-[var(--sf-2)] hover:bg-[var(--bd)]/35 border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] inline-flex items-center gap-2 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-[var(--mu)]" strokeWidth={1.8} />
            <span>Back to Live Scorer</span>
          </a>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full min-h-[44px] px-3 rounded-xl bg-[var(--rds)] hover:opacity-90 border border-[var(--rd)]/30 text-xs font-semibold text-[var(--rdt)] inline-flex items-center gap-2 transition-opacity disabled:opacity-50"
          >
            <LogOut className="w-4 h-4" strokeWidth={1.8} />
            <span>{loggingOut ? 'Signing out...' : 'Logout'}</span>
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* Top Bar (Mobile + Tablet + Desktop header) */}
        <header className="sticky top-0 z-20 bg-[var(--sf)] border-b border-[var(--bd)] px-4 sm:px-6 py-3">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[var(--rd)] text-white flex items-center justify-center shrink-0 lg:hidden">
                <ShieldCheck className="w-5 h-5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-[var(--tx)] truncate">
                  {ADMIN_TABS.find((t) => t.id === activeTab)?.label || 'Admin'}
                </h1>
                <p className="text-[11px] text-[var(--mu)] truncate tabular-nums">
                  {session.username}
                  {session.expiresAt
                    ? ` · Session expires ${new Date(session.expiresAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <a
                href="/"
                className="lg:hidden min-h-[44px] px-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] inline-flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4 text-[var(--mu)]" strokeWidth={1.8} />
                <span className="hidden sm:inline">Live</span>
              </a>
              <ThemeToggle theme={theme} onToggle={onThemeChange} />
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="min-h-[44px] px-3.5 rounded-xl bg-[var(--rds)] hover:opacity-90 border border-[var(--rd)]/30 text-xs font-semibold text-[var(--rdt)] inline-flex items-center gap-1.5 transition-opacity disabled:opacity-50"
              >
                <LogOut className="w-4 h-4" strokeWidth={1.8} />
                <span>{loggingOut ? 'Exiting...' : 'Logout'}</span>
              </button>
            </div>
          </div>

          {/* Mobile & Tablet Horizontal Section Tabs */}
          <nav
            aria-label="Admin sections"
            className="lg:hidden mt-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
          >
            {ADMIN_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActiveTab(tab.id)}
                  className={`min-h-[44px] px-3.5 rounded-full text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 border transition-colors shrink-0 ${
                    isActive
                      ? 'bg-[var(--rd)] text-white border-[var(--rd)]'
                      : 'bg-[var(--sf-2)] text-[var(--tx)] border-[var(--bd)]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </header>

        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-5">
          {activeTab === 'overview' && (
            <AdminOverviewSection onSessionExpired={handleSessionExpired} />
          )}
          {activeTab === 'telegram' && (
            <AdminTelegramSection onSessionExpired={handleSessionExpired} />
          )}
          {activeTab === 'strategy' && (
            <AdminStrategySection onSessionExpired={handleSessionExpired} />
          )}
          {activeTab === 'settings' && (
            <AdminSettingsSection onSessionExpired={handleSessionExpired} />
          )}
          {activeTab === 'diagnostics' && (
            <AdminDiagnosticsSection onSessionExpired={handleSessionExpired} />
          )}
          {activeTab === 'audit' && (
            <AdminAuditLogSection onSessionExpired={handleSessionExpired} />
          )}
        </main>
      </div>
    </div>
  );
};
