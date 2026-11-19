import React, { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  Code2,
  Cloud,
  Database,
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  CheckCircle2,
  Tags,
} from 'lucide-react';
import type { RawApiResponse } from '../../types/cricket';
import { formatDisplayLabel } from '../../services/strategy/formatFilter';
import {
  fetchAdminOddsDiagnostics,
  fetchAdminDbStatus,
  fetchAdminRawTopMatches,
  AdminOddsDiagnosticsResponse,
  AdminDbStatusResponse,
  AdminSessionExpiredError,
} from '../../services/adminApi';
import { ApiInspectorModal } from '../ApiInspectorModal';
import { OnlineScriptModal } from '../OnlineScriptModal';

interface AdminDiagnosticsSectionProps {
  onSessionExpired: (msg?: string) => void;
}

export const AdminDiagnosticsSection: React.FC<AdminDiagnosticsSectionProps> = ({
  onSessionExpired,
}) => {
  const [oddsDiag, setOddsDiag] = useState<AdminOddsDiagnosticsResponse | null>(null);
  const [dbStatus, setDbStatus] = useState<AdminDbStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  // Admin-only API Raw Inspector & Online Scripts modals
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [rawData, setRawData] = useState<RawApiResponse | null>(null);
  const [rawCc, setRawCc] = useState('IN');
  const [rawLatencyMs, setRawLatencyMs] = useState(0);
  const [rawFetching, setRawFetching] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [oddsRes, dbRes] = await Promise.all([
        fetchAdminOddsDiagnostics(),
        fetchAdminDbStatus(),
      ]);
      setOddsDiag(oddsRes);
      setDbStatus(dbRes);
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) {
        onSessionExpired(err.message);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load diagnostics');
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleFetchRawTopMatches = useCallback(
    async (cc: string, forceRefresh = true) => {
      setRawFetching(true);
      try {
        const res = await fetchAdminRawTopMatches(cc, forceRefresh);
        setRawCc(res.cc);
        setRawData(res.matches);
        setRawLatencyMs(res.latencyMs);
      } catch (err: unknown) {
        if (err instanceof AdminSessionExpiredError) {
          setInspectorOpen(false);
          onSessionExpired(err.message);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to fetch raw payload');
      } finally {
        setRawFetching(false);
      }
    },
    [onSessionExpired]
  );

  const handleOpenInspector = () => {
    setInspectorOpen(true);
    if (!rawData) {
      void handleFetchRawTopMatches(rawCc, false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[var(--tx)]">Diagnostics &amp; Developer Tools</h2>
          <p className="text-xs text-[var(--mu)]">
            Admin-only live odds cache inspector, API Raw Inspector, Online Scripts, and PostgreSQL status.
          </p>
        </div>
        <button
          type="button"
          onClick={loadAll}
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

      {/* Inspector & Script Launchers (Moved out of public Settings) */}
      <section
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-3"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <div>
          <h3 className="text-sm font-bold text-[var(--tx)]">API Tools (Admin Only)</h3>
          <p className="text-xs text-[var(--mu)] mt-0.5">
            Inspect raw Crex payloads via <code className="font-mono">/api/admin/diagnostics/raw-top-matches</code> (strict country code validation, fixed upstream host) or copy standalone runner scripts.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleOpenInspector}
            className="min-h-[44px] flex items-center justify-between p-3.5 rounded-xl bg-[var(--sf-2)] hover:bg-[var(--rds)] border border-[var(--bd)] text-left transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Code2 className="w-4 h-4 text-[var(--rdt)] shrink-0" strokeWidth={1.8} />
              <div>
                <div className="text-xs font-semibold text-[var(--tx)]">API Raw Inspector</div>
                <div className="text-[11px] text-[var(--mu)]">Inspect &amp; export live match JSON</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-[var(--mu)] shrink-0" strokeWidth={1.8} />
          </button>

          <button
            type="button"
            onClick={() => setScriptsOpen(true)}
            className="min-h-[44px] flex items-center justify-between p-3.5 rounded-xl bg-[var(--sf-2)] hover:bg-[var(--blu)] border border-[var(--bd)] text-left transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Cloud className="w-4 h-4 text-[var(--blut)] shrink-0" strokeWidth={1.8} />
              <div>
                <div className="text-xs font-semibold text-[var(--tx)]">Online Scripts</div>
                <div className="text-[11px] text-[var(--mu)]">Worker, Python, Node, GitHub, cURL</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-[var(--mu)] shrink-0" strokeWidth={1.8} />
          </button>
        </div>
      </section>

      {/* Tracked Match Format Detection & UNKNOWN Matches */}
      <section
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-4"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Tags className="w-4 h-4 text-[var(--rdt)]" strokeWidth={1.8} />
            <div>
              <h3 className="text-sm font-bold text-[var(--tx)]">Tracked Match Format Detection</h3>
              <p className="text-[11px] text-[var(--mu)]">
                Exact <code className="font-mono">raw.fo</code> and <code className="font-mono">raw.t</code> values normalized by the server. Strategy evaluates:{' '}
                <strong className="text-[var(--tx)]">
                  {oddsDiag?.strategyAllowedFormats?.length
                    ? oddsDiag.strategyAllowedFormats.map(formatDisplayLabel).join(', ')
                    : 'None'}
                </strong>
                .
              </p>
            </div>
          </div>
          {oddsDiag && (
            <span
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
                (oddsDiag.unknownFormatMatches?.length ?? 0) > 0
                  ? 'bg-[var(--rds)] text-[var(--rdt)] border-[var(--rd)]/30'
                  : 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border-[var(--ok-bd)]'
              }`}
            >
              {oddsDiag.unknownFormatMatches?.length ?? 0} UNKNOWN
            </span>
          )}
        </div>

        {/* UNKNOWN Format Matches View */}
        {oddsDiag && (
          oddsDiag.unknownFormatMatches && oddsDiag.unknownFormatMatches.length > 0 ? (
            <div className="p-3.5 rounded-xl bg-[var(--rds)] border border-[var(--rd)]/30 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[var(--rdt)]">
                <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.8} />
                <span>
                  UNKNOWN Format Matches ({oddsDiag.unknownFormatMatches.length}) — Skipped by Strategy Engine
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--rd)]/20 text-[11px] text-[var(--rdt)]">
                      <th className="py-1.5 pr-3 font-semibold">Match</th>
                      <th className="py-1.5 pr-3 font-semibold">Series</th>
                      <th className="py-1.5 pr-3 font-semibold">raw.fo</th>
                      <th className="py-1.5 font-semibold">raw.t</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--rd)]/15 font-mono text-[11px]">
                    {oddsDiag.unknownFormatMatches.map((u) => (
                      <tr key={u.matchId}>
                        <td className="py-1.5 pr-3 font-sans font-semibold text-[var(--tx)]">
                          {u.title} <span className="font-mono text-[10px] text-[var(--mu)]">[{u.matchId}]</span>
                        </td>
                        <td className="py-1.5 pr-3 font-sans text-[var(--mu)]">{u.seriesName}</td>
                        <td className="py-1.5 pr-3 text-[var(--rdt)]">
                          {u.rawFo === undefined ? 'undefined' : JSON.stringify(u.rawFo)}
                        </td>
                        <td className="py-1.5 text-[var(--rdt)]">
                          {u.rawT === undefined ? 'undefined' : JSON.stringify(u.rawT)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-[var(--ok-bg)] border border-[var(--ok-bd)] text-[var(--ok-tx)] text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" strokeWidth={1.8} />
              <span>0 UNKNOWN format matches currently tracked. All tracked matches classified cleanly.</span>
            </div>
          )
        )}

        {/* Per-match Format Table */}
        {oddsDiag && oddsDiag.items.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-[var(--bd)]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--bd)] bg-[var(--sf-2)] text-[11px] text-[var(--mu)]">
                  <th className="py-2 px-3 font-semibold whitespace-nowrap">Match</th>
                  <th className="py-2 px-3 font-semibold whitespace-nowrap">Status</th>
                  <th className="py-2 px-3 font-semibold whitespace-nowrap">raw.fo</th>
                  <th className="py-2 px-3 font-semibold whitespace-nowrap">raw.t</th>
                  <th className="py-2 px-3 font-semibold whitespace-nowrap">Detected Format</th>
                  <th className="py-2 px-3 font-semibold whitespace-nowrap">Strategy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {oddsDiag.items.map((item) => (
                  <tr key={`fmt-${item.matchId}`} className="hover:bg-[var(--sf-2)]/60">
                    <td className="py-2 px-3">
                      <div className="font-semibold text-[var(--tx)]">{item.title}</div>
                      <div className="text-[10px] text-[var(--mu)] truncate max-w-[220px]">
                        {item.seriesName} · <span className="font-mono">{item.matchId}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px] uppercase text-[var(--mu)]">
                      {item.matchStatus}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px] text-[var(--tx)]">
                      {item.rawFo === undefined ? 'undefined' : JSON.stringify(item.rawFo)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px] text-[var(--mu)]">
                      {item.rawT === undefined ? 'undefined' : JSON.stringify(item.rawT)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold border ${
                          item.detectedFormat === 'UNKNOWN'
                            ? 'bg-[var(--rds)] text-[var(--rdt)] border-[var(--rd)]/30'
                            : 'bg-[var(--sf-2)] text-[var(--tx)] border-[var(--bd)]'
                        }`}
                      >
                        {item.detectedFormat}
                      </span>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {item.strategyFormatAllowed ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)]">
                          Evaluated
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[var(--warn-bg)] text-[var(--warn-tx)] border border-[var(--warn-bd)]">
                          Skipped (format)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 text-center text-xs text-[var(--mu)] border border-dashed border-[var(--bd)] rounded-xl">
            No tracked matches in server memory yet.
          </div>
        )}
      </section>

      {/* Live Odds Diagnostics (Server-backed replacement for OddsDiagnosticModal) */}
      <section
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-3"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[var(--rdt)]" strokeWidth={1.8} />
            <h3 className="text-sm font-bold text-[var(--tx)]">Live Odds Cache Diagnostics</h3>
          </div>
          {oddsDiag && (
            <span className="text-[11px] font-mono tabular-nums text-[var(--mu)]">
              {oddsDiag.cachedOddsCount} / {oddsDiag.totalMatches} matches cached
            </span>
          )}
        </div>

        {oddsDiag && oddsDiag.items.length > 0 ? (
          <div className="space-y-2">
            {oddsDiag.items.map((item) => {
              const isExpanded = expandedMatchId === item.matchId;
              return (
                <div
                  key={item.matchId}
                  className="rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedMatchId(isExpanded ? null : item.matchId)}
                    className="w-full min-h-[44px] p-3 flex flex-wrap items-center justify-between gap-2 text-left hover:bg-[var(--sf)]/60 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-[var(--tx)]">{item.title}</span>
                        <span className="text-[10px] font-mono text-[var(--mu)]">{item.matchId}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[var(--sf)] text-[var(--tx)] border border-[var(--bd)]">
                          {item.detectedFormat}
                        </span>
                        {!item.strategyFormatAllowed && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--warn-bg)] text-[var(--warn-tx)] border border-[var(--warn-bd)]">
                            Skipped (format)
                          </span>
                        )}
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                            item.oddsStatus === 'READY'
                              ? 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border-[var(--ok-bd)]'
                              : item.oddsStatus === 'ERROR'
                              ? 'bg-[var(--rds)] text-[var(--rdt)] border-[var(--rd)]/30'
                              : 'bg-[var(--sf)] text-[var(--mu)] border-[var(--bd)]'
                          }`}
                        >
                          {item.oddsStatus}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--mu)] mt-0.5 tabular-nums flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>
                          Odds: {item.favTeam || '—'} B:{item.backRate ?? '—'} / L:{item.layRate ?? '—'}
                        </span>
                        <span>raw.F: {item.rawF || '—'}</span>
                        <span>
                          Age: {item.cacheAgeMs !== null ? `${Math.round(item.cacheAgeMs / 1000)}s` : 'none'}
                        </span>
                        <span>Misses: {item.consecutiveMisses}</span>
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-[var(--mu)] shrink-0" strokeWidth={1.8} />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[var(--mu)] shrink-0" strokeWidth={1.8} />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 border-t border-[var(--bd)] space-y-2">
                      {item.errorMessage && (
                        <div className="text-[11px] text-[var(--rdt)] font-mono">
                          Error: {item.errorMessage}
                        </div>
                      )}
                      <pre
                        className="p-3 rounded-xl text-[11px] font-mono overflow-x-auto max-h-60 leading-relaxed"
                        style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-tx)' }}
                      >
                        {item.rawSnapshot
                          ? JSON.stringify(item.rawSnapshot, null, 2)
                          : '// No cached getSV3 odds snapshot for this match yet.'}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-6 text-center text-xs text-[var(--mu)] border border-dashed border-[var(--bd)] rounded-xl">
            No matches currently in live server memory.
          </div>
        )}
      </section>

      {/* PostgreSQL Status */}
      <section
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-3"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[var(--blut)]" strokeWidth={1.8} />
            <h3 className="text-sm font-bold text-[var(--tx)]">PostgreSQL Diagnostics</h3>
          </div>
          {dbStatus && (
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                dbStatus.connected
                  ? 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border-[var(--ok-bd)]'
                  : 'bg-[var(--rds)] text-[var(--rdt)] border-[var(--rd)]/30'
              }`}
            >
              {dbStatus.connected ? 'Connected' : 'Disconnected'}
            </span>
          )}
        </div>

        {dbStatus && (
          <div className="space-y-2 text-xs">
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] font-mono text-[11px] break-all text-[var(--tx)]">
              {dbStatus.url}
            </div>
            {dbStatus.connected ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 tabular-nums">
                <div className="p-2.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
                  <div className="text-[11px] text-[var(--mu)]">Matches</div>
                  <div className="font-bold text-[var(--tx)]">{dbStatus.matchesCount ?? 0}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
                  <div className="text-[11px] text-[var(--mu)]">Teams</div>
                  <div className="font-bold text-[var(--tx)]">{dbStatus.teamsCount ?? 0}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
                  <div className="text-[11px] text-[var(--mu)]">Positions</div>
                  <div className="font-bold text-[var(--tx)]">{dbStatus.positionsCount ?? 0}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
                  <div className="text-[11px] text-[var(--mu)]">Trades</div>
                  <div className="font-bold text-[var(--tx)]">{dbStatus.tradesCount ?? 0}</div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-[var(--rdt)]">{dbStatus.error}</div>
            )}

            {/* Saved Strategy Data by Format (Read-Only, zero deletions) */}
            {oddsDiag && oddsDiag.savedStrategyByFormat && oddsDiag.savedStrategyByFormat.length > 0 && (
              <div className="pt-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-[var(--tx)]">
                    Saved Strategy Records by Format (Read-Only)
                  </div>
                  <span className="text-[10px] text-[var(--mu)]">
                    Historical non-T10/T20 rows are preserved, never deleted
                  </span>
                </div>
                <div className="overflow-x-auto rounded-xl border border-[var(--bd)]">
                  <table className="w-full text-left border-collapse text-xs tabular-nums">
                    <thead>
                      <tr className="border-b border-[var(--bd)] bg-[var(--sf-2)] text-[11px] text-[var(--mu)]">
                        <th className="py-2 px-3 font-semibold">Saved Format</th>
                        <th className="py-2 px-3 font-semibold">Detected</th>
                        <th className="py-2 px-3 font-semibold">Signals</th>
                        <th className="py-2 px-3 font-semibold">Trades</th>
                        <th className="py-2 px-3 font-semibold">Positions</th>
                        <th className="py-2 px-3 font-semibold">States</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--bd)]">
                      {oddsDiag.savedStrategyByFormat.map((row) => (
                        <tr key={`${row.format}-${row.detectedFormat}`}>
                          <td className="py-2 px-3 font-mono text-[11px] text-[var(--tx)]">
                            {row.format}
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] font-semibold text-[var(--tx)]">
                            {row.detectedFormat}
                          </td>
                          <td className="py-2 px-3 font-mono">{row.signals}</td>
                          <td className="py-2 px-3 font-mono">{row.trades}</td>
                          <td className="py-2 px-3 font-mono">{row.positions}</td>
                          <td className="py-2 px-3 font-mono">{row.states}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <ApiInspectorModal
        isOpen={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        initialPayload={`{"cc":"${rawCc}"}`}
        rawData={rawData}
        onPayloadSend={(cc) => handleFetchRawTopMatches(cc, true)}
        isFetching={rawFetching}
        latencyMs={rawLatencyMs}
      />

      <OnlineScriptModal
        isOpen={scriptsOpen}
        onClose={() => setScriptsOpen(false)}
        countryCode={rawCc}
      />
    </div>
  );
};
