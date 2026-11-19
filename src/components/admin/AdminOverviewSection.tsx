import React, { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  Database,
  Activity,
  Send,
  ShieldCheck,
  Wifi,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import {
  fetchAdminOverview,
  AdminOverviewData,
  AdminSessionExpiredError,
} from '../../services/adminApi';

interface AdminOverviewSectionProps {
  onSessionExpired: (msg?: string) => void;
}

function formatUptime(sec: number): string {
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${sec % 60}s`;
}

export const AdminOverviewSection: React.FC<AdminOverviewSectionProps> = ({
  onSessionExpired,
}) => {
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminOverview();
      setData(res);
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) {
        onSessionExpired(err.message);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    load();
  }, [load]);

  const tokenSourceLabel =
    data?.telegram.tokenSource === 'env'
      ? 'Environment (env)'
      : data?.telegram.tokenSource === 'db'
      ? 'Saved in Admin'
      : 'Not configured';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[var(--tx)]">System Overview</h2>
          <p className="text-xs text-[var(--mu)]">
            Live server health, PostgreSQL status, strategy runtime, and Telegram readiness.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="min-h-[44px] px-4 rounded-xl bg-[var(--sf)] hover:bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] inline-flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
          <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-[var(--rds)] border border-[var(--rd)]/35 text-[var(--rdt)] text-xs flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.8} />
          <span>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-2xl bg-[var(--sf)] border border-[var(--bd)] animate-pulse"
            />
          ))}
        </div>
      ) : data ? (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div
              className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4"
              style={{ boxShadow: 'var(--card-shadow)' }}
            >
              <div className="flex items-center justify-between text-xs text-[var(--mu)]">
                <span>Live Matches</span>
                <Wifi className="w-4 h-4 text-[var(--rdt)]" strokeWidth={1.8} />
              </div>
              <div className="mt-2 text-2xl font-bold tabular-nums text-[var(--tx)]">
                {data.matches.live}
              </div>
              <div className="text-[11px] text-[var(--mu)] mt-0.5 tabular-nums">
                {data.matches.total} tracked · {data.server.sseClientsCount} SSE clients
              </div>
            </div>

            <div
              className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4"
              style={{ boxShadow: 'var(--card-shadow)' }}
            >
              <div className="flex items-center justify-between text-xs text-[var(--mu)]">
                <span>PostgreSQL</span>
                <Database
                  className={`w-4 h-4 ${data.db.connected ? 'text-[var(--ok-tx)]' : 'text-[var(--rdt)]'}`}
                  strokeWidth={1.8}
                />
              </div>
              <div className="mt-2 text-lg font-bold text-[var(--tx)]">
                {data.db.connected ? 'Connected' : 'Offline'}
              </div>
              <div className="text-[11px] text-[var(--mu)] mt-0.5 tabular-nums">
                {data.db.matchesCount} matches · {data.db.tradesCount} trades
              </div>
            </div>

            <div
              className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4"
              style={{ boxShadow: 'var(--card-shadow)' }}
            >
              <div className="flex items-center justify-between text-xs text-[var(--mu)]">
                <span>Telegram Bot</span>
                <Send
                  className={`w-4 h-4 ${data.telegram.configured ? 'text-[var(--ok-tx)]' : 'text-[var(--warn-tx)]'}`}
                  strokeWidth={1.8}
                />
              </div>
              <div className="mt-2 text-lg font-bold text-[var(--tx)] capitalize">
                {data.telegram.status}
              </div>
              <div className="text-[11px] text-[var(--mu)] mt-0.5">
                {tokenSourceLabel} · {data.telegram.enabled ? 'Alerts ON' : 'Alerts OFF'}
              </div>
            </div>

            <div
              className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4"
              style={{ boxShadow: 'var(--card-shadow)' }}
            >
              <div className="flex items-center justify-between text-xs text-[var(--mu)]">
                <span>Server Uptime</span>
                <ShieldCheck className="w-4 h-4 text-[var(--blut)]" strokeWidth={1.8} />
              </div>
              <div className="mt-2 text-lg font-bold tabular-nums text-[var(--tx)]">
                {formatUptime(data.server.uptimeSec)}
              </div>
              <div className="text-[11px] text-[var(--mu)] mt-0.5 tabular-nums">
                {data.server.activeSessionsCount} active admin session
                {data.server.activeSessionsCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          {/* Detailed Status Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section
              className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-3"
              style={{ boxShadow: 'var(--card-shadow)' }}
            >
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[var(--rdt)]" strokeWidth={1.8} />
                <h3 className="text-sm font-bold text-[var(--tx)]">Strategy Engine Runtime</h3>
              </div>
              <dl className="divide-y divide-[var(--bd)] text-xs">
                <div className="py-2.5 flex items-center justify-between gap-2">
                  <dt className="text-[var(--mu)]">Master Strategy Alerts</dt>
                  <dd className="flex items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded-md font-semibold text-[11px] border ${
                        data.strategy.alertsEnabled
                          ? 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border-[var(--ok-bd)]'
                          : 'bg-[var(--sf-2)] text-[var(--mu)] border-[var(--bd)]'
                      }`}
                    >
                      {data.strategy.alertsEnabled ? 'ON' : 'OFF'}
                    </span>
                    <span className="text-[11px] text-[var(--mu)]">
                      ({data.strategy.alertsSource === 'db' ? 'Admin' : 'Env'})
                    </span>
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-2">
                  <dt className="text-[var(--mu)]">Advisory Leader Lock</dt>
                  <dd className="font-semibold text-[var(--tx)]">
                    {data.strategy.leaderActive ? 'Active Leader' : 'Standby'}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-2">
                  <dt className="text-[var(--mu)]">Tracked Match States</dt>
                  <dd className="font-semibold tabular-nums text-[var(--tx)]">
                    {data.strategy.trackedStatesCount}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-2">
                  <dt className="text-[var(--mu)]">Offline Outbox Pending</dt>
                  <dd className="font-mono text-[11px] tabular-nums text-[var(--tx)]">
                    T:{data.strategy.pendingOutbox.trades} · S:{data.strategy.pendingOutbox.signals} · P:
                    {data.strategy.pendingOutbox.positions}
                  </dd>
                </div>
              </dl>
            </section>

            <section
              className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-3"
              style={{ boxShadow: 'var(--card-shadow)' }}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[var(--ok-tx)]" strokeWidth={1.8} />
                <h3 className="text-sm font-bold text-[var(--tx)]">Security & Transport</h3>
              </div>
              <dl className="divide-y divide-[var(--bd)] text-xs">
                <div className="py-2.5 flex items-center justify-between gap-2">
                  <dt className="text-[var(--mu)]">NODE_ENV</dt>
                  <dd className="font-mono font-semibold text-[var(--tx)]">{data.server.nodeEnv}</dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-2">
                  <dt className="text-[var(--mu)]">Session Cookie Secure Flag</dt>
                  <dd className="font-mono font-semibold text-[var(--tx)]">
                    {data.server.cookieSecure ? 'true (HTTPS)' : 'false (HTTP mode)'}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-2">
                  <dt className="text-[var(--mu)]">Trust Proxy</dt>
                  <dd className="font-mono font-semibold text-[var(--tx)]">
                    {String(data.server.trustProxy)}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-2">
                  <dt className="text-[var(--mu)]">Last Live Feed Sync</dt>
                  <dd className="font-mono text-[11px] tabular-nums text-[var(--tx)]">
                    {data.server.lastFeedSyncAt
                      ? new Date(data.server.lastFeedSyncAt).toLocaleTimeString()
                      : 'Not synced yet'}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
};
