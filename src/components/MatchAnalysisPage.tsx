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
  Database,
} from 'lucide-react';
import { ThemeToggle, ThemeMode } from './ThemeToggle';
import { ParsedCricketMatch } from '../types/cricket';
import { MatchOddsState, OddsTick } from '../types/odds';
import { KNOWN_TEAMS } from '../data/cricketMapping';
import {
  strategyEngine,
  detectTeamInControl,
} from '../services/strategy';
import { SerializedMatchStrategyState } from '../services/strategy/types';
import {
  loadMatchStrategyFromSupabase,
  fetchMatchTimelineFromDb,
  sendManualOverrideEntry,
  sendManualOverrideExit,
  sendManualStrategyReset,
  MatchTimelineTick,
} from '../services/supabaseSyncService';

interface MatchAnalysisPageProps {
  matchId: string;
  match?: ParsedCricketMatch;
  oddsState?: MatchOddsState;
  allMatches?: ParsedCricketMatch[];
  strategyVersion?: number;
  onStrategyStateSync?: (snapshot: SerializedMatchStrategyState) => void;
  onBack: () => void;
  onSelectMatch: (matchId: string) => void;
  onRefreshOdds?: (matchId: string) => Promise<void>;
  theme?: ThemeMode;
  onThemeChange?: (theme: ThemeMode) => void;
}

