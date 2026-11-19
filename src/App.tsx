import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  fetchCrexTopMatches,
  playAlertSound,
  registerDynamicMapping,
  transformCrexMatch,
} from './services/cricketApi';
import { ParsedCricketMatch, RawApiResponse } from './types/cricket';
import { MatchOddsState } from './types/odds';
import {
  DesktopSidebar,
  TabletRail,
  TopHeaderBar,
  MobileBottomNav,
  NavSection,
  SportMode,
} from './components/Navbar';
import { ThemeMode } from './components/ThemeToggle';
import { SettingsView } from './components/SettingsView';
import { StatsHeader } from './components/StatsHeader';
import { FilterBar } from './components/FilterBar';
import { MatchCard } from './components/MatchCard';
import { MatchDetailModal } from './components/MatchDetailModal';
import { MatchAnalysisPage } from './components/MatchAnalysisPage';
import { EntryPossibilitiesModal } from './components/EntryPossibilitiesModal';
import { AdminApp } from './components/admin/AdminApp';
import { useOddsManager } from './hooks/useOddsManager';
import { strategyEngine, detectTeamInControl, isWithinEntryWindow } from './services/strategy/engine';
import {
  ALL_KNOWN_FORMATS,
  DEFAULT_STRATEGY_ALLOWED_FORMATS,
  normalizeMatchFormat,
  isFormatAllowedForStrategy,
  isFormatVisibleToPublic,
  formatDisplayLabel,
} from './services/strategy/formatFilter';
import { SerializedMatchStrategyState } from './services/strategy/types';
import { clearLegacyTelegramLocalStorage } from './services/telegramService';
import { fetchPublicSiteConfig, PublicSiteConfig } from './services/adminApi';
import {
  fetchMatchesFromSupabase,
  fetchStrategyTradesFromDb,
  fetchServerStrategyStates,
} from './services/supabaseSyncService';
import {
  AlertTriangle,
  RefreshCw,
  Info,
} from 'lucide-react';

