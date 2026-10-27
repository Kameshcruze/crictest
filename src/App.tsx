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
  Radio,
  AlertTriangle,
  RefreshCw,
  Terminal,
  Code2,
  Info,
  Zap,
  Send,
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

  // Telegram Bot Configuration
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig>(getStoredTelegramConfig);
  const lastDigestTimeRef = useRef<number>(Date.now());
  const finishedMatchesRef = useRef<Set<string>>(new Set());

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

          // Telegram Match Result Alert
          if (
            m.status === 'completed' &&
            telegramConfig.enabled &&
            telegramConfig.botToken &&
            telegramConfig.chatId &&
            telegramConfig.notifyResults &&
            !finishedMatchesRef.current.has(m.id)
          ) {
            finishedMatchesRef.current.add(m.id);
            const resultHtml = formatResultAlert(m);
            sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, resultHtml);
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

  // Initial load
  useEffect(() => {
    loadMatches(false);
  }, [loadMatches]);

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
        isTelegramActive={telegramConfig.enabled && !!telegramConfig.botToken && !!telegramConfig.chatId}
        lastUpdated={lastUpdated}
        isSseActive={true}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Live Banner Notice */}
        <div className="mb-4 bg-gradient-to-r from-slate-900 via-emerald-950/20 to-slate-900 border border-emerald-500/20 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm font-bold text-white">
                  Live Cricket Match Scorer (Crex.com API)
                </h1>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300 bg-emerald-500/20 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Live 1s Real-Time Sync Active
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-medium font-mono-numbers">
                  Tick #{tickCounter}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Fetching fresh match data every single second directly from the live API.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
            <button
              type="button"
              onClick={() => setIsTelegramModalOpen(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border shadow-sm ${
                telegramConfig.enabled && telegramConfig.botToken && telegramConfig.chatId
                  ? 'bg-blue-600/30 text-blue-300 border-blue-500/50 hover:bg-blue-600/40'
                  : 'bg-slate-800 text-blue-300 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <Send className="w-3.5 h-3.5 -rotate-12" />
              <span>Telegram Bot</span>
              {telegramConfig.enabled && telegramConfig.botToken && telegramConfig.chatId && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsScriptModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Online Script</span>
            </button>
            <button
              type="button"
              onClick={() => setIsInspectorModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-800/60 rounded-lg transition-colors"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>API Inspector</span>
            </button>
          </div>
        </div>

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
                  onSelect={(match) => setSelectedMatch(match)}
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
    </div>
  );
}