export const MatchAnalysisPage: React.FC<MatchAnalysisPageProps> = ({
  matchId,
  match,
  oddsState,
  allMatches = [],
  strategyVersion = 0,
  onStrategyStateSync,
  onBack,
  onSelectMatch,
  onRefreshOdds,
  theme,
  onThemeChange,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [freshnessSec, setFreshnessSec] = useState<number>(0);
  const [evaluationTick, setEvaluationTick] = useState<number>(0);
  const [signalFilter, setSignalFilter] = useState<'all' | 'candidates' | 'rejected' | 'events'>('all');
  const [timelineTicks, setTimelineTicks] = useState<MatchTimelineTick[]>([]);
  const [missedTicks, setMissedTicks] = useState<number>(0);
  const [timelineMode, setTimelineMode] = useState<'balls' | 'ticks'>('balls');
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [overridePending, setOverridePending] = useState<boolean>(false);

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

  // Match details resolution with KNOWN_TEAMS and speechNames dynamic fallback
  const team1Resolved = (match?.team1.key ? KNOWN_TEAMS[match.team1.key] : undefined) || match?.team1;
  const team2Resolved = (match?.team2.key ? KNOWN_TEAMS[match.team2.key] : undefined) || match?.team2;

  const team1Name =
    match?.team1.key && oddsState?.odds?.speechNames?.[match.team1.key] && team1Resolved?.name?.startsWith('Team ')
      ? oddsState.odds.speechNames[match.team1.key]
      : team1Resolved?.name || 'Team 1';

  const team1Short =
    team1Resolved?.shortName && team1Resolved.shortName !== match?.team1.key && !team1Resolved.shortName.startsWith('TEAM')
      ? team1Resolved.shortName
      : match?.team1.key && oddsState?.odds?.speechNames?.[match.team1.key]
      ? oddsState.odds.speechNames[match.team1.key].slice(0, 4).toUpperCase()
      : match?.team1.shortName || 'T1';

  const team2Name =
    match?.team2.key && oddsState?.odds?.speechNames?.[match.team2.key] && team2Resolved?.name?.startsWith('Team ')
      ? oddsState.odds.speechNames[match.team2.key]
      : team2Resolved?.name || 'Team 2';

  const team2Short =
    team2Resolved?.shortName && team2Resolved.shortName !== match?.team2.key && !team2Resolved.shortName.startsWith('TEAM')
      ? team2Resolved.shortName
      : match?.team2.key && oddsState?.odds?.speechNames?.[match.team2.key]
      ? oddsState.odds.speechNames[match.team2.key].slice(0, 4).toUpperCase()
      : match?.team2.shortName || 'T2';

  const team1 = team1Resolved || match?.team1;
  const team2 = team2Resolved || match?.team2;
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
    if (!oddsState?.lastUpdated) return 'text-[var(--mu)] bg-[var(--sf-2)] border-[var(--bd)]';
    if (freshnessSec <= 4) return 'text-[var(--ok-tx)] bg-[var(--ok-bg)] border-[var(--ok-bd)]';
    if (freshnessSec <= 15) return 'text-[var(--warn-tx)] bg-[var(--warn-bg)] border-[var(--warn-bd)]';
    return 'text-[var(--rdt)] bg-[var(--rds)] border-[var(--rd)]/40 animate-pulse';
  };

  // =========================================================================
  // SERVER-DRIVEN STRATEGY STATE & FULL HISTORY HYDRATION (Read-Only Browser)
  // =========================================================================
  const strategyState = useMemo(() => {
    return strategyEngine.getState(matchId);
  }, [matchId, evaluationTick, strategyVersion]);

  const hydrateFromServerDb = useCallback(
    async (showSpinner = false) => {
      if (!matchId) return;
      if (showSpinner) setIsLoadingHistory(true);
      try {
        const [{ positions, signals, trades, strategyState: serverSnap }, timelineRes] =
          await Promise.all([
            loadMatchStrategyFromSupabase(matchId),
            fetchMatchTimelineFromDb(matchId, { order: 'desc', limit: 20000 }),
          ]);

        if (serverSnap) {
          strategyEngine.hydrateState(matchId, serverSnap);
        }

        const state = strategyEngine.getState(matchId);

        if (trades && trades.length > 0) {
          const firstTrade = trades.find((t) => t.entryType === 'FIRST_ENTRY');
          if (firstTrade) {
            state.firstEntryTrade = firstTrade;
            if (!state.bookingTeamName) state.bookingTeamName = firstTrade.bookingTeam;
            if (firstTrade.status === 'ACTIVE') {
              if (state.stage === 'WAITING_FOR_CONFIRMATION') state.stage = 'ACTIVE_FIRST_ENTRY';
              state.firstEntryPosition.status = 'RECORDED_ENTRY';
              state.firstEntryPosition.entryOdds = firstTrade.entryDecimal;
              state.firstEntryPosition.entryOver = firstTrade.entryOver;
              state.firstEntryPosition.entryInnings = firstTrade.innings;
              state.firstEntryPosition.entryWickets = firstTrade.entryWickets;
              state.firstEntryPosition.entryTimestamp = firstTrade.entryTime;
            } else if (firstTrade.status === 'BOOKSET_COMPLETED') {
              if (
                state.stage === 'WAITING_FOR_CONFIRMATION' ||
                state.stage === 'ACTIVE_FIRST_ENTRY'
              ) {
                state.stage = 'FIRST_BOOKSET_COMPLETED';
              }
              state.firstEntryPosition.status = 'RECORDED_EXIT';
              state.firstEntryPosition.entryOdds =
                state.firstEntryPosition.entryOdds ?? firstTrade.entryDecimal;
              state.firstEntryPosition.entryOver =
                state.firstEntryPosition.entryOver ?? firstTrade.entryOver;
              state.firstEntryPosition.entryInnings =
                state.firstEntryPosition.entryInnings ?? firstTrade.innings;
              state.firstEntryPosition.entryWickets =
                state.firstEntryPosition.entryWickets ?? firstTrade.entryWickets;
              state.firstEntryPosition.exitOdds = firstTrade.exitDecimal;
              state.firstEntryPosition.exitOver = firstTrade.exitOver;
              state.firstEntryPosition.exitTimestamp = firstTrade.exitTime;
            }
          }
          const secondTrade = trades.find((t) => t.entryType === 'SECOND_ENTRY');
          if (secondTrade) {
            state.secondEntryTrade = secondTrade;
            if (secondTrade.status === 'ACTIVE') {
              state.stage = 'ACTIVE_SECOND_ENTRY';
              state.secondEntryPosition.status = 'RECORDED_ENTRY';
              state.secondEntryPosition.entryOdds = secondTrade.entryDecimal;
              state.secondEntryPosition.entryOver = secondTrade.entryOver;
              state.secondEntryPosition.entryInnings = secondTrade.innings;
              state.secondEntryPosition.entryWickets = secondTrade.entryWickets;
              state.secondEntryPosition.entryTimestamp = secondTrade.entryTime;
            } else if (secondTrade.status === 'BOOKSET_COMPLETED') {
              state.stage = 'FULL_BOOKSET_COMPLETED';
              state.secondEntryPosition.status = 'RECORDED_EXIT';
              state.secondEntryPosition.entryOdds =
                state.secondEntryPosition.entryOdds ?? secondTrade.entryDecimal;
              state.secondEntryPosition.entryOver =
                state.secondEntryPosition.entryOver ?? secondTrade.entryOver;
              state.secondEntryPosition.exitOdds = secondTrade.exitDecimal;
              state.secondEntryPosition.exitOver = secondTrade.exitOver;
              state.secondEntryPosition.exitTimestamp = secondTrade.exitTime;
            }
          }
        }

        positions.forEach((pos) => {
          if (pos.positionType === 'FIRST_ENTRY' && pos.status !== 'NONE') {
            state.firstEntryPosition = { ...state.firstEntryPosition, ...pos };
          } else if (pos.positionType === 'SECOND_ENTRY' && pos.status !== 'NONE') {
            state.secondEntryPosition = { ...state.secondEntryPosition, ...pos };
          }
        });

        if (signals.length > 0 && state.signalsHistory.length < signals.length) {
          state.signalsHistory = signals;
        }

        setTimelineTicks(timelineRes.data || []);
        setMissedTicks(timelineRes.missedTicks || 0);
        setEvaluationTick((prev) => prev + 1);
      } finally {
        if (showSpinner) setIsLoadingHistory(false);
      }
    },
    [matchId]
  );

  // Load full saved history (ball 1 to now) on mount / match change, then stay synced
  useEffect(() => {
    hydrateFromServerDb(true).catch(() => {});
  }, [hydrateFromServerDb]);

  useEffect(() => {
    if (!matchId) return;
    const pollMs = isLive ? 2500 : 10000;
    const timer = setInterval(() => {
      hydrateFromServerDb(false).catch(() => {});
    }, pollMs);
    return () => clearInterval(timer);
  }, [matchId, isLive, hydrateFromServerDb]);

  // Extract latest signal outputs for each rule
  const signals = strategyState.signalsHistory;
  const firstEntrySignal = signals.find((s) => s.signalType === 'FIRST_ENTRY_CANDIDATE');
  const firstExit55Signal = signals.find((s) => s.signalType === 'FIRST_EXIT_BELOW_55');
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
              s.signalType === 'FIRST_EXIT_BELOW_55' ||
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
            s.signalType === 'FIRST_EXIT_BELOW_55' ||
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

  // Control & control_team_odds directly from Crex (never 100-minus)
  const controlInfo = useMemo(() => {
    if (!match) {
      return {
        teamInControl: 'UNKNOWN' as const,
        currentPaise: null,
        decimalOdds: bookmaker?.decimalBack ?? null,
      };
    }
    return detectTeamInControl(match, oddsState);
  }, [match, oddsState, bookmaker?.decimalBack]);

  // Manual Overrides (persisted on server.ts and broadcast via SSE)
  const handleRecordFirstEntry = async () => {
    if (!bookmaker?.decimalBack || !match || overridePending) return;
    setOverridePending(true);
    try {
      const currentInnings = match.team2Score ? 2 : 1;
      const currentOver = activeScore ? activeScore.overs : 0;
      const currentWickets = activeScore ? activeScore.wickets : 0;
      const matchTitle = `${team1Short} vs ${team2Short}`;
      const battingName = currentInnings === 2 ? team2Short : team1Short;
      const bowlingName = currentInnings === 2 ? team1Short : team2Short;

      const updated = await sendManualOverrideEntry(matchId, {
        positionType: 'FIRST_ENTRY',
        entryOdds: bookmaker.decimalBack,
        innings: currentInnings,
        over: currentOver,
        wickets: currentWickets,
        bookingTeam: strategyState.bookingTeamName || battingName,
        battingTeam: battingName,
        bowlingTeam: bowlingName,
        matchName: matchTitle,
        seriesName: match.seriesName,
      });
      if (updated) {
        strategyEngine.hydrateState(matchId, updated);
        onStrategyStateSync?.(updated);
      }
      setEvaluationTick((prev) => prev + 1);
    } finally {
      setOverridePending(false);
    }
  };

  const handleRecordFirstExit = async () => {
    if (!bookmaker?.decimalLay || !match || overridePending) return;
    setOverridePending(true);
    try {
      const currentOver = activeScore ? activeScore.overs : 0;
      const updated = await sendManualOverrideExit(matchId, {
        positionType: 'FIRST_ENTRY',
        exitOdds: bookmaker.decimalLay,
        over: currentOver,
        exitReason: 'FULL_BOOKSET_OPPOSING_85',
      });
      if (updated) {
        strategyEngine.hydrateState(matchId, updated);
        onStrategyStateSync?.(updated);
      }
      setEvaluationTick((prev) => prev + 1);
    } finally {
      setOverridePending(false);
    }
  };

  const handleRecordSecondEntry = async () => {
    const triggerDecimal = controlInfo.decimalOdds ?? bookmaker?.decimalBack;
    if (!triggerDecimal || !match || overridePending) return;
    setOverridePending(true);
    try {
      const currentInnings = match.team2Score ? 2 : 1;
      const currentOver = activeScore ? activeScore.overs : 0;
      const currentWickets = activeScore ? activeScore.wickets : 0;
      const matchTitle = `${team1Short} vs ${team2Short}`;
      const battingName = currentInnings === 2 ? team2Short : team1Short;
      const bowlingName = currentInnings === 2 ? team1Short : team2Short;

      const updated = await sendManualOverrideEntry(matchId, {
        positionType: 'SECOND_ENTRY',
        entryOdds: triggerDecimal,
        innings: currentInnings,
        over: currentOver,
        wickets: currentWickets,
        bookingTeam: strategyState.bookingTeamName || battingName,
        battingTeam: battingName,
        bowlingTeam: bowlingName,
        matchName: matchTitle,
        seriesName: match.seriesName,
      });
      if (updated) {
        strategyEngine.hydrateState(matchId, updated);
        onStrategyStateSync?.(updated);
      }
      setEvaluationTick((prev) => prev + 1);
    } finally {
      setOverridePending(false);
    }
  };

  const handleResetStrategyState = async () => {
    if (overridePending) return;
    setOverridePending(true);
    try {
      const updated = await sendManualStrategyReset(matchId);
      if (updated) {
        strategyEngine.hydrateState(matchId, updated);
        onStrategyStateSync?.(updated);
      } else {
        strategyEngine.resetState(matchId);
      }
      setEvaluationTick((prev) => prev + 1);
    } finally {
      setOverridePending(false);
    }
  };

  const displayedTimelineRows = useMemo(() => {
    if (timelineMode === 'balls') {
      return timelineTicks.filter((t) => t.is_new_ball);
    }
    return timelineTicks;
  }, [timelineTicks, timelineMode]);

  const legalBallsSavedCount = useMemo(
    () => timelineTicks.filter((t) => t.is_new_ball).length,
    [timelineTicks]
  );

  const renderStatusBadge = (status?: string) => {
    if (status === 'PASS') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)] text-[10px] font-bold">
          <Check className="w-3 h-3" />
          PASS
        </span>
      );
    }
    if (status === 'FAIL') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--rds)] text-[var(--rdt)] border border-[var(--rd)]/35 text-[10px] font-bold">
          <X className="w-3 h-3" />
          FAIL
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--sf-2)] text-[var(--mu)] border border-[var(--bd)] text-[10px] font-bold">
        DATA UNAVAILABLE
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--tx)] flex flex-col">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Top Navigation Bar: wraps cleanly into 2 rows on 390px mobile */}
      <header className="sticky top-0 z-30 border-b border-[var(--bd)] bg-[var(--sf)] px-3 sm:px-6 py-2.5 sm:py-3">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          {/* Row 1 on mobile: Back button, title and LIVE pill */}
          <div className="flex items-center justify-between sm:justify-start gap-2 sm:gap-3 min-w-0">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-[var(--tx)] bg-[var(--sf-2)] border border-[var(--bd)] hover:bg-[var(--rds)] hover:text-[var(--rdt)] transition-colors shrink-0"
                title="Back to Matches"
              >
                <ArrowLeft className="w-4 h-4 text-[var(--rdt)]" />
                <span>Matches</span>
              </button>

              <div className="h-4 w-px bg-[var(--bd)] hidden sm:block" />

              <div className="min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <span className="font-mono text-[11px] px-1.5 sm:px-2 py-0.5 rounded bg-[var(--sf-2)] text-[var(--mu)] border border-[var(--bd)] hidden md:inline shrink-0">
                    ID: {matchId}
                  </span>
                  <h1 className="text-sm sm:text-base font-bold text-[var(--tx)] truncate">
                    {match ? `${team1Short} vs ${team2Short}` : `Match ${matchId}`}
                  </h1>
                </div>
              </div>
            </div>

            {isLive && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--rds)] text-[var(--rdt)] text-[10px] font-bold uppercase tracking-wider shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--rdt)]" />
                LIVE
              </span>
            )}
          </div>

          {/* Row 2 on mobile (inline right on sm+): Match Switcher, Theme Toggle & Odds Refresh */}
          <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
            {allMatches.length > 1 ? (
              <select
                aria-label="Switch active match"
                value={matchId}
                onChange={(e) => onSelectMatch(e.target.value)}
                className="flex-1 sm:flex-none text-xs bg-[var(--sf-2)] border border-[var(--bd)] text-[var(--tx)] rounded-xl px-2.5 py-1.5 focus:border-[var(--rd)] font-medium min-w-0 sm:max-w-[200px] truncate"
              >
                {allMatches.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.team1.shortName} vs {m.team2.shortName} ({m.status.toUpperCase()})
                  </option>
                ))}
              </select>
            ) : (
              <div className="sm:hidden" />
            )}

            <div className="flex items-center gap-2 shrink-0">
              {theme && onThemeChange && (
                <ThemeToggle theme={theme} onToggle={onThemeChange} />
              )}

              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                aria-label="Refresh live odds"
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-[var(--rdt)] bg-[var(--rds)] border border-[var(--rd)]/30 hover:opacity-90 transition-opacity disabled:opacity-50"
                title="Refresh live odds for this match"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh Odds</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content: Organized in Sections A, B, C */}
      <main id="main-content" tabIndex={-1} className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6 space-y-5 sm:space-y-6">
        {/* ======================================================== */}
        {/* SECTION A: MATCH INFORMATION                            */}
        {/* ======================================================== */}
        <section
          className="bg-[var(--sf)] border border-[var(--bd)] rounded-2xl p-4 sm:p-6 relative overflow-hidden"
          style={{ boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 mb-4 border-b border-[var(--bd)] gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--rd)]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--mu)]">
                Section A: Match Information
              </h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--mu)]">
              <span>{match?.seriesName || 'Series details'}</span>
              <span>•</span>
              <span>{match?.venueName || 'Venue'}</span>
              <span>•</span>
              <span className="px-2 py-0.5 rounded bg-[var(--sf-2)] border border-[var(--bd)] font-mono text-[11px] text-[var(--tx)]">
                {match?.format || 'Format'}
              </span>
            </div>
          </div>

          {!match ? (
            <div className="py-8 text-center text-[var(--mu)] text-sm">
              <AlertTriangle className="w-8 h-8 text-[var(--warn-tx)] mx-auto mb-2" />
              Match record {matchId} is loading or not present in the current feed.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Teams & Scoreboard */}
              <div className="lg:col-span-8 space-y-3.5">
                <div>
                  <h3 className="text-lg sm:text-2xl font-bold text-[var(--tx)] tracking-tight">
                    {team1?.name} vs {team2?.name}
                  </h3>
                  {match.matchTitlePrefix && (
                    <p className="text-xs text-[var(--mu)] mt-0.5">{match.matchTitlePrefix}</p>
                  )}
                </div>

                {/* Team 1 Score Row */}
                <div className="p-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 bg-[var(--rds)] text-[var(--rdt)]">
                      {team1Short.slice(0, 3)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[var(--tx)] text-sm sm:text-base truncate">
                          {team1Name}
                        </span>
                        {match.battingTeamKey === team1?.key && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)]">
                            BATTING
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--mu)]">Innings 1</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 tabular-nums">
                    {t1Score ? (
                      <div>
                        <div className="text-xl sm:text-2xl font-bold text-[var(--tx)]">
                          {t1Score.runs}
                          <span className="text-[var(--rdt)]">/{t1Score.wickets}</span>
                        </div>
                        <div className="text-[11px] sm:text-xs text-[var(--mu)]">
                          {t1Score.overs} ov ({t1Score.totalBalls}b) • RR {t1Score.runRate.toFixed(2)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--mu)] italic">Yet to bat</span>
                    )}
                  </div>
                </div>

                {/* Team 2 Score Row */}
                <div className="p-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 bg-[var(--rds)] text-[var(--rdt)]">
                      {team2Short.slice(0, 3)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[var(--tx)] text-sm sm:text-base truncate">
                          {team2Name}
                        </span>
                        {match.battingTeamKey === team2?.key && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)]">
                            BATTING
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--mu)]">Innings 2</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 tabular-nums">
                    {t2Score ? (
                      <div>
                        <div className="text-xl sm:text-2xl font-bold text-[var(--tx)]">
                          {t2Score.runs}
                          <span className="text-[var(--rdt)]">/{t2Score.wickets}</span>
                        </div>
                        <div className="text-[11px] sm:text-xs text-[var(--mu)]">
                          {t2Score.overs} ov ({t2Score.totalBalls}b) • RR {t2Score.runRate.toFixed(2)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--mu)] italic">Yet to bat</span>
                    )}
                  </div>
                </div>

                {/* Live Equation / Result Banner */}
                <div className="p-3 rounded-xl bg-[var(--rds)] border border-[var(--rd)]/25 flex items-center gap-2.5 text-xs">
                  <Activity className="w-4 h-4 text-[var(--rdt)] shrink-0" />
                  <span className="font-semibold text-[var(--rdt)]">
                    {match.resultText || match.sessionText || match.statusLabel || 'Match status live'}
                  </span>
                </div>
              </div>

              {/* Match Telemetry Cards */}
              <div className="lg:col-span-4 grid grid-cols-2 lg:grid-cols-1 gap-3">
                <div className="p-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
                  <div className="text-[11px] font-semibold text-[var(--mu)] uppercase tracking-wider mb-1">
                    Match Status
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        isLive ? 'bg-[var(--rd)] animate-pulse' : isCompleted ? 'bg-[var(--ok-tx)]' : 'bg-[var(--warn-tx)]'
                      }`}
                    />
                    <span className="text-sm font-bold text-[var(--tx)] capitalize">{match.status}</span>
                  </div>
                  <div className="text-xs text-[var(--mu)] mt-1">
                    {isUpcoming ? formatStartTime(match.startTime) : match.statusLabel}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
                  <div className="text-[11px] font-semibold text-[var(--mu)] uppercase tracking-wider mb-1">
                    Over & Ball
                  </div>
                  <div className="text-lg font-bold text-[var(--ok-tx)] tabular-nums">
                    {activeScore ? `${activeScore.overs} ov` : '0.0 ov'}
                  </div>
                  <div className="text-xs text-[var(--mu)] mt-0.5 tabular-nums">
                    {activeScore
                      ? `${activeScore.totalBalls} balls (${activeScore.ballsInOver} in over)`
                      : 'Match scheduled'}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] col-span-2 lg:col-span-1">
                  <div className="flex items-center justify-between text-xs text-[var(--mu)] pb-1 mb-1 border-b border-[var(--bd)]">
                    <span>Target: {match.target ? `${match.target} runs` : 'N/A'}</span>
                    <span>Format: {match.format}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs pt-1 tabular-nums">
                    <div>
                      <span className="text-[var(--mu)]">CRR: </span>
                      <span className="font-bold text-[var(--tx)]">
                        {match.currentRunRate ? match.currentRunRate.toFixed(2) : activeScore?.runRate.toFixed(2) || '0.00'}
                      </span>
                    </div>
                    {match.requiredRunRate ? (
                      <div>
                        <span className="text-[var(--mu)]">REQ: </span>
                        <span className="font-bold text-[var(--warn-tx)]">{match.requiredRunRate.toFixed(2)}</span>
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
        <section
          className="bg-[var(--sf)] border border-[var(--bd)] rounded-2xl p-4 sm:p-6 relative"
          style={{ boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 mb-4 border-b border-[var(--bd)] gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-2 h-2 rounded-full bg-[var(--blut)]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--mu)]">
                Section B: Live Odds
              </h2>
              {oddsState && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--sf-2)] border border-[var(--bd)] text-[var(--mu)]">
                  Key: {oddsState.maskedKey}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border tabular-nums ${getFreshnessColor()}`}
              >
                <span className="w-2 h-2 rounded-full bg-current" />
                <span>
                  {oddsState?.lastUpdated ? `Freshness: ${freshnessSec}s ago` : 'No live ticks yet'}
                </span>
              </div>

              {oddsState?.lastUpdated && (
                <div className="text-[11px] text-[var(--mu)] hidden sm:flex items-center gap-1 tabular-nums">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{new Date(oddsState.lastUpdated).toLocaleTimeString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Error States & Staleness Banners */}
          <div className="space-y-3 mb-4">
            {isMissingKey && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--rds)] border border-[var(--rd)]/35 text-xs">
                <AlertTriangle className="w-4 h-4 text-[var(--rdt)] shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-[var(--rdt)]">Missing Odds Key</h4>
                  <p className="text-[var(--tx)] mt-0.5">
                    No odds key could be resolved for match &quot;{matchId}&quot;.
                    Goscorer getSV3 endpoint requires a verified key provided by the Crex match payload.
                  </p>
                </div>
              </div>
            )}

            {isFailedRequest && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 rounded-xl bg-[var(--rds)] border border-[var(--rd)]/35 text-xs">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-[var(--rdt)] shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-[var(--rdt)]">Odds API Request Failed</h4>
                    <p className="text-[var(--tx)] mt-0.5">
                      {oddsState?.error || 'Unable to retrieve data from getSV3 endpoint'}. Crex match scorecard continues updating independently.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  className="px-3 py-1.5 rounded-lg bg-[var(--rd)] text-white font-semibold shrink-0 transition-opacity hover:opacity-90 self-start sm:self-auto"
                >
                  {isRefreshing ? 'Retrying...' : 'Retry Odds Request'}
                </button>
              </div>
            )}

            {isStaleOdds && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--warn-bg)] border border-[var(--warn-bd)] text-xs">
                <Clock className="w-4 h-4 text-[var(--warn-tx)] shrink-0 mt-0.5 animate-pulse" />
                <div>
                  <h4 className="font-bold text-[var(--warn-tx)]">Stale Odds Warning ({freshnessSec}s elapsed)</h4>
                  <p className="text-[var(--tx)] mt-0.5">
                    No new bookmaker rate tick received for {freshnessSec} seconds. Rate updates may be paused between balls/overs.
                  </p>
                </div>
              </div>
            )}

            {isInvalidResponse && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--warn-bd)] text-xs">
                <ShieldAlert className="w-4 h-4 text-[var(--warn-tx)] shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-[var(--warn-tx)]">Market Suspended</h4>
                  <p className="text-[var(--mu)] mt-0.5">
                    Bookmaker rate is currently suspended (quoted rate: &quot;{bookmaker?.rawRateString || '0-0'}&quot;). Entry signals remain in standby until active back/lay rates are quoted.
                  </p>
                </div>
              </div>
            )}

            {isMatchEventsUnavailable && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--info-bd)] text-xs">
                <Info className="w-4 h-4 text-[var(--blut)] shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-[var(--tx)]">Scorecard Events Standing By</h4>
                  <p className="text-[var(--mu)] mt-0.5">
                    Live scorecard events (overs, wickets, balls) have not commenced yet. Strategy engine is standing by for active balls.
                  </p>
                </div>
              </div>
            )}
          </div>

          {oddsState?.status === 'loading' && !oddsState.odds ? (
            <div aria-busy="true" aria-label="Loading live odds" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 animate-pulse">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="p-4 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="h-3 w-20 rounded bg-[var(--bd)]" />
                    <div className="h-4 w-12 rounded bg-[var(--bd)]" />
                  </div>
                  <div className="h-8 w-16 rounded bg-[var(--bd)]" />
                  <div className="h-3 w-28 rounded bg-[var(--bd)]" />
                </div>
              ))}
            </div>
          ) : oddsState?.status === 'error' && !oddsState.odds ? (
            <div className="py-8 text-center bg-[var(--rds)] border border-[var(--rd)]/30 rounded-xl p-4">
              <AlertTriangle className="w-8 h-8 text-[var(--rdt)] mx-auto mb-2" />
              <p className="text-sm font-bold text-[var(--rdt)]">Failed to retrieve odds</p>
              <p className="text-xs text-[var(--mu)] mt-1">{oddsState.error || 'Network error'}</p>
            </div>
          ) : !bookmaker ? (
            <div className="py-8 text-center text-[var(--mu)] text-sm">
              <Info className="w-8 h-8 mx-auto mb-2 opacity-60" />
              No live bookmaker odds available for this match key at this time.
            </div>
          ) : (
            <div className="space-y-5">
              {/* Primary Odds Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {/* Back Price Card */}
                <div className="p-4 rounded-xl bg-[var(--blu)] border border-[var(--info-bd)]">
                  <div className="flex items-center justify-between text-xs text-[var(--blut)] font-semibold mb-1">
                    <span>BACK (LAGAI)</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--sf)] text-[var(--blut)]">
                      Dec: {bookmaker.decimalBack ?? '—'}
                    </span>
                  </div>
                  <div className="text-3xl font-bold text-[var(--blut)] tabular-nums">
                    {bookmaker.backRate !== null ? bookmaker.backRate : '—'}
                  </div>
                  <div className="text-xs text-[var(--mu)] mt-1 flex items-center justify-between">
                    <span>{oddsState?.odds?.favoriteTeamName || 'Favorite'}</span>
                    <span className="font-mono text-[11px]">Paise Rate</span>
                  </div>
                </div>

                {/* Lay Price Card */}
                <div className="p-4 rounded-xl bg-[var(--rds)] border border-[var(--rd)]/30">
                  <div className="flex items-center justify-between text-xs text-[var(--rdt)] font-semibold mb-1">
                    <span>LAY (KHAI)</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--sf)] text-[var(--rdt)]">
                      Dec: {bookmaker.decimalLay ?? '—'}
                    </span>
                  </div>
                  <div className="text-3xl font-bold text-[var(--rdt)] tabular-nums">
                    {bookmaker.layRate !== null ? bookmaker.layRate : '—'}
                  </div>
                  <div className="text-xs text-[var(--mu)] mt-1 flex items-center justify-between tabular-nums">
                    <span>Spread: {bookmaker.spread !== null ? `${bookmaker.spread} pt` : '—'}</span>
                    <span className="font-mono text-[11px]">Paise Rate</span>
                  </div>
                </div>

                {/* Previous vs Current Odds */}
                <div className="p-4 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
                  <div className="text-xs text-[var(--mu)] font-semibold mb-1.5">
                    PREVIOUS VS CURRENT
                  </div>
                  <div className="space-y-1.5 font-mono tabular-nums">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--mu)]">Current Rate:</span>
                      <span className="font-bold text-[var(--tx)] text-sm">
                        {bookmaker.rawRateString || '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--mu)]">Previous Rate:</span>
                      <span className="font-semibold text-[var(--mu)] text-sm">
                        {oddsState?.previousOdds?.bookmaker.rawRateString || 'First tick'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-[var(--bd)]">
                      <span className="text-[var(--mu)]">Total Updates:</span>
                      <span className="text-[var(--tx)] font-semibold">{oddsState?.recordsCount || 0}</span>
                    </div>
                  </div>
                </div>

                {/* Odds Movement */}
                <div className="p-4 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
                  <div className="text-xs text-[var(--mu)] font-semibold mb-1.5">
                    ODDS MOVEMENT
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {movement?.direction === 'up' ? (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)] text-xs font-bold">
                        <TrendingUp className="w-4 h-4" />
                        <span>DRIFTING UP (+{movement.deltaBack} pts)</span>
                      </div>
                    ) : movement?.direction === 'down' ? (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--rds)] text-[var(--rdt)] border border-[var(--rd)]/30 text-xs font-bold">
                        <TrendingDown className="w-4 h-4" />
                        <span>FIRMING DOWN ({movement.deltaBack} pts)</span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--sf)] text-[var(--mu)] border border-[var(--bd)] text-xs font-medium">
                        <Minus className="w-4 h-4" />
                        <span>STABLE (0 pts)</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--mu)] mt-2">
                    {bookmaker.isSuspended ? (
                      <span className="text-[var(--warn-tx)] font-semibold">Market suspended (0-0)</span>
                    ) : (
                      <span>Active trading market</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Sessions */}
              {sessions.length > 0 && (
                <div className="p-4 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--mu)]">
                      Session Lines (Fancy)
                    </span>
                    <span className="text-[11px] text-[var(--mu)] font-mono">
                      {sessions.length} market{sessions.length > 1 ? 's' : ''} available
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {sessions.map((sess, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg bg-[var(--sf)] border border-[var(--bd)] flex items-center justify-between"
                      >
                        <div>
                          <div className="text-[11px] text-[var(--mu)]">{sess.overs} Overs</div>
                          <div className="font-mono text-xs text-[var(--mu)]">{sess.rawString}</div>
                        </div>
                        <div className="text-right font-mono tabular-nums">
                          <div className="text-sm font-bold text-[var(--tx)]">
                            {sess.low} - {sess.high}
                          </div>
                          <div className="text-[10px] text-[var(--mu)]">Spread: {sess.spread}</div>
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
        {/* SECTION C: ENTRY/EXIT ANALYSIS                           */}
        {/* ======================================================== */}
        <section
          className="bg-[var(--sf)] border border-[var(--bd)] rounded-2xl p-4 sm:p-6 relative space-y-5"
          style={{ boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 border-b border-[var(--bd)] gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-2 h-2 rounded-full bg-[var(--warn-tx)]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--mu)]">
                Section C: Server Strategy Engine (Read-Only UI)
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)]">
                24/7 Server Evaluated
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetStrategyState}
                disabled={overridePending}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[var(--tx)] bg-[var(--sf-2)] border border-[var(--bd)] hover:bg-[var(--rds)] hover:text-[var(--rdt)] rounded-lg transition-colors disabled:opacity-50"
                title="Manual Override: Reset server strategy state for this match"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Manual Override: Reset</span>
              </button>
            </div>
          </div>

          {/* 4 Strategy Rule Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. FIRST-ENTRY STATUS */}
            <div className="p-4 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-[var(--ok-tx)]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--tx)]">
                      1. First-Entry Status
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {strategyState.firstEntryPosition.status === 'RECORDED_ENTRY' ||
                    strategyState.stage === 'ACTIVE_FIRST_ENTRY' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)]">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>ENTERED (HELD)</span>
                      </span>
                    ) : strategyState.stage === 'FIRST_BOOKSET_COMPLETED' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)]">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>BOOKSET SECURED</span>
                      </span>
                    ) : strategyState.stage === 'CONFIRMED_PENDING_85' ||
                      strategyState.firstEntryPosition.status === 'CANDIDATE_DETECTED' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--blu)] text-[var(--blut)] border border-[var(--info-bd)]">
                        <Clock className="w-3 h-3" />
                        <span>CANDIDATE (HELD)</span>
                      </span>
                    ) : (
                      renderStatusBadge(firstEntrySignal?.status)
                    )}
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        strategyState.firstEntryPosition.status === 'RECORDED_ENTRY' ||
                        strategyState.stage === 'ACTIVE_FIRST_ENTRY'
                          ? 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border-[var(--ok-bd)] font-bold'
                          : strategyState.firstEntryPosition.status === 'CANDIDATE_DETECTED' ||
                            strategyState.stage === 'CONFIRMED_PENDING_85'
                          ? 'bg-[var(--blu)] text-[var(--blut)] border-[var(--info-bd)]'
                          : 'bg-[var(--sf)] text-[var(--mu)] border-[var(--bd)]'
                      }`}
                    >
                      {strategyState.firstEntryPosition.status === 'RECORDED_ENTRY' ||
                      strategyState.stage === 'ACTIVE_FIRST_ENTRY'
                        ? 'RECORDED_ENTRY'
                        : strategyState.firstEntryPosition.status}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 mt-3 text-xs">
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--sf)] border border-[var(--bd)] font-mono">
                    <span className="text-[var(--mu)]">Qualifying Condition:</span>
                    <span className="text-[var(--tx)] font-semibold">BATTING &gt;= 85p</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--sf)] border border-[var(--bd)] font-mono tabular-nums">
                    <span className="text-[var(--mu)]">Control &amp; Odds:</span>
                    <span className="font-bold text-[var(--blut)]">
                      {controlInfo.teamInControl}{' '}
                      {controlInfo.currentPaise !== null
                        ? `${controlInfo.currentPaise}p (${bookmaker?.decimalBack?.toFixed(2) ?? (1 + controlInfo.currentPaise / 100).toFixed(2)})`
                        : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--sf)] border border-[var(--bd)]">
                    <span className="text-[var(--mu)]">Entry Window Limit:</span>
                    <span className="text-[var(--tx)] font-medium">
                      {match?.team2Score ? 'Inn 2 (< 6.0 ov)' : 'Inn 1 (< 10.0 ov)'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--sf)] border border-[var(--bd)] text-[11px] text-[var(--tx)]">
                    <span className="text-[var(--mu)] font-semibold">Engine Evaluation: </span>
                    {strategyState.stage === 'ACTIVE_FIRST_ENTRY' ||
                    strategyState.firstEntryPosition.status === 'RECORDED_ENTRY'
                      ? `FIRST ENTRY ACTIVE & HELD: Entered at ${strategyState.firstEntryTrade?.entryPaise ?? Math.round(((strategyState.firstEntryPosition.entryOdds ?? 1.85) - 1) * 100)} paise (${strategyState.firstEntryTrade?.entryDecimal?.toFixed(2) ?? strategyState.firstEntryPosition.entryOdds?.toFixed(2) ?? '1.85'}). Holding until pre-wicket BATTING <= 55p or Bookset (BOWLING > 85 paise).`
                      : strategyState.stage === 'FIRST_BOOKSET_COMPLETED' ||
                        strategyState.stage === 'FULL_BOOKSET_COMPLETED'
                      ? `FIRST ENTRY COMPLETED: Exited at ${strategyState.firstEntryTrade?.exitPaise ?? 86} paise (${strategyState.firstEntryTrade?.exitReason || 'BOOKSET'}). Position closed.`
                      : strategyState.stage === 'CONFIRMED_PENDING_85'
                      ? `CONFIRMED_PENDING_85 (${strategyState.bookingTeamName}): Entry boundary confirmed below 85p. Entering on first later ball with BATTING >= 85 paise inside window.`
                      : strategyState.stage === 'CONFIRMED_BOOKING_TEAM'
                      ? `BOOKING TEAM CONFIRMED (${strategyState.bookingTeamName}): Waiting for next 4 (>= 11p) or 6 (>= 18p) entry confirmation.`
                      : firstEntrySignal?.explanation || 'Awaiting tick evaluation'}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-[var(--bd)] flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="text-[11px] text-[var(--mu)] font-medium">
                    {strategyState.firstEntryPosition.status === 'RECORDED_ENTRY' ||
                    strategyState.stage === 'ACTIVE_FIRST_ENTRY'
                      ? `Entered @ ${strategyState.firstEntryTrade?.entryDecimal?.toFixed(2) ?? strategyState.firstEntryPosition.entryOdds} (${strategyState.firstEntryTrade?.entryPaise ?? Math.round(((strategyState.firstEntryPosition.entryOdds ?? 1.86) - 1) * 100)}p) • ${strategyState.firstEntryTrade?.entryWickets ?? strategyState.firstEntryPosition.entryWickets ?? 0} wkts`
                      : strategyState.firstEntryPosition.status === 'CANDIDATE_DETECTED'
                      ? 'Candidate signal qualified (manual override available)'
                      : 'Candidate signal only (trade not recorded)'}
                  </span>
                  <span className="text-[10px] text-[var(--mu)] flex items-center gap-1 mt-0.5">
                    <Database className="w-2.5 h-2.5 text-[var(--ok-tx)]" />
                    <span>
                      {strategyState.firstEntryTrade ? 'Saved in PostgreSQL strategy_trades' : 'Database Ready'}
                    </span>
                  </span>
                </div>
                {strategyState.firstEntryPosition.status !== 'RECORDED_ENTRY' &&
                strategyState.firstEntryPosition.status !== 'RECORDED_EXIT' &&
                strategyState.stage !== 'ACTIVE_FIRST_ENTRY' &&
                strategyState.stage !== 'ACTIVE_SECOND_ENTRY' &&
                strategyState.stage !== 'FIRST_BOOKSET_COMPLETED' &&
                strategyState.stage !== 'FULL_BOOKSET_COMPLETED' ? (
                  <button
                    type="button"
                    onClick={handleRecordFirstEntry}
                    disabled={!bookmaker?.decimalBack || overridePending}
                    className="px-2.5 py-1 text-xs font-semibold text-[var(--ok-tx)] bg-[var(--ok-bg)] border border-[var(--ok-bd)] rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                    title="Manual Override (saved on server)"
                  >
                    Manual Override: 1st Entry
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ok-tx)] bg-[var(--ok-bg)] px-2.5 py-1 rounded-lg border border-[var(--ok-bd)]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      {strategyState.firstEntryPosition.status === 'RECORDED_EXIT'
                        ? 'Bookset Completed'
                        : 'Active & Held'}
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* 2. SECOND-ENTRY STATUS */}
            <div className="p-4 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-[var(--blut)]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--tx)]">
                      2. Second-Entry Status
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {renderStatusBadge(secondEntrySignal?.status)}
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        strategyState.secondEntryPosition.status === 'RECORDED_ENTRY'
                          ? 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border-[var(--ok-bd)]'
                          : strategyState.secondEntryPosition.status === 'CANDIDATE_DETECTED'
                          ? 'bg-[var(--blu)] text-[var(--blut)] border-[var(--info-bd)]'
                          : 'bg-[var(--sf)] text-[var(--mu)] border-[var(--bd)]'
                      }`}
                    >
                      {strategyState.secondEntryPosition.status}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 mt-3 text-xs">
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--sf)] border border-[var(--bd)] font-mono tabular-nums">
                    <span className="text-[var(--mu)]">Wicket Dependency:</span>
                    <span
                      className={`font-semibold ${
                        strategyState.firstEntryPosition.status === 'RECORDED_ENTRY'
                          ? (activeScore?.wickets || 0) > (strategyState.firstEntryPosition.entryWickets || 0)
                            ? 'text-[var(--ok-tx)]'
                            : 'text-[var(--warn-tx)]'
                          : 'text-[var(--mu)]'
                      }`}
                    >
                      {strategyState.firstEntryPosition.status === 'RECORDED_ENTRY'
                        ? `Entry Wkts: ${strategyState.firstEntryPosition.entryWickets ?? 0} | Current: ${activeScore?.wickets || 0}`
                        : 'Requires prior 1st entry'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--sf)] border border-[var(--bd)] font-mono tabular-nums">
                    <span className="text-[var(--mu)]">Bowling Control Trigger:</span>
                    <span className="font-bold text-[var(--warn-tx)] text-right">
                      {controlInfo.teamInControl === 'BOWLING' && controlInfo.currentPaise !== null
                        ? `BOWLING ${controlInfo.currentPaise}p (< 65p target)`
                        : `${controlInfo.teamInControl} ${controlInfo.currentPaise !== null ? `${controlInfo.currentPaise}p` : '—'} (needs BOWLING < 65p)`}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--sf)] border border-[var(--bd)] text-[11px] text-[var(--tx)]">
                    <span className="text-[var(--mu)] font-semibold">Engine Evaluation: </span>
                    {secondEntrySignal?.explanation || 'Awaiting wicket & BOWLING < 65p'}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-[var(--bd)] flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-[var(--mu)]">
                  {strategyState.secondEntryPosition.status === 'RECORDED_ENTRY' ||
                  strategyState.secondEntryPosition.status === 'RECORDED_EXIT'
                    ? `2nd Entered @ ${strategyState.secondEntryTrade?.entryDecimal?.toFixed(2) ?? strategyState.secondEntryPosition.entryOdds ?? '—'} (${strategyState.secondEntryTrade?.entryPaise ?? Math.round(((strategyState.secondEntryPosition.entryOdds ?? 1) - 1) * 100)}p) • ${strategyState.secondEntryTrade?.entryOver ?? strategyState.secondEntryPosition.entryOver ?? '—'} ov`
                    : 'Server monitoring automatic 2nd entry'}
                </span>
                {strategyState.secondEntryPosition.status !== 'RECORDED_ENTRY' &&
                  strategyState.secondEntryPosition.status !== 'RECORDED_EXIT' && (
                    <button
                      type="button"
                      onClick={handleRecordSecondEntry}
                      disabled={(!controlInfo.decimalOdds && !bookmaker?.decimalBack) || overridePending}
                      className="px-2.5 py-1 text-xs font-semibold text-[var(--blut)] bg-[var(--blu)] border border-[var(--info-bd)] rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                      title="Manual Override (saved on server)"
                    >
                      Manual Override: 2nd Entry
                    </button>
                  )}
              </div>
            </div>

            {/* 3. BOOKSET / EXIT STATUS */}
            <div className="p-4 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[var(--purple-tx)]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--tx)]">
                      3. Bookset / Exit Status
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {renderStatusBadge((secondBooksetSignal || (firstExit55Signal?.status === 'PASS' ? firstExit55Signal : firstBooksetSignal))?.status)}
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--sf)] border border-[var(--bd)] text-[var(--mu)]">
                      {strategyState.firstEntryPosition.status === 'RECORDED_EXIT' ? 'EXITED' : 'MONITORING'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 mt-3 text-xs">
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--sf)] border border-[var(--bd)] font-mono">
                    <span className="text-[var(--mu)]">Exit Rules:</span>
                    <span className="text-[var(--purple-tx)] font-semibold text-right">
                      BATTING &lt;= 55p (no wkt) | BOWLING &gt; 85p
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--sf)] border border-[var(--bd)] font-mono tabular-nums">
                    <span className="text-[var(--mu)]">Current Control Odds:</span>
                    <span className="text-[var(--purple-tx)] font-semibold">
                      {controlInfo.teamInControl}{' '}
                      {controlInfo.currentPaise !== null ? `${controlInfo.currentPaise}p` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--sf)] border border-[var(--bd)]">
                    <span className="text-[var(--mu)]">Window Continuity:</span>
                    <span className="text-[var(--ok-tx)] font-medium text-right">
                      Exits continuously monitored after window closes
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--sf)] border border-[var(--bd)] text-[11px] text-[var(--tx)]">
                    <span className="text-[var(--mu)] font-semibold">Bookset Target: </span>
                    {(secondBooksetSignal || (firstExit55Signal?.status === 'PASS' ? firstExit55Signal : firstBooksetSignal))?.explanation || 'Waiting for BATTING <= 55p (no wicket) or BOWLING > 85p'}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-[var(--bd)] flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-[var(--mu)]">
                  {strategyState.firstEntryPosition.status === 'RECORDED_EXIT'
                    ? `Exited @ ${strategyState.firstEntryTrade?.exitDecimal?.toFixed(2) ?? strategyState.firstEntryPosition.exitOdds ?? '—'} (${strategyState.firstEntryTrade?.exitOver ?? strategyState.firstEntryPosition.exitOver ?? '—'} ov)`
                    : 'Awaiting automatic server exit'}
                </span>
                {strategyState.firstEntryPosition.status === 'RECORDED_ENTRY' && (
                  <button
                    type="button"
                    onClick={handleRecordFirstExit}
                    disabled={!bookmaker?.decimalLay || overridePending}
                    className="px-2.5 py-1 text-xs font-semibold text-[var(--purple-tx)] bg-[var(--purple-bg)] border border-[var(--purple-bd)] rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                    title="Manual Override (saved on server)"
                  >
                    Manual Override: Exit
                  </button>
                )}
              </div>
            </div>

            {/* 4. ABNORMAL ACTIVITY STATUS */}
            <div className="p-4 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-[var(--warn-tx)]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--tx)]">
                      4. Abnormal Activity Status
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--sf)] border border-[var(--bd)] text-[var(--tx)] tabular-nums">
                    Trigger Count: {strategyState.abnormalActivityCount}
                  </span>
                </div>

                <div className="space-y-2 mt-3 text-xs">
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--sf)] border border-[var(--bd)] font-mono">
                    <span className="text-[var(--mu)]">Four Boundary Shift Rule:</span>
                    <span className="font-semibold text-[var(--tx)]">
                      Must be &gt;= 0.11 (&lt;= 0.10 fails)
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--sf)] border border-[var(--bd)] font-mono">
                    <span className="text-[var(--mu)]">Six Boundary Shift Rule:</span>
                    <span className="font-semibold text-[var(--tx)]">
                      Must be &gt;= 0.18 (&lt;= 0.17 fails)
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--sf)] border border-[var(--bd)] text-[11px] text-[var(--tx)]">
                    <span className="text-[var(--mu)] font-semibold">Latest Evaluation: </span>
                    {abnormalSignal?.explanation || 'No boundary trigger evaluated yet'}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-[var(--bd)] flex items-center justify-between text-[11px] text-[var(--mu)]">
                <span>Booking Team: <strong className="text-[var(--tx)]">{strategyState.bookingTeamName || 'Pending 1st boundary'}</strong></span>
                <span className="font-mono text-[var(--ok-tx)] font-medium">Server Auto-Eval (1s)</span>
              </div>
            </div>
          </div>

          {/* Structured Signal History Log */}
          <div className="p-4 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-3 border-b border-[var(--bd)] gap-2">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-[var(--ok-tx)]" />
                <span className="font-bold uppercase tracking-wider text-[var(--tx)] text-xs">
                  Strategy Signals Log ({signals.length} evaluations)
                </span>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                <button
                  type="button"
                  onClick={() => setSignalFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    signalFilter === 'all'
                      ? 'bg-[var(--rd)] text-white'
                      : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--mu)] hover:text-[var(--tx)]'
                  }`}
                >
                  All ({signals.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSignalFilter('candidates')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    signalFilter === 'candidates'
                      ? 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)]'
                      : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--mu)] hover:text-[var(--tx)]'
                  }`}
                >
                  Candidates &amp; Exits ({candidatesCount})
                </button>
                <button
                  type="button"
                  onClick={() => setSignalFilter('rejected')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    signalFilter === 'rejected'
                      ? 'bg-[var(--rds)] text-[var(--rdt)] border border-[var(--rd)]/35'
                      : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--mu)] hover:text-[var(--tx)]'
                  }`}
                >
                  Rejected ({rejectedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setSignalFilter('events')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    signalFilter === 'events'
                      ? 'bg-[var(--blu)] text-[var(--blut)] border border-[var(--info-bd)]'
                      : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--mu)] hover:text-[var(--tx)]'
                  }`}
                >
                  Wickets &amp; Activity ({eventsCount})
                </button>
              </div>
            </div>

            {filteredSignals.length === 0 ? (
              <div className="py-8 text-center text-[var(--mu)] text-xs italic">
                {signalFilter === 'all'
                  ? 'Signals will appear as live match ticks are processed by the strategy engine.'
                  : `No signals matching the "${signalFilter}" filter yet.`}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-[var(--bd)] bg-[var(--sf)]">
                <table className="w-full text-xs font-mono text-left">
                  <thead className="text-[11px] text-[var(--mu)] bg-[var(--sf-2)] border-b border-[var(--bd)]">
                    <tr>
                      <th className="py-2 px-2.5">Timestamp</th>
                      <th className="py-2 px-2.5">Signal Type</th>
                      <th className="py-2 px-2.5">Over</th>
                      <th className="py-2 px-2.5">Odds / Shift</th>
                      <th className="py-2 px-2.5">Status</th>
                      <th className="py-2 px-2.5">Reason &amp; Evaluation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--bd)]">
                    {filteredSignals.slice(0, 30).map((sig) => (
                      <tr key={sig.id} className="hover:bg-[var(--sf-2)] transition-colors">
                        <td className="py-2 px-2.5 text-[var(--mu)] whitespace-nowrap tabular-nums">
                          {new Date(sig.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                sig.signalType === 'WICKET_EVENT'
                                  ? 'bg-[var(--purple-bg)] text-[var(--purple-tx)] border-[var(--purple-bd)]'
                                  : sig.signalType.startsWith('ABNORMAL')
                                  ? 'bg-[var(--warn-bg)] text-[var(--warn-tx)] border-[var(--warn-bd)]'
                                  : sig.status === 'PASS'
                                  ? 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border-[var(--ok-bd)]'
                                  : 'bg-[var(--sf-2)] text-[var(--tx)] border-[var(--bd)]'
                              }`}
                            >
                              {sig.signalType.replace(/_/g, ' ')}
                            </span>
                            {(sig.metadata?.isManual || sig.metadata?.source === 'MANUAL') && (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--warn-bg)] text-[var(--warn-tx)] border border-[var(--warn-bd)]">
                                MANUAL
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2.5 text-[var(--mu)] whitespace-nowrap tabular-nums">
                          Inn {sig.currentInnings} • {sig.currentOver} ov
                        </td>
                        <td className="py-2 px-2.5 text-[var(--blut)] whitespace-nowrap tabular-nums">
                          {sig.relevantOdds.decimalOdds
                            ? sig.relevantOdds.decimalOdds.toFixed(2)
                            : sig.relevantOdds.opposingTeamOdds
                            ? `Opp: ${sig.relevantOdds.opposingTeamOdds.toFixed(2)}`
                            : sig.relevantOdds.oddsDelta !== undefined && sig.relevantOdds.oddsDelta !== null
                            ? `Δ ${sig.relevantOdds.oddsDelta.toFixed(2)}`
                            : '—'}
                          {sig.relevantOdds.isStale && (
                            <span className="ml-1 text-[9px] text-[var(--warn-tx)] font-bold px-1 rounded bg-[var(--warn-bg)]">
                              STALE
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">{renderStatusBadge(sig.status)}</td>
                        <td className="py-2 px-2.5 text-[var(--tx)] max-w-[360px]" title={sig.explanation}>
                          <p className="line-clamp-2 leading-relaxed">{sig.explanation}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Append-Only Saved Timeline History (Ball 1 to Now) */}
          <div className="p-4 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-3 border-b border-[var(--bd)] gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Database className="w-4 h-4 text-[var(--blut)]" />
                <span className="font-bold uppercase tracking-wider text-[var(--tx)] text-xs">
                  Saved Match Timeline History ({legalBallsSavedCount} balls • {timelineTicks.length} 1s ticks)
                </span>
                {missedTicks > 0 && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--rds)] text-[var(--rdt)] border border-[var(--rd)]/30">
                    Missed Ticks: {missedTicks}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setTimelineMode('balls')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    timelineMode === 'balls'
                      ? 'bg-[var(--blu)] text-[var(--blut)] border border-[var(--info-bd)]'
                      : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--mu)] hover:text-[var(--tx)]'
                  }`}
                >
                  Ball-by-Ball ({legalBallsSavedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setTimelineMode('ticks')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    timelineMode === 'ticks'
                      ? 'bg-[var(--rd)] text-white'
                      : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--mu)] hover:text-[var(--tx)]'
                  }`}
                >
                  All 1s Ticks ({timelineTicks.length})
                </button>
              </div>
            </div>

            {isLoadingHistory && timelineTicks.length === 0 ? (
              <div aria-busy="true" aria-label="Loading saved timeline history" className="space-y-2 py-2 animate-pulse">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-8 w-full rounded-lg bg-[var(--sf)] border border-[var(--bd)] px-3 flex items-center gap-3">
                    <div className="h-3 w-14 rounded bg-[var(--sf-2)]" />
                    <div className="h-3 w-24 rounded bg-[var(--sf-2)]" />
                    <div className="h-3 w-16 rounded bg-[var(--sf-2)]" />
                    <div className="h-3 flex-1 rounded bg-[var(--sf-2)]" />
                  </div>
                ))}
              </div>
            ) : displayedTimelineRows.length === 0 ? (
              <div className="py-6 text-center text-[var(--mu)] text-xs italic">
                No saved timeline ticks in PostgreSQL yet for this match.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-lg border border-[var(--bd)] bg-[var(--sf)]">
                <table className="w-full text-xs font-mono text-left">
                  <thead className="text-[11px] text-[var(--mu)] border-b border-[var(--bd)] sticky top-0 bg-[var(--sf-2)]">
                    <tr>
                      <th className="py-2 px-2">Time</th>
                      <th className="py-2 px-2">Inn / Ov</th>
                      <th className="py-2 px-2">Score</th>
                      <th className="py-2 px-2">Control / Fav</th>
                      <th className="py-2 px-2">Back / Lay</th>
                      <th className="py-2 px-2">Raw</th>
                      <th className="py-2 px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--bd)]">
                    {displayedTimelineRows.slice(0, 100).map((t) => (
                      <tr key={t.id} className="hover:bg-[var(--sf-2)] transition-colors">
                        <td className="py-1.5 px-2 text-[var(--mu)] whitespace-nowrap tabular-nums">
                          {new Date(t.recorded_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td className="py-1.5 px-2 text-[var(--tx)] whitespace-nowrap tabular-nums">
                          Inn {t.innings} • {t.overs} ({t.legal_ball_count}b)
                        </td>
                        <td className="py-1.5 px-2 text-[var(--tx)] font-semibold whitespace-nowrap tabular-nums">
                          {t.runs}/{t.wickets}
                          {t.is_new_ball && t.runs_on_ball > 0 && (
                            <span className="ml-1.5 text-[10px] px-1 rounded bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)]">
                              +{t.runs_on_ball}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-[var(--tx)] whitespace-nowrap">
                          <span className={t.control === 'BATTING' ? 'text-[var(--ok-tx)] font-semibold' : t.control === 'BOWLING' ? 'text-[var(--warn-tx)] font-semibold' : 'text-[var(--mu)]'}>
                            {t.control}
                          </span>
                          {t.favorite_team ? ` (${t.favorite_team})` : ''}
                        </td>
                        <td className="py-1.5 px-2 text-[var(--blut)] whitespace-nowrap tabular-nums">
                          {t.back_rate !== null ? `${t.back_rate}/${t.lay_rate ?? '—'}` : '—'}
                          {t.decimal_back !== null ? ` (${Number(t.decimal_back).toFixed(2)})` : ''}
                        </td>
                        <td className="py-1.5 px-2 text-[var(--mu)] whitespace-nowrap">
                          {t.raw_rate_string || '—'}
                        </td>
                        <td className="py-1.5 px-2 text-[var(--mu)] whitespace-nowrap">
                          {t.result_text || t.match_status}
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

