import React, { useState } from 'react';
import { Lock, AlertTriangle, ArrowLeft, ShieldCheck } from 'lucide-react';
import { ThemeToggle, ThemeMode } from '../ThemeToggle';
import { adminLogin, AdminApiError, AdminSessionInfo } from '../../services/adminApi';

interface AdminLoginViewProps {
  theme: ThemeMode;
  onThemeChange: (next: ThemeMode) => void;
  configured: boolean;
  sessionNotice?: string | null;
  onLoginSuccess: (info: AdminSessionInfo) => void;
}

export const AdminLoginView: React.FC<AdminLoginViewProps> = ({
  theme,
  onThemeChange,
  configured,
  sessionNotice,
  onLoginSuccess,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured || submitting) return;
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const info = await adminLogin(username.trim(), password);
      setPassword('');
      onLoginSuccess(info);
    } catch (err: unknown) {
      if (err instanceof AdminApiError) {
        if (err.status === 429 && err.retryAfterSec) {
          setErrorMsg(
            `${err.message} Retry available in ${Math.ceil(err.retryAfterSec / 60)} min (${err.retryAfterSec}s).`
          );
        } else {
          setErrorMsg(err.message);
        }
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('Sign in failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--tx)] flex flex-col">
      <header className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
        <a
          href="/"
          className="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-xl bg-[var(--sf)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] hover:bg-[var(--sf-2)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-[var(--mu)]" strokeWidth={1.8} />
          <span>Live Scorer</span>
        </a>
        <ThemeToggle theme={theme} onToggle={onThemeChange} />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div
          className="w-full max-w-md rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-6 sm:p-7 space-y-5"
          style={{ boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[var(--rd)] text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" strokeWidth={1.8} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-[var(--tx)]">
                Admin Console
              </h1>
              <p className="text-xs text-[var(--mu)]">
                Crex Scorer operational controls
              </p>
            </div>
          </div>

          {sessionNotice && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-[var(--warn-bg)] border border-[var(--warn-bd)] text-[var(--warn-tx)] text-xs flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.8} />
              <span>{sessionNotice}</span>
            </div>
          )}

          {!configured && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-[var(--rds)] border border-[var(--rd)]/35 text-[var(--rdt)] text-xs space-y-1.5"
            >
              <div className="font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.8} />
                <span>Admin Authentication Not Configured</span>
              </div>
              <p className="leading-relaxed">
                Set <code className="font-mono">ADMIN_USERNAME</code>,{' '}
                <code className="font-mono">ADMIN_PASSWORD_HASH</code> (via{' '}
                <code className="font-mono">npm run admin:hash</code>), and{' '}
                <code className="font-mono">SESSION_SECRET</code> in the server{' '}
                <code className="font-mono">.env</code> file, then restart the server.
              </p>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              aria-live="assertive"
              className="p-3.5 rounded-xl bg-[var(--rds)] border border-[var(--rd)]/35 text-[var(--rdt)] text-xs flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.8} />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="admin-username" className="block text-xs font-semibold text-[var(--tx)]">
                Username
              </label>
              <input
                id="admin-username"
                name="username"
                type="text"
                autoComplete="username"
                required
                disabled={!configured || submitting}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter admin username"
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-sm text-[var(--tx)] placeholder-[var(--mu)] focus:border-[var(--rd)] disabled:opacity-50"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="admin-password" className="block text-xs font-semibold text-[var(--tx)]">
                Password
              </label>
              <input
                id="admin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={!configured || submitting}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-sm text-[var(--tx)] placeholder-[var(--mu)] focus:border-[var(--rd)] disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={!configured || submitting || !username.trim() || !password}
              className="w-full min-h-[44px] px-4 rounded-xl bg-[var(--rd)] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-45 inline-flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" strokeWidth={1.8} />
              <span>{submitting ? 'Signing in...' : 'Sign In'}</span>
            </button>
          </form>

          <p className="text-[11px] text-[var(--mu)] text-center pt-1">
            HttpOnly cookie session · 12-hour expiry · Server-enforced lockout
          </p>
        </div>
      </main>
    </div>
  );
};
