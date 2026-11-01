import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Activity,
  ShieldAlert,
  ShieldCheck,
  Target,
  Zap,
  BarChart2,
  Calendar,
  Layers,
  Sparkles,
  ChevronRight,
  Info,
  Check,
  X,
  PlayCircle,
  RotateCcw,
} from 'lucide-react';
import { ParsedCricketMatch } from '../types/cricket';
import { MatchOddsState, OddsTick } from '../types/odds';
import {
  strategyEngine,
  StrategySignal,
  calculateOpposingOdds,
  DEFAULT_STRATEGY_CONFIG,
} from '../services/strategy';

interface MatchAnalysisPageProps {
  matchId: string;
  match?: ParsedCricketMatch;
  oddsState?: MatchOddsState;
  allMatches?: ParsedCricketMatch[];
  onBack: () => void;
  onSelectMatch: (matchId: string) => void;
  onRefreshOdds?: (matchId: string) => Promise<void>;
}

export const MatchAnalysisPage: React.FC<MatchAnalysisPageProps> = ({
  matchId,
  match,
  oddsState,
  allMatches = [],
  onBack,
  onSelectMatch,
  onRefreshOdds,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [freshnessSec, setFreshnessSec] = useState<number>(0);
  const [evaluationTick, setEvaluationTick] = useState<number>(0);
  const [signalFilter, setSignalFilter] = useState<'all' | 'candidates' | 'rejected' | 'events'>('all');

  const isLive = match?.status === 'live';
  const isCompleted = match?.status === 'completed';
  const isUpcoming = match?.status === 'upcoming';

  // Live seconds elapsed counter since last odds update
  useEffect(() => {
    const updateElapsed = () => {
      if (oddsState?.lastUpdated) {
        const elapsed = Math.floor((Date.now() - new Date(oddsState.lastUpdated).getTime()) / 1000);
        setFreshnessSec(Math.max(0, elapsed));
      } else {
        setFreshnessSec(0);
      }
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [oddsState?.lastUpdated]);

  // Requirement 1 & 2: Automatic independent odds polling for the active match
  // Polls every 3s for live matches (respecting API rate limits), 10s for other matches
  useEffect(() => {
    if (!onRefreshOdds || !matchId) return;

    // Initial fetch if odds are not yet loaded
    if (!oddsState?.odds && oddsState?.status !== 'loading' && oddsState?.status !== 'error') {
      onRefreshOdds(matchId).catch(() => {});
    }

    const intervalMs = isLive ? 3000 : 10000;
    const timer = setInterval(() => {
      onRefreshOdds(matchId).catch(() => {});
    }, intervalMs);

    return () => clearInterval(timer);
  }, [matchId, isLive, onRefreshOdds, oddsState?.odds, oddsState?.status]);

  const handleManualRefresh = async () => {
    if (!onRefreshOdds || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefreshOdds(matchId);
    } finally {
      setIsRefreshing(false);
    }
  };

  const bookmaker = oddsState?.odds?.bookmaker;
  const movement = oddsState?.movement;
  const history = oddsState?.history || [];
  const sessions = oddsState?.odds?.sessions || [];

  // Match details resolution
  const team1 = match?.team1;
  const team2 = match?.team2;
  const t1Score = match?.team1Score;
  const t2Score = match?.team2Score;
  const activeScore = t2Score || t1Score;

  // Requirement 4 & 11: Error and Diagnostic State Flags
  const isMissingKey = !matchId || matchId.trim() === '' || !oddsState?.oddsKey;
  const isFailedRequest = oddsState?.status === 'error';
  const isStaleOdds = isLive && freshnessSec > 15;
  const isInvalidResponse = Boolean(oddsState?.odds && (bookmaker?.isSuspended || bookmaker?.decimalBack === null));
  const isMatchEventsUnavailable = !activeScore || (activeScore.overs === 0 && activeScore.wickets === 0 && activeScore.runs === 0);

  // Format start time
  const formatStartTime = (date?: Date) => {
    if (!date) return 'Scheduled';
    try {
      const isToday = new Date().toDateString() === date.toDateString();
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) return `Today at ${timeStr}`;
      return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
    } catch {
      return 'Scheduled';
    }
  };

  // Freshness badge coloring
  const getFreshnessColor = () => {
    if (!oddsState?.lastUpdated) return 'text-slate-400 bg-slate-800 border-slate-700';
    if (freshnessSec <= 4) return 'text-emerald-400 bg-emerald-950/60 border-emerald-500/40';
    if (freshnessSec <= 15) return 'text-amber-400 bg-amber-950/60 border-amber-500/40';
    return 'text-rose-400 bg-rose-950/60 border-rose-500/40 animate-pulse';
  };

  // =========================================================================
  // STRATEGY ENGINE INTEGRATION (Strict separation: UI only reads engine outputs)
  // =========================================================================
  const strategyState = useMemo(() => {
    return strategyEngine.getState(matchId);
  }, [matchId, evaluationTick]);

  // Evaluate strategy rules whenever match or odds change
  useEffect(() => {
    if (!match || !oddsState) return;
    const isStale = isLive && freshnessSec > 15;
    strategyEngine.evaluateMatch(match, oddsState, undefined, { isStale });
    setEvaluationTick((prev) => prev + 1);
  }, [
    match?.id,
    match?.team1Score?.runs,
    match?.team1Score?.wickets,
    match?.team1Score?.overs,
    match?.team2Score?.runs,
    match?.team2Score?.wickets,
    match?.team2Score?.overs,
    oddsState?.odds?.bookmaker?.decimalBack,
    oddsState?.odds?.bookmaker?.decimalLay,
    oddsState?.lastUpdated,
    freshnessSec > 15,
  ]);

  // Extract latest signal outputs for each rule
  const signals = strategyState.signalsHistory;
  const firstEntrySignal = signals.find((s) => s.signalType === 'FIRST_ENTRY_CANDIDATE');
  const firstBooksetSignal = signals.find((s) => s.signalType === 'FIRST_BOOKSET_TARGET');
  const secondEntrySignal = signals.find((s) => s.signalType === 'SECOND_ENTRY_CANDIDATE');
  const secondBooksetSignal = signals.find((s) => s.signalType === 'SECOND_BOOKSET_TARGET');
  const abnormalSignal = signals.find(
    (s) => s.signalType === 'ABNORMAL_ACTIVITY_FOUR' || s.signalType === 'ABNORMAL_ACTIVITY_SIX'
  );

  // Filtered signals for the Section C signals stream
  const filteredSignals = useMemo(() => {
    switch (signalFilter) {
      case 'candidates':
        return signals.filter(
          (s) =>
            (s.signalType === 'FIRST_ENTRY_CANDIDATE' ||
              s.signalType === 'SECOND_ENTRY_CANDIDATE' ||
              s.signalType === 'FIRST_BOOKSET_TARGET' ||
              s.signalType === 'SECOND_BOOKSET_TARGET') &&
            s.status === 'PASS'
        );
      case 'rejected':
        return signals.filter((s) => s.status === 'FAIL' || s.status === 'DATA UNAVAILABLE');
      case 'events':
        return signals.filter(
          (s) =>
            s.signalType === 'WICKET_EVENT' ||
            s.signalType === 'ABNORMAL_ACTIVITY_FOUR' ||
            s.signalType === 'ABNORMAL_ACTIVITY_SIX'
        );
      default:
        return signals;
    }
  }, [signals, signalFilter]);

  const candidatesCount = useMemo(
    () =>
      signals.filter(
        (s) =>
          (s.signalType === 'FIRST_ENTRY_CANDIDATE' ||
            s.signalType === 'SECOND_ENTRY_CANDIDATE' ||
            s.signalType === 'FIRST_BOOKSET_TARGET' ||
            s.signalType === 'SECOND_BOOKSET_TARGET') &&
          s.status === 'PASS'
      ).length,
    [signals]
  );

  const rejectedCount = useMemo(
    () => signals.filter((s) => s.status === 'FAIL' || s.status === 'DATA UNAVAILABLE').length,
    [signals]
  );

  const eventsCount = useMemo(
    () =>
      signals.filter(
        (s) =>
          s.signalType === 'WICKET_EVENT' ||
          s.signalType === 'ABNORMAL_ACTIVITY_FOUR' ||
          s.signalType === 'ABNORMAL_ACTIVITY_SIX'
      ).length,
    [signals]
  );

  // Opposing odds derived value
  const opposingOdds = useMemo(() => {
    return calculateOpposingOdds(bookmaker?.decimalBack);
  }, [bookmaker?.decimalBack]);

  // Position management actions (Manual/Simulated trade recording)
  const handleRecordFirstEntry = () => {
    if (!bookmaker?.decimalBack || !match) return;
    const currentInnings = match.team2Score ? 2 : 1;
    const currentOver = activeScore ? activeScore.overs : 0;
    const currentWickets = activeScore ? activeScore.wickets : 0;
    strategyEngine.recordEntry(
      matchId,
      'FIRST_ENTRY',
      bookmaker.decimalBack,
      currentInnings,
      currentOver,
      currentWickets
    );
    setEvaluationTick((prev) => prev + 1);
  };

  const handleRecordFirstExit = () => {
    if (!bookmaker?.decimalLay || !match) return;
    const currentOver = activeScore ? activeScore.overs : 0;
    strategyEngine.recordExit(matchId, 'FIRST_ENTRY', bookmaker.decimalLay, currentOver);
    setEvaluationTick((prev) => prev + 1);
  };

  const handleRecordSecondEntry = () => {
    if (!opposingOdds || !match) return;
    const currentInnings = match.team2Score ? 2 : 1;
    const currentOver = activeScore ? activeScore.overs : 0;
    const currentWickets = activeScore ? activeScore.wickets : 0;
    strategyEngine.recordEntry(
      matchId,
      'SECOND_ENTRY',
      opposingOdds,
      currentInnings,
      currentOver,
      currentWickets
    );
    setEvaluationTick((prev) => prev + 1);
  };

  const handleResetStrategyState = () => {
    strategyEngine.resetState(matchId);
    setEvaluationTick((prev) => prev + 1);
  };

  // Quick boundary shift test dispatcher (for real-time manual testing)
  const handleTestBoundaryShift = (type: 'FOUR' | 'SIX', movementAmount: number) => {
    if (!match) return;
    const currentInnings = match.team2Score ? 2 : 1;
    const currentOver = activeScore ? activeScore.overs : 0;
    strategyEngine.evaluateAbnormalActivity({
      matchId,
      boundaryType: type,
      oddsMovement: movementAmount,
      currentInnings,
      currentOver,
      measuredTeam: oddsState?.odds?.favoriteTeamName || 'Favorite',
      decimalOdds: bookmaker?.decimalBack ?? null,
    });
    setEvaluationTick((prev) => prev + 1);
  };

  const renderStatusBadge = (status?: string) => {
    if (status === 'PASS') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/40 text-[10px] font-bold">
          <Check className="w-3 h-3" />
          PASS
        </span>
      );
    }
    if (status === 'FAIL') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950/80 text-rose-400 border border-rose-500/40 text-[10px] font-bold">
          <X className="w-3 h-3" />
          FAIL
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 text-[10px] font-bold">
        DATA UNAVAILABLE
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md px-4 sm:px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:text-white transition-all shadow-sm"
              title="Return to Dashboard"
            >
              <ArrowLeft className="w-4 h-4 text-emerald-400" />
              <span>Dashboard</span>
            </button>

            <div className="h-4 w-px bg-slate-800 hidden sm:block" />

            <div className="truncate">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  ID: {matchId}
                </span>
                <h1 className="text-sm sm:text-base font-bold text-white truncate">
                  {match ? `${match.team1.shortName} vs ${match.team2.shortName}` : `Match ${matchId}`}
                </h1>
                {isLive && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                    LIVE
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Controls: Match Switcher & Odds Refresh */}
          <div className="flex items-center gap-2 shrink-0">
            {allMatches.length > 1 && (
              <select
                aria-label="Switch active match"
                value={matchId}
                onChange={(e) => onSelectMatch(e.target.value)}
                className="text-xs bg-slate-900 border border-slate-800 text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium max-w-[140px] sm:max-w-[200px] truncate"
              >
                {allMatches.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.team1.shortName} vs {m.team2.shortName} ({m.status.toUpperCase()})
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 hover:bg-emerald-900/40 transition-all disabled:opacity-50"
              title="Refresh live odds for this match"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh Odds</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content: Organized in Sections A, B, C */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* ======================================================== */}
        {/* SECTION A: MATCH INFORMATION                            */}
        {/* ======================================================== */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-blue-500 to-indigo-500" />

          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-4 border-b border-slate-800 gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Section A: Match Information
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>{match?.seriesName || 'Series details'}</span>
              <span>•</span>
              <span>{match?.venueName || 'Venue'}</span>
              <span>•</span>
              <span className="px-2 py-0.5 rounded bg-slate-800 font-mono text-[11px] text-slate-300">
                {match?.format || 'Format'}
              </span>
            </div>
          </div>

          {!match ? (
            <div className="py-8 text-center text-slate-400 text-sm">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              Match record {matchId} is loading or not present in the current feed.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Teams & Scoreboard (8 cols on lg) */}
              <div className="lg:col-span-8 space-y-4">
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                    {team1?.name} vs {team2?.name}
                  </h3>
                  {match.matchTitlePrefix && (
                    <p className="text-xs text-slate-400 mt-0.5">{match.matchTitlePrefix}</p>
                  )}
                </div>

                {/* Team 1 Score Row */}
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-4 h-9 rounded-md shrink-0 shadow-sm"
                      style={{ backgroundColor: team1?.color || '#3b82f6' }}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-base sm:text-lg">{team1?.name}</span>
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                          {team1?.shortName}
                        </span>
                        {match.battingTeamKey === team1?.key && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            BATTING
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">Innings 1</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    {t1Score ? (
                      <div>
                        <div className="font-mono text-xl sm:text-2xl font-black text-white">
                          {t1Score.runs}
                          <span className="text-emerald-400">/{t1Score.wickets}</span>
                        </div>
                        <div className="text-xs text-slate-400 font-mono">
                          {t1Score.overs} ov ({t1Score.totalBalls} balls) • RR {t1Score.runRate.toFixed(2)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500 italic">Yet to bat</span>
                    )}
                  </div>
                </div>

                {/* Team 2 Score Row */}
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-4 h-9 rounded-md shrink-0 shadow-sm"
                      style={{ backgroundColor: team2?.color || '#ef4444' }}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-base sm:text-lg">{team2?.name}</span>
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                          {team2?.shortName}
                        </span>
                        {match.battingTeamKey === team2?.key && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            BATTING
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">Innings 2</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    {t2Score ? (
                      <div>
                        <div className="font-mono text-xl sm:text-2xl font-black text-white">
                          {t2Score.runs}
                          <span className="text-emerald-400">/{t2Score.wickets}</span>
                        </div>
                        <div className="text-xs text-slate-400 font-mono">
                          {t2Score.overs} ov ({t2Score.totalBalls} balls) • RR {t2Score.runRate.toFixed(2)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500 italic">Yet to bat</span>
                    )}
                  </div>
                </div>

                {/* Live Equation / Result Banner */}
                <div className="p-3 rounded-xl bg-gradient-to-r from-slate-950 to-slate-900 border border-slate-800 flex items-center gap-2.5 text-xs">
                  <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="font-semibold text-slate-200">
                    {match.resultText || match.sessionText || match.statusLabel || 'Match status live'}
                  </span>
                </div>
              </div>

              {/* Match Telemetry Cards (4 cols on lg) */}
              <div className="lg:col-span-4 grid grid-cols-2 lg:grid-cols-1 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Match Status
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        isLive ? 'bg-rose-500 animate-pulse' : isCompleted ? 'bg-emerald-400' : 'bg-amber-400'
                      }`}
                    />
                    <span className="text-sm font-bold text-white capitalize">{match.status}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {isUpcoming ? formatStartTime(match.startTime) : match.statusLabel}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Over & Ball
                  </div>
                  <div className="font-mono text-lg font-bold text-emerald-400">
                    {activeScore ? `${activeScore.overs} ov` : '0.0 ov'}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {activeScore
                      ? `${activeScore.totalBalls} total balls (${activeScore.ballsInOver} in this over)`
                      : 'Match scheduled'}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 col-span-2 lg:col-span-1">
                  <div className="flex items-center justify-between text-xs text-slate-400 pb-1 mb-1 border-b border-slate-800/60">
                    <span>Target: {match.target ? `${match.target} runs` : 'N/A'}</span>
                    <span>Format: {match.format}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono pt-1">
                    <div>
                      <span className="text-slate-400">CRR: </span>
                      <span className="font-bold text-white">
                        {match.currentRunRate ? match.currentRunRate.toFixed(2) : activeScore?.runRate.toFixed(2) || '0.00'}
                      </span>
                    </div>
                    {match.requiredRunRate ? (
                      <div>
                        <span className="text-slate-400">REQ: </span>
                        <span className="font-bold text-amber-400">{match.requiredRunRate.toFixed(2)}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ======================================================== */}
        {/* SECTION B: LIVE ODDS                                     */}
        {/* ======================================================== */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl relative">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-4 border-b border-slate-800 gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Section B: Live Odds
              </h2>
              {oddsState && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  Key: {oddsState.maskedKey}
                </span>
              )}
            </div>

            {/* Freshness & Timestamp Badge */}
            <div className="flex items-center gap-2">
              <div
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium border ${getFreshnessColor()}`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    freshnessSec <= 4 ? 'bg-emerald-400 animate-pulse' : freshnessSec <= 15 ? 'bg-amber-400' : 'bg-rose-400'
                  }`}
                />
                <span>
                  {oddsState?.lastUpdated ? `Freshness: ${freshnessSec}s ago` : 'No live ticks yet'}
                </span>
              </div>

              {oddsState?.lastUpdated && (
                <div className="text-[11px] text-slate-400 hidden sm:flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{new Date(oddsState.lastUpdated).toLocaleTimeString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Requirement 4 & 11: Error States & Staleness Banners */}
          <div className="space-y-3 mb-4">
            {/* 1. Missing Odds Key Alert */}
            {isMissingKey && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-rose-300">Missing Odds Key</h4>
                  <p className="text-rose-400/90 mt-0.5">
                    No odds key could be resolved for match &quot;{matchId}&quot;.
                    Goscorer getSV3 endpoint requires a verified key provided by the Crex match payload.
                  </p>
                </div>
              </div>
            )}

            {/* 2. API Request Failure Alert */}
            {isFailedRequest && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-rose-300">Odds API Request Failed</h4>
                    <p className="text-rose-400/90 mt-0.5">
                      {oddsState?.error || 'Unable to retrieve data from getSV3 endpoint'}. Crex match scorecard continues updating independently.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  className="px-3 py-1.5 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-rose-100 font-semibold border border-rose-700 shrink-0 transition-colors self-start sm:self-auto"
                >
                  {isRefreshing ? 'Retrying...' : 'Retry Odds Request'}
                </button>
              </div>
            )}

            {/* 3. Stale Odds Alert */}
            {isStaleOdds && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-950/40 border border-amber-700/60 text-xs">
                <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 animate-pulse" />
                <div>
                  <h4 className="font-bold text-amber-300">Stale Odds Warning ({freshnessSec}s elapsed)</h4>
                  <p className="text-amber-300/80 mt-0.5">
                    No new bookmaker rate tick received for {freshnessSec} seconds. Rate updates may be paused between balls/overs. Strategy engine has flagged incoming signals for staleness risk.
                  </p>
                </div>
              </div>
            )}

            {/* 4. Suspended Market / Invalid Rate Alert */}
            {isInvalidResponse && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-950/70 border border-amber-800/50 text-xs">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-amber-300">Market Suspended</h4>
                  <p className="text-slate-400 mt-0.5">
                    Bookmaker rate is currently suspended (quoted rate: &quot;{bookmaker?.rawRateString || '0-0'}&quot;). Entry signals remain in standby until active back/lay rates are quoted.
                  </p>
                </div>
              </div>
            )}

            {/* 5. Unavailable Match Events Notice */}
            {isMatchEventsUnavailable && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-950/70 border border-blue-900/40 text-xs">
                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-300">Scorecard Events Standing By</h4>
                  <p className="text-slate-400 mt-0.5">
                    Live scorecard events (overs, wickets, balls) have not commenced yet. Strategy engine is standing by for active balls.
                  </p>
                </div>
              </div>
            )}
          </div>

          {oddsState?.status === 'loading' && !oddsState.odds ? (
            <div className="py-12 text-center text-slate-400">
              <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-2" />
              <p className="text-sm font-medium">Retrieving live odds stream for key {oddsState.maskedKey}...</p>
            </div>
          ) : oddsState?.status === 'error' && !oddsState.odds ? (
            <div className="py-8 text-center bg-rose-950/20 border border-rose-900/50 rounded-xl p-4">
              <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-rose-300">Failed to retrieve odds</p>
              <p className="text-xs text-rose-400/80 mt-1">{oddsState.error || 'Network error'}</p>
            </div>
          ) : !bookmaker ? (
            <div className="py-8 text-center text-slate-500 text-sm">
              <Info className="w-8 h-8 mx-auto mb-2 text-slate-600" />
              No live bookmaker odds available for this match key at this time.
            </div>
          ) : (
            <div className="space-y-6">
              {/* Primary Odds Cards: Back & Lay Prices */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Back Price Card */}
                <div className="p-4 rounded-xl bg-blue-950/40 border border-blue-800/50 shadow-inner">
                  <div className="flex items-center justify-between text-xs text-blue-300 font-semibold mb-1">
                    <span>BACK (LAGAI)</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-200">
                      Decimal: {bookmaker.decimalBack ?? '—'}
                    </span>
                  </div>
                  <div className="font-mono text-3xl sm:text-4xl font-black text-blue-200">
                    {bookmaker.backRate !== null ? bookmaker.backRate : '—'}
                  </div>
                  <div className="text-xs text-blue-400/80 mt-1 flex items-center justify-between">
                    <span>{oddsState?.odds?.favoriteTeamName || 'Favorite'}</span>
                    <span className="font-mono text-[11px]">Paise Rate</span>
                  </div>
                </div>

                {/* Lay Price Card */}
                <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 shadow-inner">
                  <div className="flex items-center justify-between text-xs text-rose-300 font-semibold mb-1">
                    <span>LAY (KHAI)</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-200">
                      Decimal: {bookmaker.decimalLay ?? '—'}
                    </span>
                  </div>
                  <div className="font-mono text-3xl sm:text-4xl font-black text-rose-200">
                    {bookmaker.layRate !== null ? bookmaker.layRate : '—'}
                  </div>
                  <div className="text-xs text-rose-400/80 mt-1 flex items-center justify-between">
                    <span>Spread: {bookmaker.spread !== null ? `${bookmaker.spread} pt` : '—'}</span>
                    <span className="font-mono text-[11px]">Paise Rate</span>
                  </div>
                </div>

                {/* Previous vs Current Odds */}
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <div className="text-xs text-slate-400 font-semibold mb-1">
                    PREVIOUS VS CURRENT
                  </div>
                  <div className="space-y-1.5 font-mono">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Current Rate:</span>
                      <span className="font-bold text-white text-sm">
                        {bookmaker.rawRateString || '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Previous Rate:</span>
                      <span className="font-semibold text-slate-400 text-sm">
                        {oddsState?.previousOdds?.bookmaker.rawRateString || 'First tick'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800">
                      <span className="text-slate-500">Total Updates:</span>
                      <span className="text-slate-300">{oddsState?.recordsCount || 0}</span>
                    </div>
                  </div>
                </div>

                {/* Odds Movement */}
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <div className="text-xs text-slate-400 font-semibold mb-1">
                    ODDS MOVEMENT
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {movement?.direction === 'up' ? (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 text-xs font-bold">
                        <TrendingUp className="w-4 h-4 text-emerald-400" />
                        <span>DRIFTING UP (+{movement.deltaBack} pts)</span>
                      </div>
                    ) : movement?.direction === 'down' ? (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/80 text-rose-300 border border-rose-500/30 text-xs font-bold">
                        <TrendingDown className="w-4 h-4 text-rose-400" />
                        <span>FIRMING DOWN ({movement.deltaBack} pts)</span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium">
                        <Minus className="w-4 h-4 text-slate-400" />
                        <span>STABLE (0 pts change)</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">
                    {bookmaker.isSuspended ? (
                      <span className="text-amber-400 font-semibold">Market suspended (0-0)</span>
                    ) : (
                      <span>Active trading market</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Sessions */}
              {sessions.length > 0 && (
                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/80">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Session Lines (Fancy)
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {sessions.length} market{sessions.length > 1 ? 's' : ''} available
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {sessions.map((sess, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between"
                      >
                        <div>
                          <div className="text-[11px] text-slate-400">{sess.overs} Overs</div>
                          <div className="font-mono text-xs text-slate-500">{sess.rawString}</div>
                        </div>
                        <div className="text-right font-mono">
                          <div className="text-sm font-bold text-white">
                            {sess.low} - {sess.high}
                          </div>
                          <div className="text-[10px] text-slate-400">Spread: {sess.spread}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ======================================================== */}
        {/* SECTION C: ENTRY/EXIT ANALYSIS (Phase 6 Engine Driven)  */}
        {/* ======================================================== */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl relative space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Section C: Entry/Exit Strategy Engine
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetStrategyState}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-400 hover:text-white bg-slate-950 border border-slate-800 hover:bg-slate-800 rounded-lg transition-colors"
                title="Reset strategy state for this match"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Strategy State</span>
              </button>
            </div>
          </div>

          {/* 4 Strategy Rule Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. FIRST-ENTRY STATUS */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      1. First-Entry Status
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {renderStatusBadge(firstEntrySignal?.status)}
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        strategyState.firstEntryPosition.status === 'RECORDED_ENTRY'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-600'
                          : strategyState.firstEntryPosition.status === 'CANDIDATE_DETECTED'
                          ? 'bg-blue-950 text-blue-300 border border-blue-600'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {strategyState.firstEntryPosition.status}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 mt-3 text-xs">
                  <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800 font-mono">
                    <span className="text-slate-400">Qualifying Odds Range:</span>
                    <span className="text-slate-200 font-semibold">[1.85 to 2.00]</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800 font-mono">
                    <span className="text-slate-400">Current Decimal Odds:</span>
                    <span className="font-bold text-blue-300">
                      {bookmaker?.decimalBack ? bookmaker.decimalBack.toFixed(2) : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400">Entry Window Limit:</span>
                    <span className="text-slate-300">
                      {match?.team2Score ? 'Inn 2 (<= 6.0 ov)' : 'Inn 1 (<= 10.0 ov)'}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/90 border border-slate-800 text-[11px] text-slate-300">
                    <span className="text-slate-400 font-semibold">Engine Evaluation: </span>
                    {firstEntrySignal?.explanation || 'Awaiting tick evaluation'}
                  </div>
                </div>
              </div>

              {/* Action: Distinguish Candidate vs Recorded Trade */}
              <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">
                  {strategyState.firstEntryPosition.status === 'RECORDED_ENTRY'
                    ? `Entered @ ${strategyState.firstEntryPosition.entryOdds} (${strategyState.firstEntryPosition.entryWickets} wkt)`
                    : 'Candidate signal only (trade not recorded)'}
                </span>
                {strategyState.firstEntryPosition.status !== 'RECORDED_ENTRY' ? (
                  <button
                    type="button"
                    onClick={handleRecordFirstEntry}
                    disabled={!bookmaker?.decimalBack}
                    className="px-2.5 py-1 text-xs font-semibold text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-600/50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    Record 1st Entry
                  </button>
                ) : (
                  <span className="text-[11px] font-semibold text-emerald-400">Active Position</span>
                )}
              </div>
            </div>

            {/* 2. SECOND-ENTRY STATUS */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      2. Second-Entry Status
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {renderStatusBadge(secondEntrySignal?.status)}
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        strategyState.secondEntryPosition.status === 'RECORDED_ENTRY'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-600'
                          : strategyState.secondEntryPosition.status === 'CANDIDATE_DETECTED'
                          ? 'bg-blue-950 text-blue-300 border border-blue-600'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {strategyState.secondEntryPosition.status}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 mt-3 text-xs">
                  <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800 font-mono">
                    <span className="text-slate-400">Wicket Dependency:</span>
                    <span
                      className={`font-semibold ${
                        strategyState.firstEntryPosition.status === 'RECORDED_ENTRY'
                          ? (activeScore?.wickets || 0) > (strategyState.firstEntryPosition.entryWickets || 0)
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                          : 'text-slate-500'
                      }`}
                    >
                      {strategyState.firstEntryPosition.status === 'RECORDED_ENTRY'
                        ? `Entry Wkts: ${strategyState.firstEntryPosition.entryWickets} | Current: ${activeScore?.wickets || 0}`
                        : 'Requires prior 1st entry'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800 font-mono">
                    <span className="text-slate-400">Opposing-Team Odds:</span>
                    <span className="font-bold text-amber-300">
                      {opposingOdds !== null ? `${opposingOdds.toFixed(2)} (< 1.65 target)` : '—'}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/90 border border-slate-800 text-[11px] text-slate-300">
                    <span className="text-slate-400 font-semibold">Engine Evaluation: </span>
                    {secondEntrySignal?.explanation || 'Awaiting wicket & opposing odds'}
                  </div>
                </div>
              </div>

              {/* Action: Record 2nd Entry */}
              <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">
                  {strategyState.secondEntryPosition.status === 'RECORDED_ENTRY'
                    ? `2nd Entered @ ${strategyState.secondEntryPosition.entryOdds}`
                    : 'Candidate status only'}
                </span>
                {strategyState.secondEntryPosition.status !== 'RECORDED_ENTRY' && (
                  <button
                    type="button"
                    onClick={handleRecordSecondEntry}
                    disabled={!opposingOdds}
                    className="px-2.5 py-1 text-xs font-semibold text-blue-300 bg-blue-950/60 hover:bg-blue-900/80 border border-blue-600/50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    Record 2nd Entry
                  </button>
                )}
              </div>
            </div>

            {/* 3. BOOKSET / EXIT STATUS */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      3. Bookset / Exit Status
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {renderStatusBadge(firstBooksetSignal?.status)}
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      {strategyState.firstEntryPosition.status === 'RECORDED_EXIT' ? 'EXITED' : 'MONITORING'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 mt-3 text-xs">
                  <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800 font-mono">
                    <span className="text-slate-400">1st Bookset Range:</span>
                    <span className="text-purple-300 font-semibold">[1.45 to 1.55]</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800 font-mono">
                    <span className="text-slate-400">2nd Bookset Threshold:</span>
                    <span className="text-purple-300 font-semibold">&gt;= 1.85</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400">Window Continuity:</span>
                    <span className="text-emerald-400 font-medium">
                      Exits continuously monitored after window closes
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/90 border border-slate-800 text-[11px] text-slate-300">
                    <span className="text-slate-400 font-semibold">1st Bookset Target: </span>
                    {firstBooksetSignal?.explanation || 'Waiting for bookset odds'}
                  </div>
                </div>
              </div>

              {/* Action: Record Exit */}
              <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">
                  {strategyState.firstEntryPosition.status === 'RECORDED_EXIT'
                    ? `Exited @ ${strategyState.firstEntryPosition.exitOdds}`
                    : 'Awaiting exit criteria'}
                </span>
                {strategyState.firstEntryPosition.status === 'RECORDED_ENTRY' && (
                  <button
                    type="button"
                    onClick={handleRecordFirstExit}
                    disabled={!bookmaker?.decimalLay}
                    className="px-2.5 py-1 text-xs font-semibold text-purple-300 bg-purple-950/60 hover:bg-purple-900/80 border border-purple-600/50 rounded-lg transition-colors"
                  >
                    Record 1st Exit
                  </button>
                )}
              </div>
            </div>

            {/* 4. ABNORMAL ACTIVITY STATUS */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      4. Abnormal Activity Status
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    Trigger Count: {strategyState.abnormalActivityCount}
                  </span>
                </div>

                <div className="space-y-2 mt-3 text-xs">
                  <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800 font-mono">
                    <span className="text-slate-400">Four Boundary Shift Rule:</span>
                    <span className="font-semibold text-slate-200">
                      Must be &gt;= 0.11 (&lt;= 0.10 fails)
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800 font-mono">
                    <span className="text-slate-400">Six Boundary Shift Rule:</span>
                    <span className="font-semibold text-slate-200">
                      Must be &gt;= 0.18 (&lt;= 0.17 fails)
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/90 border border-slate-800 text-[11px] text-slate-300">
                    <span className="text-slate-400 font-semibold">Latest Evaluation: </span>
                    {abnormalSignal?.explanation || 'No boundary trigger evaluated yet'}
                  </div>
                </div>
              </div>

              {/* Boundary Test Buttons */}
              <div className="mt-4 pt-3 border-t border-slate-800/60">
                <div className="text-[11px] text-slate-400 mb-2 flex items-center justify-between">
                  <span>Simulate boundary shift test:</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 text-[10px] font-mono">
                  <button
                    type="button"
                    onClick={() => handleTestBoundaryShift('FOUR', 0.10)}
                    className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-300"
                    title="Four: 0.10 movement (Should FAIL)"
                  >
                    4: 0.10 (FAIL)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTestBoundaryShift('FOUR', 0.11)}
                    className="px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-600/40 rounded text-emerald-300 font-bold"
                    title="Four: 0.11 movement (Should PASS)"
                  >
                    4: 0.11 (PASS)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTestBoundaryShift('SIX', 0.17)}
                    className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-300"
                    title="Six: 0.17 movement (Should FAIL)"
                  >
                    6: 0.17 (FAIL)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTestBoundaryShift('SIX', 0.18)}
                    className="px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-600/40 rounded text-emerald-300 font-bold"
                    title="Six: 0.18 movement (Should PASS)"
                  >
                    6: 0.18 (PASS)
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Structured Signal History Log (Requirement 8 & 9) */}
          <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800/80">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-3 border-b border-slate-800/60 gap-2">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-emerald-400" />
                <span className="font-bold uppercase tracking-wider text-slate-300 text-xs">
                  Strategy Signals Log ({signals.length} evaluations)
                </span>
              </div>

              {/* Requirement 8: Filter Tabs (Candidates, Exits, Rejected, Wickets) */}
              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                <button
                  type="button"
                  onClick={() => setSignalFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    signalFilter === 'all'
                      ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All ({signals.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSignalFilter('candidates')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    signalFilter === 'candidates'
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/60 shadow-sm'
                      : 'text-emerald-400/80 hover:text-emerald-300'
                  }`}
                >
                  Candidates &amp; Exits ({candidatesCount})
                </button>
                <button
                  type="button"
                  onClick={() => setSignalFilter('rejected')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    signalFilter === 'rejected'
                      ? 'bg-rose-950/80 text-rose-300 border border-rose-600/60 shadow-sm'
                      : 'text-rose-400/80 hover:text-rose-300'
                  }`}
                >
                  Rejected Conditions ({rejectedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setSignalFilter('events')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    signalFilter === 'events'
                      ? 'bg-blue-950/80 text-blue-300 border border-blue-600/60 shadow-sm'
                      : 'text-blue-400/80 hover:text-blue-300'
                  }`}
                >
                  Wickets &amp; Activity ({eventsCount})
                </button>
              </div>
            </div>

            {filteredSignals.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs italic">
                {signalFilter === 'all'
                  ? 'Signals will appear as live match ticks are processed by the strategy engine.'
                  : `No signals matching the "${signalFilter}" filter yet.`}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono text-left">
                  <thead className="text-[11px] text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2 px-2.5">Timestamp</th>
                      <th className="py-2 px-2.5">Signal Type</th>
                      <th className="py-2 px-2.5">Over</th>
                      <th className="py-2 px-2.5">Odds / Shift</th>
                      <th className="py-2 px-2.5">Status</th>
                      <th className="py-2 px-2.5">Reason &amp; Evaluation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {filteredSignals.slice(0, 30).map((sig) => (
                      <tr key={sig.id} className="hover:bg-slate-900/60 transition-colors">
                        <td className="py-2 px-2.5 text-slate-400 whitespace-nowrap">
                          {new Date(sig.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              sig.signalType === 'WICKET_EVENT'
                                ? 'bg-purple-950 text-purple-300 border border-purple-800'
                                : sig.signalType.startsWith('ABNORMAL')
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : sig.status === 'PASS'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : 'bg-slate-900 text-slate-300 border border-slate-800'
                            }`}
                          >
                            {sig.signalType.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-slate-400 whitespace-nowrap">
                          Inn {sig.currentInnings} • {sig.currentOver} ov
                        </td>
                        <td className="py-2 px-2.5 text-blue-300 whitespace-nowrap">
                          {sig.relevantOdds.decimalOdds
                            ? sig.relevantOdds.decimalOdds.toFixed(2)
                            : sig.relevantOdds.opposingTeamOdds
                            ? `Opp: ${sig.relevantOdds.opposingTeamOdds.toFixed(2)}`
                            : sig.relevantOdds.oddsDelta !== undefined && sig.relevantOdds.oddsDelta !== null
                            ? `Δ ${sig.relevantOdds.oddsDelta.toFixed(2)}`
                            : '—'}
                          {sig.relevantOdds.isStale && (
                            <span className="ml-1 text-[9px] text-amber-400 font-bold px-1 rounded bg-amber-950/80">
                              STALE
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">{renderStatusBadge(sig.status)}</td>
                        <td className="py-2 px-2.5 text-slate-300 max-w-[360px]" title={sig.explanation}>
                          <p className="line-clamp-2 leading-relaxed">{sig.explanation}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
