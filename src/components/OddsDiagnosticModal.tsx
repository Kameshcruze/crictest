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
      details.push('❌ Error: Both matches have identical IDs.');
    } else {
      details.push(`✅ Key Differentiation: Match 1 Key ("${m1.id}") !== Match 2 Key ("${m2.id}")`);
    }

    if (o1 && o2) {
      if (o1.matchId !== m1.id || o2.matchId !== m2.id) {
        pass = false;
        details.push('❌ Error: Odds state matchId does not align with match.');
      } else {
        details.push('✅ State Separation: Each match maintains its own isolated odds state.');
      }

      const dt1 = o1.odds?.dtId;
      const dt2 = o2.odds?.dtId;
      if (dt1 && dt2 && dt1 === dt2 && m1.id !== m2.id) {
        pass = false;
        details.push(`❌ Warning: Both matches return the same discrete tournament ID ("${dt1}").`);
      } else if (dt1 && dt2) {
        details.push(`✅ Distinct Match Identifiers: dt_id 1 (${dt1}) !== dt_id 2 (${dt2})`);
      }

      if (o1.odds?.bookmaker && o2.odds?.bookmaker) {
        details.push(
          `✅ Independent Rates: Match 1 rate="${o1.odds.bookmaker.rawRateString || 'None'}", Match 2 rate="${o2.odds.bookmaker.rawRateString || 'None'}"`
        );
      }
    } else {
      details.push('ℹ️ Waiting for odds to finish loading for both matches...');
    }

    setIsolationTestResult({ ran: true, pass, details });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  Odds Integration Diagnostics (Phase 4)
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wider">
                  Dev Only
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-time verification of per-match odds keys, state separation, and consistency.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefreshAll}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
              <span>Refresh All</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Diagnostic Metrics Row */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-950/40 grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
          <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
            <div className="text-[11px] font-medium text-slate-400">Matches Monitored</div>
            <div className="text-lg font-bold text-white mt-1 font-mono-numbers">{totalMatches}</div>
          </div>
          <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
            <div className="text-[11px] font-medium text-slate-400">Verified Mappings</div>
            <div className="text-lg font-bold text-emerald-400 mt-1 font-mono-numbers">
              {verifiedCount} / {totalMatches}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
            <div className="text-[11px] font-medium text-slate-400">Total Updates Received</div>
            <div className="text-lg font-bold text-sky-400 mt-1 font-mono-numbers">
              {totalRecordsReceived}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
            <div className="text-[11px] font-medium text-slate-400">Mismatches / Errors</div>
            <div
              className={`text-lg font-bold mt-1 font-mono-numbers ${
                errorCount > 0 ? 'text-rose-400' : 'text-slate-400'
              }`}
            >
              {errorCount}
            </div>
          </div>
        </div>

        {/* Toolbar: Key Masking & Isolation Verification Button */}
        <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUnmaskKeys(!unmaskKeys)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
            >
              {unmaskKeys ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{unmaskKeys ? 'Mask Keys' : 'Unmask Keys'}</span>
            </button>
            <button
              type="button"
              onClick={runIsolationTest}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-700/60 rounded-lg transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Run 2-Match Isolation Test</span>
            </button>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-2">
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Independent polling per match
            </span>
          </div>
        </div>

        {/* In-App Isolation Test Result Banner */}
        {isolationTestResult && (
          <div
            className={`p-3.5 border-b text-xs flex flex-col gap-1.5 ${
              isolationTestResult.pass
                ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
                : 'bg-rose-950/30 border-rose-500/30 text-rose-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold flex items-center gap-1.5">
                {isolationTestResult.pass ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                )}
                Multi-Match Isolation Test Result: {isolationTestResult.pass ? 'PASSED' : 'CHECK NEEDED'}
              </span>
              <button
                type="button"
                onClick={() => setIsolationTestResult(null)}
                className="text-[11px] text-slate-400 hover:text-white"
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
                className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 transition-colors flex flex-col gap-3"
              >
                {/* Match Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800/80">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white">
                        {match.team1.shortName} vs {match.team2.shortName}
                      </span>
                      <span className="text-xs text-slate-400">({match.format})</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        {match.seriesName}
                      </span>
                      {match.status === 'live' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded">
                          <Radio className="w-2.5 h-2.5 animate-pulse" />
                          Live
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-3">
                      <span>
                        Match ID: <code className="text-slate-300 font-mono">{match.id}</code>
                      </span>
                      {match.raw?.dt_id && (
                        <span>
                          dt_id: <code className="text-slate-300 font-mono">{match.raw.dt_id}</code>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status Badges */}
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    {state?.status === 'loading' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Fetching Odds
                      </span>
                    ) : state?.status === 'success' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" />
                        Odds Active
                      </span>
                    ) : state?.status === 'unavailable' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                        Market Suspended
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                        <AlertCircle className="w-3 h-3" />
                        Failed / Unavailable
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => onRefreshMatch(match.id)}
                      className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                      title="Force refresh this match odds"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Match Diagnostics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  {/* Odds Key */}
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Associated Odds Key</span>
                    <span className="font-mono font-bold text-amber-300 mt-0.5 block">
                      {displayedKey}
                    </span>
                  </div>

                  {/* Records Received */}
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Odds Records Received</span>
                    <span className="font-mono font-bold text-slate-200 mt-0.5 block">
                      {state?.recordsCount || 0} updates
                    </span>
                  </div>

                  {/* Last Update */}
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Last Successful Update</span>
                    <span className="font-mono text-slate-200 mt-0.5 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {state?.lastUpdated ? state.lastUpdated.toLocaleTimeString() : 'Pending'}
                    </span>
                  </div>

                  {/* Consistency Status */}
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Mapping Consistency</span>
                    <span
                      className={`font-semibold mt-0.5 block truncate ${
                        state?.consistency.status === 'verified'
                          ? 'text-emerald-400'
                          : state?.consistency.status === 'mismatch'
                          ? 'text-rose-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {state?.consistency.reason || 'Pending check'}
                    </span>
                  </div>
                </div>

                {/* Live Odds Strip (if rates exist) */}
                {state?.odds?.bookmaker && (
                  <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">Market Rate:</span>
                      <span className="font-mono font-bold text-white bg-slate-800 px-2 py-0.5 rounded">
                        {state.odds.bookmaker.rawRateString || 'None'}
                      </span>
                      {state.odds.favoriteTeamName && (
                        <span className="text-slate-300 font-medium">
                          Fav: <strong className="text-amber-300">{state.odds.favoriteTeamName}</strong>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {state.odds.bookmaker.backRate !== null && (
                        <div className="flex items-center gap-1 bg-sky-950/60 border border-sky-600/40 px-2 py-0.5 rounded text-sky-200 font-mono">
                          <span className="text-[10px] uppercase text-sky-400">Back</span>
                          <strong>{state.odds.bookmaker.backRate}</strong>
                          <span className="text-[10px] text-sky-400">({state.odds.bookmaker.decimalBack})</span>
                        </div>
                      )}
                      {state.odds.bookmaker.layRate !== null && (
                        <div className="flex items-center gap-1 bg-rose-950/60 border border-rose-600/40 px-2 py-0.5 rounded text-rose-200 font-mono">
                          <span className="text-[10px] uppercase text-rose-400">Lay</span>
                          <strong>{state.odds.bookmaker.layRate}</strong>
                          <span className="text-[10px] text-rose-400">({state.odds.bookmaker.decimalLay})</span>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          setInspectedOddsKey(isMatchInspected ? null : match.id)
                        }
                        className="px-2 py-1 text-[11px] text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors flex items-center gap-1 font-mono"
                      >
                        <FileCode className="w-3 h-3 text-emerald-400" />
                        <span>{isMatchInspected ? 'Hide JSON' : 'Inspect JSON'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Collapsible Raw JSON Viewer */}
                {isMatchInspected && state?.odds?.raw && (
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-60">
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
