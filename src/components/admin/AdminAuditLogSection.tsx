import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, AlertTriangle, ClipboardList } from 'lucide-react';
import {
  fetchAdminAuditLog,
  AdminAuditEntryItem,
  AdminSessionExpiredError,
} from '../../services/adminApi';

interface AdminAuditLogSectionProps {
  onSessionExpired: (msg?: string) => void;
}

const ACTION_FILTERS = [
  '',
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGIN_LOCKED',
  'LOGOUT',
  'ADMIN_SETTINGS_UPDATE',
  'STRATEGY_ALERTS_TOGGLE',
  'TELEGRAM_CONFIG_UPDATE',
  'TELEGRAM_TEST',
  'TELEGRAM_MANUAL_BROADCAST',
  'TELEGRAM_TEST_OVER',
  'TELEGRAM_SEND',
  'STRATEGY_OVERRIDE_ENTRY',
  'STRATEGY_OVERRIDE_EXIT',
  'STRATEGY_RESET',
  'DIAGNOSTICS_RAW_INSPECT',
];

export const AdminAuditLogSection: React.FC<AdminAuditLogSectionProps> = ({
  onSessionExpired,
}) => {
  const [entries, setEntries] = useState<AdminAuditEntryItem[]>([]);
  const [source, setSource] = useState<'postgres' | 'memory'>('postgres');
  const [actionFilter, setActionFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminAuditLog(100, actionFilter || undefined);
      setEntries(res.entries || []);
      setSource(res.source);
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) {
        onSessionExpired(err.message);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [actionFilter, onSessionExpired]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[var(--tx)]">Admin Audit Log</h2>
          <p className="text-xs text-[var(--mu)]">
            Security &amp; operational trail ({source === 'postgres' ? 'PostgreSQL' : 'In-memory fallback'}). Secrets are scrubbed before write.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            aria-label="Filter by audit action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="min-h-[44px] px-3 rounded-xl bg-[var(--sf)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] focus:border-[var(--rd)]"
          >
            {ACTION_FILTERS.map((act) => (
              <option key={act || 'ALL'} value={act}>
                {act || 'All Actions'}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="min-h-[44px] px-4 rounded-xl bg-[var(--sf)] hover:bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] inline-flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
            <span>Refresh</span>
          </button>
        </div>
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

      <section
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] overflow-hidden"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        {entries.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--mu)] flex flex-col items-center gap-2">
            <ClipboardList className="w-5 h-5" strokeWidth={1.8} />
            <span>No audit log entries match this filter yet.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--bd)] bg-[var(--sf-2)] text-[11px] text-[var(--mu)]">
                  <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Time</th>
                  <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Action</th>
                  <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">Target</th>
                  <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">IP</th>
                  <th className="py-2.5 px-3.5 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {entries.map((entry, idx) => (
                  <tr key={entry.id ?? `${entry.at}-${idx}`} className="hover:bg-[var(--sf-2)]/60">
                    <td className="py-2.5 px-3.5 font-mono text-[11px] tabular-nums whitespace-nowrap text-[var(--mu)]">
                      {new Date(entry.at).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-semibold border ${
                          entry.action.includes('FAIL') ||
                          entry.action.includes('LOCK') ||
                          entry.action.includes('BLOCK') ||
                          entry.action.includes('RESET')
                            ? 'bg-[var(--rds)] text-[var(--rdt)] border-[var(--rd)]/30'
                            : 'bg-[var(--sf-2)] text-[var(--tx)] border-[var(--bd)]'
                        }`}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 font-mono text-[11px] text-[var(--tx)] whitespace-nowrap">
                      {entry.target || '—'}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono text-[11px] text-[var(--mu)] whitespace-nowrap">
                      {entry.ip}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono text-[11px] text-[var(--mu)] max-w-md truncate">
                      {JSON.stringify(entry.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
