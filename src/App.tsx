import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  fetchCrexTopMatches,
  playAlertSound,
} from './services/cricketApi';
import { ParsedCricketMatch, RawApiResponse } from './types/cricket';
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
import { calculateOpposingOdds, isWithinEntryWindow } from './services/strategy/engine';
import {
  TelegramConfig,
  getStoredTelegramConfig,
  saveStoredTelegramConfig,
  sendTelegramMessage,
  formatWicketAlert,
  formatResultAlert,
  formatScoreboardDigest,
  formatFirstEntryAlert,
  formatSecondEntryAlert,
} from './services/telegramService';
import {
  migrateLocalStorageToSupabase,
  fetchMatchesFromSupabase,
  syncMatchToSupabase,
  checkAndRecordMatchConclusionInDb,
  checkAndRecordEntrySignalInDb,
  fetchRecordedFirstEntriesFromDb,
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

  // Strategy Entry Tracking (ball 0.0 to match end)
  const [recordedFirstEntries, setRecordedFirstEntries] = useState<Set<string>>(new Set());
  const firstEntryWicketsAnchorRef = useRef<Record<string, number>>({});

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

  // Phase 4: Per-Match Isolated Odds Manager
  const {
    oddsByMatchId,
    getMatchOdds,
    refreshMatchOdds,
    refreshAllOdds,
    isGlobalRefreshing,
    totalRecordsReceived,
  } = useOddsManager(matches);

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

        // Always create a new array reference to guarantee React state updates
        setMatches([...result.matches]);

        // Asynchronously sync live matches to Supabase
        result.matches.forEach((m) => {
          if (m.status === 'live' || m.status === 'completed') {
            syncMatchToSupabase(m).catch(() => {});
          }
        });
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
  }, [matches, oddsByMatchId, recordedFirstEntries]);

  // Initial load: Migrate local data, populate from Supabase, then fetch fresh feed
  useEffect(() => {
    // 1. Migrate any existing local data
    migrateLocalStorageToSupabase().catch(() => {});

    // 2. Hydrate matches from Supabase if available
    fetchMatchesFromSupabase().then((savedMatches) => {
      if (savedMatches.length > 0) {
        setMatches((prev) => (prev.length === 0 ? savedMatches : prev));
      }
    }).catch(() => {});

    // 3. Hydrate strategy recorded 1st entries from Supabase
    fetchRecordedFirstEntriesFromDb().then((entries) => {
      if (entries.size > 0) {
        setRecordedFirstEntries((prev) => new Set([...prev, ...entries]));
      }
    }).catch(() => {});

    // 4. Initiate live streaming / polling
    loadMatches(false);
  }, [loadMatches]);

  // Live Evaluation of Strategy Entries from Ball 0.0 to Match End (with strict 1st -> 2nd entry rule)
  useEffect(() => {
    const liveMatches = matches.filter(
      (m) => m.status === 'live' || (m.status !== 'completed' && (m.team1Score || m.team2Score))
    );

    for (const m of liveMatches) {
      const oddsState = oddsByMatchId[m.id];
      const decimalOdds =
        oddsState?.odds?.bookmaker?.decimalBack ??
        oddsState?.odds?.bookmaker?.decimalLay ??
        null;
      const favoriteTeam =
        oddsState?.odds?.favoriteTeamName ||
        oddsState?.odds?.favoriteTeamKey ||
        m.team1.shortName;
      const activeScore = m.team2Score || m.team1Score;
      const currentInnings = m.team2Score ? 2 : 1;
      const currentOver = activeScore ? activeScore.overs : 0;
      const currentRuns = activeScore ? activeScore.runs : 0;
      const currentWickets = activeScore ? activeScore.wickets : 0;
      const opposingOdds = decimalOdds ? calculateOpposingOdds(decimalOdds) : null;
      const inWindow = isWithinEntryWindow(currentInnings, currentOver);

      if (decimalOdds === null) continue;

      // 1. Evaluate First Entry: [1.85, 2.00] within window
      if (decimalOdds >= 1.85 && decimalOdds <= 2.0 && inWindow) {
        if (!recordedFirstEntries.has(m.id)) {
          checkAndRecordEntrySignalInDb(m.id, 'FIRST_ENTRY', {
            team1: m.team1.shortName,
            team2: m.team2.shortName,
            measuredTeam: favoriteTeam,
            decimalOdds,
            over: currentOver,
            innings: currentInnings,
            score: `${currentRuns}/${currentWickets}`,
            rule: 'First Entry: Odds in [1.85, 2.00] within window',
          }).then((allowed) => {
            if (allowed) {
              setRecordedFirstEntries((prev) => new Set(prev).add(m.id));
              firstEntryWicketsAnchorRef.current[m.id] = currentWickets;

              if (
                telegramConfig.enabled &&
                telegramConfig.botToken &&
                telegramConfig.chatId &&
                telegramConfig.notifyStrategyEntries !== false
              ) {
                const alertMsg = formatFirstEntryAlert({
                  match: m,
                  targetTeamName: favoriteTeam,
                  decimalOdds,
                  currentOver,
                  currentInnings,
                  runs: currentRuns,
                  wickets: currentWickets,
                  crr: m.currentRunRate,
                });
                sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, alertMsg);
              }
            }
          });
        }
      }

      // 2. Evaluate Second Entry: STRICT DEPENDENCY ON FIRST ENTRY
      // "without the first entry you should not send the 2nd entry message."
      const hasFirstEntry = recordedFirstEntries.has(m.id);
      if (hasFirstEntry) {
        const anchorWkts = firstEntryWicketsAnchorRef.current[m.id] ?? 0;
        const wicketFellSince1st = currentWickets > anchorWkts;

        if (wicketFellSince1st && opposingOdds && opposingOdds < 1.65 && inWindow) {
          checkAndRecordEntrySignalInDb(m.id, 'SECOND_ENTRY', {
            team1: m.team1.shortName,
            team2: m.team2.shortName,
            measuredTeam: favoriteTeam,
            decimalOdds,
            opposingOdds,
            over: currentOver,
            innings: currentInnings,
            score: `${currentRuns}/${currentWickets}`,
            rule: 'Second Entry: Confirmed wicket fell after 1st entry, opposing odds < 1.65 within window',
          }).then((allowed) => {
            if (allowed) {
              if (
                telegramConfig.enabled &&
                telegramConfig.botToken &&
                telegramConfig.chatId &&
                telegramConfig.notifyStrategyEntries !== false
              ) {
                const alertMsg = formatSecondEntryAlert({
                  match: m,
                  measuredTeamName: favoriteTeam,
                  opposingOdds,
                  currentOver,
                  currentInnings,
                  runs: currentRuns,
                  wickets: currentWickets,
                  anchorWickets: anchorWkts,
                });
                sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, alertMsg);
              }
            }
          });
        }
      }
    }
  }, [matches, oddsByMatchId, recordedFirstEntries, telegramConfig]);

  // Active 1-Second Continuous Live Engine with accurate countdown
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;

    let countdown = autoRefreshInterval;
    setSecondsRemaining(countdown);

    const timer = setInterval(() => {
      countdown -= 1;
      if (countdown <= 0) {
        countdown = autoRefreshInterval;
        loadMatches(true);
      }
      setSecondsRemaining(countdown);
    }, 1000);

    return () => clearInterval(timer);
  }, [autoRefreshInterval, loadMatches]);

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
    const analysisMatch = matches.find((m) => m.id === activeAnalysisMatchId);
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
        <MatchAnalysisPage
          matchId={activeAnalysisMatchId}
          match={analysisMatch}
          oddsState={getMatchOdds(activeAnalysisMatchId)}
          allMatches={matches}
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
        isSseActive={true}
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
            <button
              type="button"
              onClick={() => setIsScriptModalOpen(true)}
              className="hover:text-slate-300 transition-colors"
            >
              Online Automation Scripts
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => setIsInspectorModalOpen(true)}
              className="hover:text-slate-300 transition-colors"
            >
              API Raw Inspector
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => setIsTelegramModalOpen(true)}
              className="text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1 font-semibold"
            >
              <Send className="w-3 h-3 -rotate-12" />
              <span>Telegram Bot</span>
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
