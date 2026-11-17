import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  fetchCrexTopMatches,
  playAlertSound,
  isAllowedTournament,
  registerDynamicMapping,
  transformCrexMatch,
} from './services/cricketApi';
import { ParsedCricketMatch, RawApiResponse } from './types/cricket';
import { MatchOddsState } from './types/odds';
import { Navbar } from './components/Navbar';
import { StatsHeader } from './components/StatsHeader';
import { FilterBar } from './components/FilterBar';
import { MatchCard } from './components/MatchCard';
import { MatchDetailModal } from './components/MatchDetailModal';
import { OnlineScriptModal } from './components/OnlineScriptModal';
import { ApiInspectorModal } from './components/ApiInspectorModal';
import { TelegramBotModal } from './components/TelegramBotModal';
import { OddsDiagnosticModal } from './components/OddsDiagnosticModal';
import { MatchAnalysisPage } from './components/MatchAnalysisPage';
import { EntryPossibilitiesModal } from './components/EntryPossibilitiesModal';
import { useOddsManager } from './hooks/useOddsManager';
import { strategyEngine, calculateOpposingOdds, isWithinEntryWindow } from './services/strategy/engine';
import { SerializedMatchStrategyState } from './services/strategy/types';
import {
  TelegramConfig,
  getStoredTelegramConfig,
  saveStoredTelegramConfig,
  sendTelegramMessage,
  formatWicketAlert,
  formatResultAlert,
  formatScoreboardDigest,
} from './services/telegramService';
import {
  migrateLocalStorageToSupabase,
  fetchMatchesFromSupabase,
  checkAndRecordMatchConclusionInDb,
  fetchRecordedFirstEntriesFromDb,
  fetchStrategyTradesFromDb,
  fetchServerStrategyStates,
} from './services/supabaseSyncService';
import {
  Radio,
  AlertTriangle,
  RefreshCw,
  Terminal,
  Code2,
  Info,
  Zap,
  Send,
  Target,
} from 'lucide-react';