export default function App() {
  const [matches, setMatches] = useState<ParsedCricketMatch[]>([]);
  const [rawData, setRawData] = useState<RawApiResponse | null>(null);
  const [isFetching, setIsFetching] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number>(8);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [, setTickCounter] = useState<number>(0);

  // Route detection for hidden /admin console (never linked publicly)
  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
    }
    return false;
  });

  useEffect(() => {
    const onPopState = () => {
      setIsAdminRoute(
        window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')
      );
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Theme & Shell Navigation State
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof document !== 'undefined') {
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'dark' || attr === 'light') return attr;
    }
    return 'light';
  });
  const [activeNav, setActiveNav] = useState<NavSection>('matches');
  const [sport, setSport] = useState<SportMode>('cricket');

  const handleThemeChange = useCallback((next: ThemeMode) => {
    setTheme(next);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
    }
    try {
      localStorage.setItem('crex-theme', next);
    } catch {
      // ignore storage errors
    }
  }, []);

  // Configuration - 1-second live tick rate (respects visitor local overrides, falls back to /api/public/config)
  const [countryCode, setCountryCode] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('crex_user_cc');
      if (saved && /^[A-Za-z]{2,6}$/.test(saved.trim())) return saved.trim().toUpperCase();
    } catch {
      // ignore storage errors
    }
    return 'IN';
  });
  const [autoRefreshInterval] = useState<number>(1);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('crex_user_sound');
      if (saved === 'true') return true;
      if (saved === 'false') return false;
    } catch {
      // ignore storage errors
    }
    return true;
  });
  const [publicConfig, setPublicConfig] = useState<PublicSiteConfig | null>(null);

  // Filters
  const [activeTab, setActiveTab] = useState<'all' | 'live' | 'upcoming' | 'completed'>('all');
  const [selectedFormat, setSelectedFormat] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [selectedMatch, setSelectedMatch] = useState<ParsedCricketMatch | null>(null);
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

  // Rehydrate persisted strategy states & trades from PostgreSQL on mount (public views only)
  useEffect(() => {
    if (isAdminRoute) return;
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
  }, [applyServerStrategyStates, isAdminRoute]);

  // Dedicated Match Analysis View Routing
  const [activeAnalysisMatchId, setActiveAnalysisMatchId] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && window.location.hash.startsWith('#/match/')) {
      return window.location.hash.replace('#/match/', '').trim() || null;
    }
    return null;
  });

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
    setActiveNav('matches');
    window.location.hash = '';
  }, []);

  // Per-Match Isolated Odds Manager (hydrated via Server SSE)
  const {
    oddsByMatchId,
    getMatchOdds,
    refreshMatchOdds,
  } = useOddsManager(matches, serverOddsByMatch);

  // Purge any legacy browser-stored Telegram config keys on boot
  useEffect(() => {
    clearLegacyTelegramLocalStorage();
  }, []);

  // Load admin-managed public defaults & maintenance banner from GET /api/public/config
  useEffect(() => {
    if (isAdminRoute) return;
    let active = true;
    fetchPublicSiteConfig().then((cfg) => {
      if (!active || !cfg) return;
      setPublicConfig({
        defaultCountryCode: cfg.defaultCountryCode,
        defaultSoundEnabled: cfg.defaultSoundEnabled,
        maintenanceBannerEnabled: cfg.maintenanceBannerEnabled,
        maintenanceBannerText: cfg.maintenanceBannerText,
        publicVisibleFormats: Array.isArray(cfg.publicVisibleFormats) ? cfg.publicVisibleFormats : [],
        strategyAllowedFormats: Array.isArray(cfg.strategyAllowedFormats)
          ? cfg.strategyAllowedFormats
          : [...DEFAULT_STRATEGY_ALLOWED_FORMATS],
      });
      try {
        if (!localStorage.getItem('crex_user_cc') && cfg.defaultCountryCode) {
          setCountryCode(cfg.defaultCountryCode);
        }
        if (localStorage.getItem('crex_user_sound') === null) {
          setSoundEnabled(cfg.defaultSoundEnabled);
        }
      } catch {
        setCountryCode(cfg.defaultCountryCode);
        setSoundEnabled(cfg.defaultSoundEnabled);
      }
    });
    return () => {
      active = false;
    };
  }, [isAdminRoute]);

  const inFlightRef = useRef<boolean>(false);

  // Previous scores memory to detect live changes (runs / wickets)
  const previousScoresRef = useRef<Record<string, { runs: number; wickets: number }>>({});

  // Core Data Fetcher
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
        });

        if (soundEnabled && silent) {
          if (wicketFell) {
            playAlertSound('wicket');
          } else if (scoreChanged) {
            playAlertSound('boundary');
          }
        }

        const allParsed = Object.entries(result.raw || {})
          .filter(([_, m]) => m && typeof m === 'object' && m.b && m.c)
          .map(([id, m]) => transformCrexMatch(id, m));
        if (allParsed.length > 0) {
          setAllServerMatches(allParsed);
        }
        setMatches([...result.matches]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch Crex matches';
        setError(msg);
      } finally {
        inFlightRef.current = false;
        setIsFetching(false);
      }
    },
    [countryCode, soundEnabled]
  );

  const strategyAllowedFormats = useMemo(
    () => publicConfig?.strategyAllowedFormats ?? [...DEFAULT_STRATEGY_ALLOWED_FORMATS],
    [publicConfig?.strategyAllowedFormats]
  );

  const publicVisibleFormats = useMemo(
    () => publicConfig?.publicVisibleFormats ?? [],
    [publicConfig?.publicVisibleFormats]
  );

  const visibleMatches = useMemo(() => {
    if (publicVisibleFormats.length === 0) return matches;
    return matches.filter((m) =>
      isFormatVisibleToPublic(m.raw?.fo ?? m.format, publicVisibleFormats, m.raw?.t)
    );
  }, [matches, publicVisibleFormats]);

  const availableFormatOptions = useMemo(() => {
    const allowedList =
      publicVisibleFormats.length > 0 ? publicVisibleFormats : ALL_KNOWN_FORMATS;
    return [
      { value: 'All', label: 'All Formats' },
      ...allowedList.map((fmt) => ({
        value: fmt,
        label: formatDisplayLabel(fmt),
      })),
    ];
  }, [publicVisibleFormats]);

  useEffect(() => {
    if (
      selectedFormat !== 'All' &&
      !availableFormatOptions.some((opt) => opt.value === selectedFormat)
    ) {
      setSelectedFormat('All');
    }
  }, [selectedFormat, availableFormatOptions]);

  // Real-time Entry Opportunities Count for Radar Badge (strictly strategy-allowed formats only)
  const entryOpportunitiesCount = useMemo(() => {
    let count = 0;
    const liveMatches = visibleMatches.filter(
      (m) =>
        (m.status === 'live' || (m.status !== 'completed' && (m.team1Score || m.team2Score))) &&
        isFormatAllowedForStrategy(m.raw?.fo ?? m.format, strategyAllowedFormats, m.raw?.t)
    );
    for (const m of liveMatches) {
      const oddsState = oddsByMatchId[m.id];
      const controlInfo = detectTeamInControl(m, oddsState);
      const currentPaise = controlInfo.currentPaise;
      const activeScore = m.team2Score || m.team1Score;
      const currentInnings = m.team2Score ? 2 : 1;
      const currentOver = activeScore ? activeScore.overs : 0;
      const inWindow = isWithinEntryWindow(currentInnings, currentOver);

      if (currentPaise === null) continue;

      if (inWindow && controlInfo.teamInControl === 'BATTING' && currentPaise >= 85) {
        count++;
        continue;
      }

      const hasFirst = recordedFirstEntries.has(m.id);
      if (hasFirst && controlInfo.teamInControl === 'BOWLING' && currentPaise < 65) {
        count++;
      }
    }
    return count;
  }, [visibleMatches, strategyAllowedFormats, oddsByMatchId, recordedFirstEntries, strategyVersion]);

  useEffect(() => {
    if (isAdminRoute) return;
    fetchMatchesFromSupabase()
      .then((savedMatches) => {
        if (savedMatches.length > 0) {
          setMatches((prev) => (prev.length === 0 ? savedMatches : prev));
          setAllServerMatches((prev) => (prev.length === 0 ? savedMatches : prev));
        }
      })
      .catch(() => {});

    loadMatches(false);
  }, [loadMatches, isAdminRoute]);

  // Authoritative SSE Stream from server.ts (public views only)
  useEffect(() => {
    if (isAdminRoute) return;
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
            const sorted = [...allParsed];
            sorted.sort((a, b) => {
              const prio = { live: 0, upcoming: 1, completed: 2 };
              if (prio[a.status] !== prio[b.status]) return prio[a.status] - prio[b.status];
              return b.startTime.getTime() - a.startTime.getTime();
            });
            setMatches(sorted);
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
        // Ignore malformed SSE chunks
      }
    };

    eventSource.onerror = () => {
      setIsSseConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [applyServerStrategyStates, isAdminRoute]);

  // Active 1-Second Fallback Engine
  useEffect(() => {
    if (isAdminRoute || autoRefreshInterval <= 0) return;

    let countdown = autoRefreshInterval;
    const timer = setInterval(() => {
      countdown -= 1;
      if (countdown <= 0) {
        countdown = autoRefreshInterval;
        if (!isSseConnected || countryCode !== 'IN') {
          loadMatches(true);
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [autoRefreshInterval, loadMatches, isSseConnected, countryCode, isAdminRoute]);

  // Filtered Matches
  const filteredMatches = useMemo(() => {
    return visibleMatches.filter((m) => {
      if (activeTab === 'live' && m.status !== 'live') return false;
      if (activeTab === 'upcoming' && m.status !== 'upcoming') return false;
      if (activeTab === 'completed' && m.status !== 'completed') return false;

      if (selectedFormat !== 'All') {
        const detected = normalizeMatchFormat(m.raw?.fo ?? m.format, m.raw?.t);
        if (detected !== selectedFormat) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchText = `${m.team1.name} ${m.team1.shortName} ${m.team2.name} ${m.team2.shortName} ${m.seriesName} ${m.venueName}`.toLowerCase();
        if (!matchText.includes(q)) return false;
      }

      return true;
    });
  }, [visibleMatches, activeTab, selectedFormat, searchQuery]);

  const liveMatchesCount = visibleMatches.filter((m) => m.status === 'live').length;

  // Dedicated Admin Console Route (/admin)
  if (isAdminRoute) {
    return <AdminApp theme={theme} onThemeChange={handleThemeChange} />;
  }

  const sharedModals = (
    <>
      <MatchDetailModal
        match={selectedMatch}
        onClose={() => setSelectedMatch(null)}
      />

      <EntryPossibilitiesModal
        isOpen={isEntryRadarOpen}
        onClose={() => setIsEntryRadarOpen(false)}
        matches={visibleMatches}
        oddsByMatchId={oddsByMatchId}
        onSelectMatch={navigateToAnalysis}
        recordedFirstEntries={recordedFirstEntries}
        strategyAllowedFormats={strategyAllowedFormats}
      />
    </>
  );

  const maintenanceBanner =
    publicConfig?.maintenanceBannerEnabled && publicConfig.maintenanceBannerText.trim() ? (
      <div
        role="status"
        aria-live="polite"
        className="w-full bg-[var(--warn-bg)] border-b border-[var(--warn-bd)] text-[var(--warn-tx)] px-4 py-2.5 text-xs font-medium"
      >
        <div className="max-w-[1280px] mx-auto flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.8} />
          <span>{publicConfig.maintenanceBannerText.trim()}</span>
        </div>
      </div>
    ) : null;

  // Dedicated Match Analysis View
  if (activeAnalysisMatchId) {
    const analysisMatch =
      matches.find((m) => m.id === activeAnalysisMatchId) ||
      allServerMatches.find((m) => m.id === activeAnalysisMatchId);
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--tx)] flex flex-col">
        {maintenanceBanner}
        <MatchAnalysisPage
          matchId={activeAnalysisMatchId}
          match={analysisMatch}
          oddsState={getMatchOdds(activeAnalysisMatchId)}
          allMatches={visibleMatches.length > 0 ? visibleMatches : allServerMatches}
          strategyVersion={strategyVersion}
          onStrategyStateSync={(snap) => applyServerStrategyStates({ [activeAnalysisMatchId]: snap })}
          onBack={navigateToDashboard}
          onSelectMatch={navigateToAnalysis}
          onRefreshOdds={refreshMatchOdds}
          theme={theme}
          onThemeChange={handleThemeChange}
          strategyAllowedFormats={strategyAllowedFormats}
        />
        {sharedModals}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--tx)] flex">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Desktop Left Sidebar (>= 1024px) */}
      <DesktopSidebar
        activeNav={activeNav}
        onSelectNav={setActiveNav}
        sport={sport}
        onSelectSport={setSport}
        onOpenEntryRadarModal={() => setIsEntryRadarOpen(true)}
        entryOpportunitiesCount={entryOpportunitiesCount}
      />

      {/* Tablet Compact Icon Rail (768px - 1023px) */}
      <TabletRail
        activeNav={activeNav}
        onSelectNav={setActiveNav}
        onOpenEntryRadarModal={() => setIsEntryRadarOpen(true)}
        entryOpportunitiesCount={entryOpportunitiesCount}
      />

      {/* Main Content Column */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {maintenanceBanner}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 w-full max-w-[1280px] mx-auto px-3.5 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-24 md:pb-8"
        >
          <TopHeaderBar
            activeNav={activeNav}
            onSelectNav={setActiveNav}
            sport={sport}
            onSelectSport={setSport}
            theme={theme}
            onThemeChange={handleThemeChange}
            onOpenEntryRadarModal={() => setIsEntryRadarOpen(true)}
            entryOpportunitiesCount={entryOpportunitiesCount}
            liveCount={liveMatchesCount}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedFormat={selectedFormat}
            onFormatChange={setSelectedFormat}
            formatOptions={availableFormatOptions}
            isSseConnected={isSseConnected}
          />

          {activeNav === 'settings' ? (
            <SettingsView
              theme={theme}
              onThemeChange={handleThemeChange}
              soundEnabled={soundEnabled}
              onToggleSound={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                try {
                  localStorage.setItem('crex_user_sound', String(next));
                } catch {
                  // ignore
                }
              }}
              countryCode={countryCode}
              onCountryCodeChange={(code) => {
                setCountryCode(code);
                try {
                  localStorage.setItem('crex_user_cc', code);
                } catch {
                  // ignore
                }
                loadMatches(false, code);
              }}
              isFetching={isFetching}
              onRefreshNow={() => loadMatches(false)}
              isSseActive={isSseConnected}
              latencyMs={latencyMs}
              lastUpdated={lastUpdated}
            />
          ) : (
            <>
              <StatsHeader
                matches={visibleMatches}
                latencyMs={latencyMs}
                lastUpdated={lastUpdated}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />

              <FilterBar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                selectedFormat={selectedFormat}
                onFormatChange={setSelectedFormat}
                formatOptions={availableFormatOptions}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                liveCount={liveMatchesCount}
                totalCount={visibleMatches.length}
              />

              {error && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="my-4 p-3.5 rounded-xl bg-[var(--rds)] border border-[var(--rd)]/35 text-[var(--rdt)] text-xs flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadMatches(false)}
                    className="px-3 py-1 bg-[var(--rd)] text-white rounded-lg text-xs font-semibold transition-opacity hover:opacity-90 shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}

              <section className="mt-4">
                {isFetching && visibleMatches.length === 0 ? (
                  <div
                    aria-busy="true"
                    aria-label="Loading live cricket matches"
                    className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                  >
                    {Array.from({ length: 6 }).map((_, idx) => (
                      <div
                        key={idx}
                        style={{ boxShadow: 'var(--card-shadow)' }}
                        className="rounded-2xl border border-[var(--bd)] bg-[var(--sf)] p-4 animate-pulse space-y-4"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="h-3 w-44 rounded bg-[var(--sf-2)]" />
                          <div className="h-5 w-14 rounded-full bg-[var(--sf-2)]" />
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-[var(--sf-2)] shrink-0" />
                              <div className="space-y-1.5">
                                <div className="h-3.5 w-16 rounded bg-[var(--sf-2)]" />
                                <div className="h-2.5 w-28 rounded bg-[var(--sf-2)]" />
                              </div>
                            </div>
                            <div className="space-y-1.5 text-right">
                              <div className="h-5 w-12 rounded bg-[var(--sf-2)] ml-auto" />
                              <div className="h-2.5 w-10 rounded bg-[var(--sf-2)] ml-auto" />
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-[var(--sf-2)] shrink-0" />
                              <div className="space-y-1.5">
                                <div className="h-3.5 w-14 rounded bg-[var(--sf-2)]" />
                                <div className="h-2.5 w-24 rounded bg-[var(--sf-2)]" />
                              </div>
                            </div>
                            <div className="h-3.5 w-16 rounded bg-[var(--sf-2)]" />
                          </div>
                        </div>
                        <div className="pt-3 border-t border-[var(--bd)] space-y-2.5">
                          <div className="h-4 w-36 rounded bg-[var(--sf-2)]" />
                          <div className="h-1.5 w-full rounded-full bg-[var(--sf-2)]" />
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <div className="h-3 w-32 rounded bg-[var(--sf-2)]" />
                          <div className="h-8 w-24 rounded-xl bg-[var(--sf-2)]" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : visibleMatches.length === 0 ? (
                  <div className="py-16 flex flex-col items-center justify-center text-center border border-dashed border-[var(--bd)] bg-[var(--sf)] rounded-2xl p-8">
                    <div className="w-11 h-11 rounded-2xl bg-[var(--sf-2)] flex items-center justify-center text-[var(--mu)] mb-3">
                      <Info className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-bold text-[var(--tx)]">
                      No matches from live feed
                    </h3>
                    <p className="text-xs text-[var(--mu)] mt-1 max-w-sm">
                      There are currently no active or scheduled matches returned by the Crex feed.
                    </p>
                    <button
                      type="button"
                      onClick={() => loadMatches(false)}
                      className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[var(--rd)] hover:opacity-90 rounded-xl transition-opacity"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
                      <span>Refresh</span>
                    </button>
                  </div>
                ) : filteredMatches.length === 0 ? (
                  <div className="py-16 flex flex-col items-center justify-center text-center border border-dashed border-[var(--bd)] bg-[var(--sf)] rounded-2xl p-8">
                    <div className="w-11 h-11 rounded-2xl bg-[var(--sf-2)] flex items-center justify-center text-[var(--mu)] mb-3">
                      <Info className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-bold text-[var(--tx)]">
                      No matches for these filters
                    </h3>
                    <p className="text-xs text-[var(--mu)] mt-1 max-w-sm">
                      No matches match your current filter ({activeTab}, {selectedFormat}) or search query.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('all');
                        setSelectedFormat('All');
                        setSearchQuery('');
                      }}
                      className="mt-4 px-4 py-2 text-xs font-semibold text-white bg-[var(--rd)] hover:opacity-90 rounded-xl transition-opacity"
                    >
                      Reset Filters
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
            </>
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation (< 768px) */}
      <MobileBottomNav
        activeNav={activeNav}
        onSelectNav={setActiveNav}
        onOpenEntryRadarModal={() => setIsEntryRadarOpen(true)}
        entryOpportunitiesCount={entryOpportunitiesCount}
      />

      {sharedModals}
    </div>
  );
}
