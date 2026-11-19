import React, { useState } from 'react';
import {
  X,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Clock,
  Radio,
  FileCode,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { ParsedCricketMatch } from '../types/cricket';
import { MatchOddsState } from '../types/odds';
import { useModalFocusTrap } from './useModalFocusTrap';

interface OddsDiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
  matches: ParsedCricketMatch[];
  oddsByMatchId: Record<string, MatchOddsState>;
  onRefreshAll: () => Promise<void>;
  onRefreshMatch: (matchId: string) => Promise<void>;
  isRefreshing: boolean;
  totalRecordsReceived: number;
}

export const OddsDiagnosticModal: React.FC<OddsDiagnosticModalProps> = ({
  isOpen,
  onClose,
  matches,
  oddsByMatchId,
  onRefreshAll,
  onRefreshMatch,
  isRefreshing,
  totalRecordsReceived,
}) => {
  const [unmaskKeys, setUnmaskKeys] = useState(false);
  const [inspectedOddsKey, setInspectedOddsKey] = useState<string | null>(null);
  const [isolationTestResult, setIsolationTestResult] = useState<{
    ran: boolean;
    pass: boolean;
    details: string[];
  } | null>(null);

  const dialogRef = useModalFocusTrap(isOpen, onClose);

  if (!isOpen) return null;

  const totalMatches = matches.length;
  const verifiedCount = Object.values(oddsByMatchId).filter(
    (s) => s.consistency.status === 'verified'
  ).length;
  const errorCount = Object.values(oddsByMatchId).filter(
    (s) => s.status === 'error' || s.consistency.status === 'mismatch'
  ).length;

  const runIsolationTest = () => {
    const details: string[] = [];
    let pass = true;

    if (matches.length < 2) {
      setIsolationTestResult({
        ran: true,
        pass: false,
        details: ['Need at least 2 matches to verify isolation.'],
      });
      return;
    }

    const m1 = matches[0];
    const m2 = matches[1];
    const o1 = oddsByMatchId[m1.id];
    const o2 = oddsByMatchId[m2.id];

    details.push(`Match 1: "${m1.team1.shortName} vs ${m1.team2.shortName}" [ID: ${m1.id}]`);
    details.push(`Match 2: "${m2.team1.shortName} vs ${m2.team2.shortName}" [ID: ${m2.id}]`);

    if (m1.id === m2.id) {
      pass = false;
      details.push('Error: Both matches have identical IDs.');
    } else {
      details.push(`Key Differentiation: Match 1 Key ("${m1.id}") !== Match 2 Key ("${m2.id}")`);
    }

    if (o1 && o2) {
      if (o1.matchId !== m1.id || o2.matchId !== m2.id) {
        pass = false;
        details.push('Error: Odds state matchId does not align with match.');
      } else {
        details.push('State Separation: Each match maintains its own isolated odds state.');
      }

      const dt1 = o1.odds?.dtId;
      const dt2 = o2.odds?.dtId;
      if (dt1 && dt2 && dt1 === dt2 && m1.id !== m2.id) {
        pass = false;
        details.push(`Warning: Both matches return the same discrete tournament ID ("${dt1}").`);
      } else if (dt1 && dt2) {
        details.push(`Distinct Match Identifiers: dt_id 1 (${dt1}) !== dt_id 2 (${dt2})`);
      }

      if (o1.odds?.bookmaker && o2.odds?.bookmaker) {
        details.push(
          `Independent Rates: Match 1 rate="${o1.odds.bookmaker.rawRateString || 'None'}", Match 2 rate="${o2.odds.bookmaker.rawRateString || 'None'}"`
        );
      }
    } else {
      details.push('Waiting for odds to finish loading for both matches...');
    }

    setIsolationTestResult({ ran: true, pass, details });
  };

  return (
    <div
      className="fixed inset-0 z-50 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      style={{ backgroundColor: 'var(--overlay)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bg-[var(--sf)] border border-[var(--bd)] rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="odds-diagnostic-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[var(--bd)] flex items-center justify-between bg-[var(--sf)] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] flex items-center justify-center text-[var(--tx)] shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="odds-diagnostic-title" className="text-base font-bold text-[var(--tx)]">
                  Odds Integration Diagnostics
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[var(--warn-bg)] text-[var(--warn-tx)] border border-[var(--warn-bd)] uppercase tracking-wider">
                  Dev Only
                </span>
              </div>
              <p className="text-xs text-[var(--mu)] mt-0.5 truncate">
                Real-time verification of per-match odds keys, state separation, and consistency.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRefreshAll}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--tx)] bg-[var(--sf-2)] hover:bg-[var(--rds)] border border-[var(--bd)] rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[var(--rdt)]' : ''}`} />
              <span className="hidden sm:inline">Refresh All</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Diagnostics"
              className="p-2 text-[var(--mu)] hover:text-[var(--tx)] rounded-lg hover:bg-[var(--sf-2)] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Diagnostic Metrics Row */}
        <div className="p-4 border-b border-[var(--bd)] bg-[var(--sf-2)] grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0 tabular-nums">
          <div className="p-3 rounded-xl bg-[var(--sf)] border border-[var(--bd)]">
            <div className="text-[11px] font-medium text-[var(--mu)]">Matches Monitored</div>
            <div className="text-lg font-bold text-[var(--tx)] mt-1">{totalMatches}</div>
          </div>
          <div className="p-3 rounded-xl bg-[var(--sf)] border border-[var(--bd)]">
            <div className="text-[11px] font-medium text-[var(--mu)]">Verified Mappings</div>
            <div className="text-lg font-bold text-[var(--ok-tx)] mt-1">
              {verifiedCount} / {totalMatches}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[var(--sf)] border border-[var(--bd)]">
            <div className="text-[11px] font-medium text-[var(--mu)]">Total Updates Received</div>
            <div className="text-lg font-bold text-[var(--blut)] mt-1">
              {totalRecordsReceived}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[var(--sf)] border border-[var(--bd)]">
            <div className="text-[11px] font-medium text-[var(--mu)]">Mismatches / Errors</div>
            <div
              className={`text-lg font-bold mt-1 ${
                errorCount > 0 ? 'text-[var(--rdt)]' : 'text-[var(--mu)]'
              }`}
            >
              {errorCount}
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-4 py-2.5 bg-[var(--sf)] border-b border-[var(--bd)] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUnmaskKeys(!unmaskKeys)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[var(--tx)] bg-[var(--sf-2)] hover:bg-[var(--rds)] border border-[var(--bd)] rounded-lg transition-colors"
            >
              {unmaskKeys ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{unmaskKeys ? 'Mask Keys' : 'Unmask Keys'}</span>
            </button>
            <button
              type="button"
              onClick={runIsolationTest}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-[var(--ok-tx)] bg-[var(--ok-bg)] border border-[var(--ok-bd)] rounded-lg transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Run 2-Match Isolation Test</span>
            </button>
          </div>
          <div className="text-[11px] text-[var(--ok-tx)] flex items-center gap-1.5 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok-tx)] animate-pulse" />
            <span>Independent polling per match</span>
          </div>
        </div>

        {/* In-App Isolation Test Result Banner */}
        {isolationTestResult && (
          <div
            className={`p-3.5 border-b text-xs flex flex-col gap-1.5 ${
              isolationTestResult.pass
                ? 'bg-[var(--ok-bg)] border-[var(--ok-bd)] text-[var(--ok-tx)]'
                : 'bg-[var(--rds)] border-[var(--rd)]/30 text-[var(--rdt)]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold flex items-center gap-1.5">
                {isolationTestResult.pass ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
                Multi-Match Isolation Test Result: {isolationTestResult.pass ? 'PASSED' : 'CHECK NEEDED'}
              </span>
              <button
                type="button"
                onClick={() => setIsolationTestResult(null)}
                className="text-[11px] text-[var(--mu)] hover:text-[var(--tx)]"
              >
                Dismiss
              </button>
            </div>
            <div className="space-y-0.5 font-mono text-[11px] pl-5">
              {isolationTestResult.details.map((d, i) => (
                <div key={i}>{d}</div>
              ))}
            </div>
          </div>
        )}

        {/* Matches Diagnostic Table */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {matches.map((match) => {
            const state = oddsByMatchId[match.id];
            const isMatchInspected = inspectedOddsKey === match.id;
            const displayedKey = unmaskKeys ? match.id : state?.maskedKey || '****';

            return (
              <div
                key={match.id}
                className="p-4 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] flex flex-col gap-3"
              >
                {/* Match Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[var(--bd)]">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[var(--tx)]">
                        {match.team1.shortName} vs {match.team2.shortName}
                      </span>
                      <span className="text-xs text-[var(--mu)]">({match.format})</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--sf)] text-[var(--tx)] border border-[var(--bd)]">
                        {match.seriesName}
                      </span>
                      {match.status === 'live' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--rdt)] bg-[var(--rds)] rounded">
                          <Radio className="w-2.5 h-2.5 animate-pulse" />
                          Live
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--mu)] mt-0.5 flex items-center gap-3 flex-wrap">
                      <span>
                        Match ID: <code className="text-[var(--tx)] font-mono">{match.id}</code>
                      </span>
                      {match.raw?.dt_id && (
                        <span>
                          dt_id: <code className="text-[var(--tx)] font-mono">{match.raw.dt_id}</code>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    {state?.status === 'loading' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-[var(--blu)] text-[var(--blut)] border border-[var(--info-bd)]">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Fetching Odds
                      </span>
                    ) : state?.status === 'success' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)]">
                        <CheckCircle2 className="w-3 h-3" />
                        Odds Active
                      </span>
                    ) : state?.status === 'unavailable' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-[var(--sf)] text-[var(--mu)] border border-[var(--bd)]">
                        Market Suspended
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-[var(--rds)] text-[var(--rdt)] border border-[var(--rd)]/30">
                        <AlertCircle className="w-3 h-3" />
                        Failed / Unavailable
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => onRefreshMatch(match.id)}
                      className="p-1.5 text-[var(--mu)] hover:text-[var(--tx)] rounded hover:bg-[var(--sf)] transition-colors"
                      title="Force refresh this match odds"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Match Diagnostics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  <div className="p-2.5 rounded-lg bg-[var(--sf)] border border-[var(--bd)]">
                    <span className="text-[var(--mu)] block text-[11px]">Associated Odds Key</span>
                    <span className="font-mono font-bold text-[var(--warn-tx)] mt-0.5 block">
                      {displayedKey}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[var(--sf)] border border-[var(--bd)]">
                    <span className="text-[var(--mu)] block text-[11px]">Odds Records Received</span>
                    <span className="font-mono font-bold text-[var(--tx)] mt-0.5 block tabular-nums">
                      {state?.recordsCount || 0} updates
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[var(--sf)] border border-[var(--bd)]">
                    <span className="text-[var(--mu)] block text-[11px]">Last Successful Update</span>
                    <span className="font-mono text-[var(--tx)] mt-0.5 flex items-center gap-1 tabular-nums">
                      <Clock className="w-3 h-3 text-[var(--mu)]" />
                      {state?.lastUpdated ? state.lastUpdated.toLocaleTimeString() : 'Pending'}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[var(--sf)] border border-[var(--bd)]">
                    <span className="text-[var(--mu)] block text-[11px]">Mapping Consistency</span>
                    <span
                      className={`font-semibold mt-0.5 block truncate ${
                        state?.consistency.status === 'verified'
                          ? 'text-[var(--ok-tx)]'
                          : state?.consistency.status === 'mismatch'
                          ? 'text-[var(--rdt)]'
                          : 'text-[var(--warn-tx)]'
                      }`}
                    >
                      {state?.consistency.reason || 'Pending check'}
                    </span>
                  </div>
                </div>

                {/* Live Odds Strip */}
                {state?.odds?.bookmaker && (
                  <div className="p-2.5 rounded-lg bg-[var(--sf)] border border-[var(--bd)] flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--mu)]">Market Rate:</span>
                      <span className="font-mono font-bold text-[var(--tx)] bg-[var(--sf-2)] px-2 py-0.5 rounded border border-[var(--bd)]">
                        {state.odds.bookmaker.rawRateString || 'None'}
                      </span>
                      {state.odds.favoriteTeamName && (
                        <span className="text-[var(--mu)] font-medium">
                          Fav: <strong className="text-[var(--tx)]">{state.odds.favoriteTeamName}</strong>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {state.odds.bookmaker.backRate !== null && (
                        <div className="flex items-center gap-1 bg-[var(--blu)] px-2 py-0.5 rounded text-[var(--blut)] font-mono tabular-nums">
                          <span className="text-[10px] uppercase">Back</span>
                          <strong>{state.odds.bookmaker.backRate}</strong>
                          <span className="text-[10px]">({state.odds.bookmaker.decimalBack})</span>
                        </div>
                      )}
                      {state.odds.bookmaker.layRate !== null && (
                        <div className="flex items-center gap-1 bg-[var(--rds)] px-2 py-0.5 rounded text-[var(--rdt)] font-mono tabular-nums">
                          <span className="text-[10px] uppercase">Lay</span>
                          <strong>{state.odds.bookmaker.layRate}</strong>
                          <span className="text-[10px]">({state.odds.bookmaker.decimalLay})</span>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          setInspectedOddsKey(isMatchInspected ? null : match.id)
                        }
                        className="px-2 py-1 text-[11px] text-[var(--tx)] bg-[var(--sf-2)] hover:bg-[var(--rds)] border border-[var(--bd)] rounded transition-colors flex items-center gap-1 font-mono"
                      >
                        <FileCode className="w-3 h-3 text-[var(--ok-tx)]" />
                        <span>{isMatchInspected ? 'Hide JSON' : 'Inspect JSON'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {isMatchInspected && state?.odds?.raw && (
                  <div
                    className="p-3 rounded-lg border border-[var(--bd)] font-mono text-[11px] overflow-x-auto max-h-60"
                    style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-tx)' }}
                  >
                    <pre>{JSON.stringify(state.odds.raw, null, 2)}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