export default function App() {
  const [matches, setMatches] = useState<ParsedCricketMatch[]>([]);
  const [rawData, setRawData] = useState<RawApiResponse | null>(null);
  const [isFetching, setIsFetching] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number>(8);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [tickCounter, setTickCounter] = useState<number>(0);

  // Configuration - 1-second live tick rate
  const [countryCode, setCountryCode] = useState<string>('IN');
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(1); // 1s live rate
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Filters
  const [activeTab, setActiveTab] = useState<'all' | 'live' | 'upcoming' | 'completed'>('all');
  const [selectedFormat, setSelectedFormat] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [selectedMatch, setSelectedMatch] = useState<ParsedCricketMatch | null>(null);
  const [isScriptModalOpen, setIsScriptModalOpen] = useState<boolean>(false);
  const [isInspectorModalOpen, setIsInspectorModalOpen] = useState<boolean>(false);
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState<boolean>(false);
  const [isOddsDiagnosticOpen, setIsOddsDiagnosticOpen] = useState<boolean>(false);
  const [isEntryRadarOpen, setIsEntryRadarOpen] = useState<boolean>(false);

  // Authoritative Server SSE State (Read-only browser mirror)
  const [allServerMatches, setAllServerMatches] = useState<ParsedCricketMatch[]>([]);
  const [serverOddsByMatch, setServerOddsByMatch] = useState<Record<string, MatchOddsState>>({});
  const [strategyVersion, setStrategyVersion] = useState<number>(0);
  const [isSseConnected, setIsSseConnected] = useState<boolean>(false);
  const [recordedFirstEntries, setRecordedFirstEntries] = useState<Set<string>>(new Set());

  const applyServerStrategyStates = useCallback(
    (states?: Record<string, SerializedMatchStrategyState>) => {
      if (!states || typeof states !== 'object') return;
      const firstEntryIds = new Set<string>();
      for (const [mId, snap] of Object.entries(states)) {
        if (!snap) continue;
        strategyEngine.hydrateState(mId, snap);
        if (
          snap.firstEntryTrade ||
          snap.stage === 'ACTIVE_FIRST_ENTRY' ||
          snap.stage === 'FIRST_BOOKSET_COMPLETED' ||
          snap.stage === 'ACTIVE_SECOND_ENTRY' ||
          snap.stage === 'FULL_BOOKSET_COMPLETED' ||
          snap.firstEntryPosition?.status === 'RECORDED_ENTRY' ||
          snap.firstEntryPosition?.status === 'RECORDED_EXIT'
        ) {
          firstEntryIds.add(mId);
        }
      }
      if (firstEntryIds.size > 0) {
        setRecordedFirstEntries((prev) => new Set([...prev, ...firstEntryIds]));
      }
      setStrategyVersion((v) => v + 1);
    },
    []
  );

  // Rehydrate persisted strategy states & trades from PostgreSQL on mount
  useEffect(() => {
    fetchServerStrategyStates()
      .then((res) => {
        if (res?.states) applyServerStrategyStates(res.states);
      })
      .catch(() => {});

    fetchStrategyTradesFromDb()
      .then((trades) => {
        if (trades && trades.length > 0) {
          const matchIds = new Set<string>();
          for (const t of trades) {
            matchIds.add(t.matchId);
            const state = strategyEngine.getState(t.matchId);
            if (t.entryType === 'FIRST_ENTRY') {
              state.firstEntryTrade = t;
              if (!state.bookingTeamName) state.bookingTeamName = t.bookingTeam;
              if (t.status === 'ACTIVE') {
                if (state.stage === 'WAITING_FOR_CONFIRMATION') state.stage = 'ACTIVE_FIRST_ENTRY';
                state.firstEntryPosition.status = 'RECORDED_ENTRY';
                state.firstEntryPosition.entryOdds = t.entryDecimal;
                state.firstEntryPosition.entryOver = t.entryOver;
                state.firstEntryPosition.entryInnings = t.innings;
                state.firstEntryPosition.entryWickets = t.entryWickets;
                state.firstEntryPosition.entryTimestamp = t.entryTime;
              } else if (t.status === 'BOOKSET_COMPLETED') {
                if (
                  state.stage === 'WAITING_FOR_CONFIRMATION' ||
                  state.stage === 'ACTIVE_FIRST_ENTRY'
                ) {
                  state.stage = 'FIRST_BOOKSET_COMPLETED';
                }
                state.firstEntryPosition.status = 'RECORDED_EXIT';
                state.firstEntryPosition.exitOdds = t.exitDecimal;
                state.firstEntryPosition.exitOver = t.exitOver;
                state.firstEntryPosition.exitTimestamp = t.exitTime;
              }
            } else if (t.entryType === 'SECOND_ENTRY') {
              state.secondEntryTrade = t;
              if (t.status === 'ACTIVE') {
                state.stage = 'ACTIVE_SECOND_ENTRY';
                state.secondEntryPosition.status = 'RECORDED_ENTRY';
                state.secondEntryPosition.entryOdds = t.entryDecimal;
                state.secondEntryPosition.entryOver = t.entryOver;
                state.secondEntryPosition.entryInnings = t.innings;
                state.secondEntryPosition.entryWickets = t.entryWickets;
                state.secondEntryPosition.entryTimestamp = t.entryTime;
              } else if (t.status === 'BOOKSET_COMPLETED') {
                state.stage = 'FULL_BOOKSET_COMPLETED';
                state.secondEntryPosition.status = 'RECORDED_EXIT';
                state.secondEntryPosition.exitOdds = t.exitDecimal;
                state.secondEntryPosition.exitOver = t.exitOver;
                state.secondEntryPosition.exitTimestamp = t.exitTime;
              }
            }
          }
          setRecordedFirstEntries((prev) => new Set([...prev, ...matchIds]));
          setStrategyVersion((v) => v + 1);
        }
      })
      .catch(() => {});
  }, [applyServerStrategyStates]);

  // Phase 5 Routing: Dedicated Match Analysis View
  const [activeAnalysisMatchId, setActiveAnalysisMatchId] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && window.location.hash.startsWith('#/match/')) {
      return window.location.hash.replace('#/match/', '').trim() || null;
    }
    return null;
  });

  // Listen to hash changes for browser forward/back buttons and deep links
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#/match/')) {
        const id = hash.replace('#/match/', '').trim();
        setActiveAnalysisMatchId(id || null);
      } else {
        setActiveAnalysisMatchId(null);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigateToAnalysis = useCallback((matchId: string) => {
    setActiveAnalysisMatchId(matchId);
    window.location.hash = `#/match/${matchId}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const navigateToDashboard = useCallback(() => {
    setActiveAnalysisMatchId(null);
    window.location.hash = '';
  }, []);

  // Phase 4 + Phase 2: Per-Match Isolated Odds Manager (hydrated via Server SSE)
  const {
    oddsByMatchId,
    getMatchOdds,
    refreshMatchOdds,
    refreshAllOdds,
    isGlobalRefreshing,
    totalRecordsReceived,
  } = useOddsManager(matches, serverOddsByMatch);

  // Telegram Bot Configuration
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig>(getStoredTelegramConfig);
  const lastDigestTimeRef = useRef<number>(Date.now());
  const finishedMatchesRef = useRef<Set<string>>(new Set());
  const isFirstFetchRef = useRef<boolean>(true);

  const [secondsRemaining, setSecondsRemaining] = useState<number>(1);
  const inFlightRef = useRef<boolean>(false);

  // Previous scores memory to detect live changes (runs / wickets)
  const previousScoresRef = useRef<Record<string, { runs: number; wickets: number }>>({});

  // Core Data Fetcher: Executed every second
  const loadMatches = useCallback(
    async (silent = false, customCc?: string) => {
      if (inFlightRef.current && silent) return;
      inFlightRef.current = true;

      const cc = customCc || countryCode;
      if (!silent) setIsFetching(true);
      setError(null);

      try {
        const result = await fetchCrexTopMatches(cc);
        setRawData(result.raw);
        setLatencyMs(result.latencyMs);
        setLastUpdated(new Date());
        setTickCounter((prev) => prev + 1);

        // On first discovery: pre-seed existing completed matches so historical results are not spammed
        if (isFirstFetchRef.current) {
          result.matches.forEach((m) => {
            if (m.status === 'completed') {
              finishedMatchesRef.current.add(m.id);
            }
          });
          isFirstFetchRef.current = false;
        }

        // Detect score changes for audio chime alerts & Telegram alerts
        let scoreChanged = false;
        let wicketFell = false;

        result.matches.forEach((m) => {
          if (m.status === 'live') {
            const activeScore = m.team2Score || m.team1Score;
            if (activeScore) {
              const prev = previousScoresRef.current[m.id];
              if (prev) {
                if (activeScore.wickets > prev.wickets) {
                  wicketFell = true;

                  // Telegram Wicket Alert
                  if (
                    telegramConfig.enabled &&
                    telegramConfig.botToken &&
                    telegramConfig.chatId &&
                    telegramConfig.notifyWickets
                  ) {
                    const battingTeam = m.battingTeamKey === m.team2.key ? m.team2.shortName : m.team1.shortName;
                    const alertHtml = formatWicketAlert(
                      m,
                      battingTeam,
                      activeScore.runs,
                      activeScore.wickets,
                      activeScore.overs
                    );
                    sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, alertHtml);
                  }
                } else if (activeScore.runs > prev.runs) {
                  scoreChanged = true;
                }
              }
              previousScoresRef.current[m.id] = {
                runs: activeScore.runs,
                wickets: activeScore.wickets,
              };
            }
          }

          // Telegram Match Result Alert (Database Verified & Deduplicated)
          if (
            m.status === 'completed' &&
            telegramConfig.enabled &&
            telegramConfig.botToken &&
            telegramConfig.chatId &&
            telegramConfig.notifyResults &&
            !finishedMatchesRef.current.has(m.id)
          ) {
            finishedMatchesRef.current.add(m.id);
            // Verify in Supabase DB before dispatching to eliminate multi-tab/refresh duplicates
            checkAndRecordMatchConclusionInDb(m.id, {
              team1: m.team1.name,
              team2: m.team2.name,
              result: m.resultText || m.statusLabel,
              seriesName: m.seriesName,
            }).then((allowed) => {
              if (allowed) {
                const resultHtml = formatResultAlert(m);
                sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, resultHtml);
              }
            });
          }
        });

        // Telegram Periodic Scoreboard Digest
        if (
          telegramConfig.enabled &&
          telegramConfig.botToken &&
          telegramConfig.chatId &&
          telegramConfig.notifyPeriodicDigest &&
          Date.now() - lastDigestTimeRef.current >= telegramConfig.digestIntervalMinutes * 60 * 1000
        ) {
          lastDigestTimeRef.current = Date.now();
          const digestHtml = formatScoreboardDigest(result.matches);
          sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, digestHtml);
        }

        if (soundEnabled && silent) {
          if (wicketFell) {
            playAlertSound('wicket');
          } else if (scoreChanged) {
            playAlertSound('boundary');
          }
        }

        // Strictly filter to WBBL 2026 and Abu Dhabi T10 2026 matches only for dashboard grid
        const allParsed = Object.entries(result.raw || {})
          .filter(([_, m]) => m && typeof m === 'object' && m.b && m.c)
          .map(([id, m]) => transformCrexMatch(id, m));
        if (allParsed.length > 0) {
          setAllServerMatches(allParsed);
        }
        const allowedMatches = result.matches.filter(isAllowedTournament);
        setMatches([...allowedMatches]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch Crex matches';
        setError(msg);
      } finally {
        inFlightRef.current = false;
        setIsFetching(false);
      }
    },
    [countryCode, soundEnabled, telegramConfig]
  );

  // Real-time Entry Opportunities Count for Navbar Radar Badge
  const entryOpportunitiesCount = useMemo(() => {
    let count = 0;
    const liveMatches = matches.filter(
      (m) => m.status === 'live' || (m.status !== 'completed' && (m.team1Score || m.team2Score))
    );
    for (const m of liveMatches) {
      const oddsState = oddsByMatchId[m.id];
      const decimalOdds =
        oddsState?.odds?.bookmaker?.decimalBack ??
        oddsState?.odds?.bookmaker?.decimalLay ??
        null;
      const opposingOdds = decimalOdds ? calculateOpposingOdds(decimalOdds) : null;
      const activeScore = m.team2Score || m.team1Score;
      const currentInnings = m.team2Score ? 2 : 1;
      const currentOver = activeScore ? activeScore.overs : 0;
      const inWindow = isWithinEntryWindow(currentInnings, currentOver);

      // First entry criteria: [1.85, 2.00] in window
      if (decimalOdds !== null && decimalOdds >= 1.85 && decimalOdds <= 2.0 && inWindow) {
        count++;
        continue;
      }

      // Second entry criteria: STRICT REQUIREMENT: MUST HAVE 1ST ENTRY
      const hasFirst = recordedFirstEntries.has(m.id);
      if (hasFirst && opposingOdds && opposingOdds < 1.65 && inWindow) {
        count++;
      }
    }
    return count;
  }, [matches, oddsByMatchId, recordedFirstEntries, strategyVersion]);

  // Initial load: Migrate local data, populate from PostgreSQL, then fetch fresh feed
  useEffect(() => {
    // 1. Migrate any existing local data
    migrateLocalStorageToSupabase().catch(() => {});

    // 2. Hydrate matches from PostgreSQL if available
    fetchMatchesFromSupabase().then((savedMatches) => {
      if (savedMatches.length > 0) {
        setMatches((prev) => (prev.length === 0 ? savedMatches : prev));
        setAllServerMatches((prev) => (prev.length === 0 ? savedMatches : prev));
      }
    }).catch(() => {});

    // 3. Hydrate strategy recorded 1st entries from PostgreSQL
    fetchRecordedFirstEntriesFromDb().then((entries) => {
      if (entries.size > 0) {
        setRecordedFirstEntries((prev) => new Set([...prev, ...entries]));
      }
    }).catch(() => {});

    // 4. Initiate baseline load
    loadMatches(false);
  }, [loadMatches]);

  // Authoritative SSE Stream from server.ts (browser stays read-only & synced across all devices)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    const eventSource = new EventSource('/api/live-stream');

    eventSource.onopen = () => {
      setIsSseConnected(true);
      setIsFetching(false);
    };

    eventSource.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data);
        if (payload.mapping) {
          registerDynamicMapping(payload.mapping);
        }
        if (payload.matches && typeof payload.matches === 'object') {
          setRawData(payload.matches);
          const allParsed: ParsedCricketMatch[] = [];
          for (const [id, rawItem] of Object.entries(payload.matches)) {
            if (rawItem && typeof rawItem === 'object' && (rawItem as any).b && (rawItem as any).c) {
              allParsed.push(transformCrexMatch(id, rawItem as any));
            }
          }
          if (allParsed.length > 0) {
            setAllServerMatches(allParsed);
            const allowed = allParsed.filter(isAllowedTournament);
            allowed.sort((a, b) => {
              const prio = { live: 0, upcoming: 1, completed: 2 };
              if (prio[a.status] !== prio[b.status]) return prio[a.status] - prio[b.status];
              return b.startTime.getTime() - a.startTime.getTime();
            });
            setMatches(allowed);
          }
          setLastUpdated(new Date());
          setTickCounter((prev) => prev + 1);
          setIsFetching(false);
        }
        if (payload.oddsByMatch && typeof payload.oddsByMatch === 'object') {
          setServerOddsByMatch(payload.oddsByMatch);
        }
        if (payload.strategyStates && typeof payload.strategyStates === 'object') {
          applyServerStrategyStates(payload.strategyStates);
        }
      } catch {
        // Ignore malformed heartbeat/SSE chunks
      }
    };

    eventSource.onerror = () => {
      setIsSseConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [applyServerStrategyStates]);

  // Active 1-Second Fallback Engine (runs polling only when SSE isn't streaming or custom CC selected)
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;

    let countdown = autoRefreshInterval;
    setSecondsRemaining(countdown);

    const timer = setInterval(() => {
      countdown -= 1;
      if (countdown <= 0) {
        countdown = autoRefreshInterval;
        if (!isSseConnected || countryCode !== 'IN') {
          loadMatches(true);
        }
      }
      setSecondsRemaining(countdown);
    }, 1000);

    return () => clearInterval(timer);
  }, [autoRefreshInterval, loadMatches, isSseConnected, countryCode]);

  // Filtered Matches
  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      if (activeTab === 'live' && m.status !== 'live') return false;
      if (activeTab === 'upcoming' && m.status !== 'upcoming') return false;
      if (activeTab === 'completed' && m.status !== 'completed') return false;

      if (selectedFormat !== 'All') {
        const fmt = m.format.toLowerCase();
        const sel = selectedFormat.toLowerCase();
        if (!fmt.includes(sel)) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchText = `${m.team1.name} ${m.team1.shortName} ${m.team2.name} ${m.team2.shortName} ${m.seriesName} ${m.venueName}`.toLowerCase();
        if (!matchText.includes(q)) return false;
      }

      return true;
    });
  }, [matches, activeTab, selectedFormat, searchQuery]);

  const liveMatchesCount = matches.filter((m) => m.status === 'live').length;

  // Dedicated Match Analysis View (Phase 5)
  if (activeAnalysisMatchId) {
    const analysisMatch =
      matches.find((m) => m.id === activeAnalysisMatchId) ||
      allServerMatches.find((m) => m.id === activeAnalysisMatchId);
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
        <MatchAnalysisPage
          matchId={activeAnalysisMatchId}
          match={analysisMatch}
          oddsState={getMatchOdds(activeAnalysisMatchId)}
          allMatches={matches.length > 0 ? matches : allServerMatches}
          strategyVersion={strategyVersion}
          onStrategyStateSync={(snap) => applyServerStrategyStates({ [activeAnalysisMatchId]: snap })}
          onBack={navigateToDashboard}
          onSelectMatch={navigateToAnalysis}
          onRefreshOdds={refreshMatchOdds}
        />

        {/* Match Details Scorecard Modal if triggered */}
        <MatchDetailModal
          match={selectedMatch}
          onClose={() => setSelectedMatch(null)}
        />

        {/* Standalone Online Script Generator Modal */}
        <OnlineScriptModal
          isOpen={isScriptModalOpen}
          onClose={() => setIsScriptModalOpen(false)}
          countryCode={countryCode}
        />

        {/* API Inspector & Payload Test Modal */}
        <ApiInspectorModal
          isOpen={isInspectorModalOpen}
          onClose={() => setIsInspectorModalOpen(false)}
          initialPayload={`{"cc":"${countryCode}"}`}
          rawData={rawData}
          onPayloadSend={async (newCc) => {
            setCountryCode(newCc);
            await loadMatches(false, newCc);
          }}
          isFetching={isFetching}
          latencyMs={latencyMs}
        />

        {/* Telegram Bot Manager & Broadcaster Modal */}
        <TelegramBotModal
          isOpen={isTelegramModalOpen}
          onClose={() => setIsTelegramModalOpen(false)}
          config={telegramConfig}
          onSaveConfig={(newConfig) => {
            setTelegramConfig(newConfig);
            saveStoredTelegramConfig(newConfig);
          }}
          matches={matches}
        />

        {/* Dev-Only Odds Diagnostic Modal */}
        <OddsDiagnosticModal
          isOpen={isOddsDiagnosticOpen}
          onClose={() => setIsOddsDiagnosticOpen(false)}
          matches={matches}
          oddsByMatchId={oddsByMatchId}
          onRefreshAll={refreshAllOdds}
          onRefreshMatch={refreshMatchOdds}
          isRefreshing={isGlobalRefreshing}
          totalRecordsReceived={totalRecordsReceived}
        />

        {/* Live Entry Radar & Opportunities Modal */}
        <EntryPossibilitiesModal
          isOpen={isEntryRadarOpen}
          onClose={() => setIsEntryRadarOpen(false)}
          matches={matches}
          oddsByMatchId={oddsByMatchId}
          onSelectMatch={navigateToAnalysis}
          recordedFirstEntries={recordedFirstEntries}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation */}
      <Navbar
        countryCode={countryCode}
        onCountryCodeChange={(code) => {
          setCountryCode(code);
          loadMatches(false, code);
        }}
        autoRefreshInterval={autoRefreshInterval}
        onIntervalChange={(sec) => {
          setAutoRefreshInterval(sec);
        }}
        secondsRemaining={secondsRemaining}
        isFetching={isFetching}
        onRefreshNow={() => loadMatches(false)}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(!soundEnabled)}
        onOpenScriptModal={() => setIsScriptModalOpen(true)}
        onOpenInspectorModal={() => setIsInspectorModalOpen(true)}
        onOpenTelegramModal={() => setIsTelegramModalOpen(true)}
        onOpenEntryRadarModal={() => setIsEntryRadarOpen(true)}
        entryOpportunitiesCount={entryOpportunitiesCount}
        isTelegramActive={telegramConfig.enabled && !!telegramConfig.botToken && !!telegramConfig.chatId}
        lastUpdated={lastUpdated}
        isSseActive={isSseConnected}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Stats Metrics Cards */}
        <StatsHeader
          matches={matches}
          latencyMs={latencyMs}
          lastUpdated={lastUpdated}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {/* Filter & Search Bar */}
        <FilterBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          selectedFormat={selectedFormat}
          onFormatChange={setSelectedFormat}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          liveCount={liveMatchesCount}
          totalCount={matches.length}
        />

        {/* Error Notification */}
        {error && (
          <div className="my-6 p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => loadMatches(false)}
              className="px-3 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-100 rounded-lg text-xs font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Matches Grid */}
        <section className="mt-6">
          {isFetching && matches.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-center">
              <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mb-3" />
              <p className="text-sm font-semibold text-slate-300">
                Fetching live cricket data from Crex API...
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Connecting to https://api.goscorer.com/api/v2/getTopMatches
              </p>
            </div>
          ) : filteredMatches.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-center border border-dashed border-slate-800 rounded-2xl p-8">
              <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center text-slate-500 mb-3">
                <Info className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-300">No matches found</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                No matches match your current filter ({activeTab}, {selectedFormat}) or search query.
              </p>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('all');
                  setSelectedFormat('All');
                  setSearchQuery('');
                }}
                className="mt-4 px-4 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredMatches.map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  oddsState={getMatchOdds(m.id)}
                  onSelect={(match) => navigateToAnalysis(match.id)}
                  onInspect={(match) => {
                    setSelectedMatch(match);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span>Crex Live Cricket Scorer</span>
            <span>·</span>
            <span>Real-time updates every 1 second</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://t.me/my_cricket_tracker_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1 font-semibold"
            >
              <Send className="w-3 h-3 -rotate-12" />
              <span>@my_cricket_tracker_bot</span>
            </a>
            <span>·</span>
            <button
              type="button"
              onClick={() => setIsTelegramModalOpen(true)}
              className="hover:text-slate-300 transition-colors"
            >
              Telegram Settings
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => setIsInspectorModalOpen(true)}
              className="hover:text-slate-300 transition-colors"
            >
              API Raw Inspector
            </button>
          </div>
        </div>
      </footer>

      {/* Match Details Scorecard Modal */}
      <MatchDetailModal
        match={selectedMatch}
        onClose={() => setSelectedMatch(null)}
      />

      {/* Standalone Online Script Generator Modal */}
      <OnlineScriptModal
        isOpen={isScriptModalOpen}
        onClose={() => setIsScriptModalOpen(false)}
        countryCode={countryCode}
      />

      {/* API Inspector & Payload Test Modal */}
      <ApiInspectorModal
        isOpen={isInspectorModalOpen}
        onClose={() => setIsInspectorModalOpen(false)}
        initialPayload={`{"cc":"${countryCode}"}`}
        rawData={rawData}
        onPayloadSend={async (newCc) => {
          setCountryCode(newCc);
          await loadMatches(false, newCc);
        }}
        isFetching={isFetching}
        latencyMs={latencyMs}
      />

      {/* Telegram Bot Manager & Broadcaster Modal */}
      <TelegramBotModal
        isOpen={isTelegramModalOpen}
        onClose={() => setIsTelegramModalOpen(false)}
        config={telegramConfig}
        onSaveConfig={(newConfig) => {
          setTelegramConfig(newConfig);
          saveStoredTelegramConfig(newConfig);
        }}
        matches={matches}
      />

      {/* Dev-Only Odds Diagnostic Modal (Phase 4 Verification) */}
      <OddsDiagnosticModal
        isOpen={isOddsDiagnosticOpen}
        onClose={() => setIsOddsDiagnosticOpen(false)}
        matches={matches}
        oddsByMatchId={oddsByMatchId}
        onRefreshAll={refreshAllOdds}
        onRefreshMatch={refreshMatchOdds}
        isRefreshing={isGlobalRefreshing}
        totalRecordsReceived={totalRecordsReceived}
      />

      {/* Live Entry Radar & Possibilities Modal */}
      <EntryPossibilitiesModal
        isOpen={isEntryRadarOpen}
        onClose={() => setIsEntryRadarOpen(false)}
        matches={matches}
        oddsByMatchId={oddsByMatchId}
        onSelectMatch={navigateToAnalysis}
        recordedFirstEntries={recordedFirstEntries}
      />
    </div>
  );
}
