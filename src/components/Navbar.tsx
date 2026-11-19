import React from 'react';
import {
  Radio,
  Target,
  SlidersHorizontal,
  Search,
  X,
  WifiOff,
} from 'lucide-react';
import { ThemeToggle, ThemeMode } from './ThemeToggle';

export type NavSection = 'matches' | 'settings';
export type SportMode = 'cricket' | 'football';

/** Stacked horizontal bars icon matching the Matches nav icon in the design */
const MatchesBarsIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="6" rx="2" />
    <rect x="3" y="14" width="18" height="6" rx="2" />
  </svg>
);

interface AppShellNavProps {
  activeNav: NavSection;
  onSelectNav: (nav: NavSection) => void;
  sport: SportMode;
  onSelectSport: (sport: SportMode) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onOpenEntryRadarModal: () => void;
  entryOpportunitiesCount: number;
  liveCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedFormat: string;
  onFormatChange: (fmt: string) => void;
  isSseConnected?: boolean;
}

const FORMAT_OPTIONS = ['All', 'T10', 'T20'];

export const DesktopSidebar: React.FC<
  Pick<
    AppShellNavProps,
    | 'activeNav'
    | 'onSelectNav'
    | 'sport'
    | 'onSelectSport'
    | 'onOpenEntryRadarModal'
    | 'entryOpportunitiesCount'
  >
> = ({
  activeNav,
  onSelectNav,
  sport,
  onSelectSport,
  onOpenEntryRadarModal,
  entryOpportunitiesCount,
}) => {
  return (
    <aside className="hidden lg:flex flex-col justify-between w-[236px] shrink-0 bg-[var(--sf)] border-r border-[var(--bd)] sticky top-0 h-screen p-4 z-30">
      <div>
        {/* Brand */}
        <button
          type="button"
          onClick={() => onSelectNav('matches')}
          className="flex items-center gap-2.5 w-full text-left mb-5 rounded-xl"
        >
          <div className="w-9 h-9 rounded-xl bg-[var(--rd)] text-white flex items-center justify-center shrink-0 shadow-xs">
            <Radio className="w-5 h-5" />
          </div>
          <span className="text-[17px] font-bold tracking-tight text-[var(--tx)] whitespace-nowrap">
            Crex Scorer
          </span>
        </button>

        {/* Sport Switcher */}
        <div className="space-y-2 mb-6">
          <button
            type="button"
            aria-pressed={sport === 'cricket'}
            onClick={() => onSelectSport('cricket')}
            className={`w-full py-2.5 px-3.5 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center ${
              sport === 'cricket'
                ? 'bg-[var(--rd)] text-white shadow-xs'
                : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--tx)] hover:bg-[var(--sf-2)]'
            }`}
          >
            Cricket
          </button>
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Football coming soon"
            className="w-full py-2.5 px-3.5 rounded-xl text-xs font-semibold bg-[var(--sf)] border border-[var(--bd)] text-[var(--tx)] flex items-center justify-center gap-2 opacity-90 cursor-not-allowed"
          >
            <span>Football</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-[var(--rds)] text-[var(--rdt)]">
              SOON
            </span>
          </button>
        </div>

        {/* Primary Nav */}
        <nav aria-label="Primary navigation" className="space-y-1">
          <button
            type="button"
            aria-current={activeNav === 'matches' ? 'page' : undefined}
            onClick={() => onSelectNav('matches')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
              activeNav === 'matches'
                ? 'bg-[var(--rds)] text-[var(--rdt)]'
                : 'text-[var(--tx)] hover:bg-[var(--sf-2)]'
            }`}
          >
            <MatchesBarsIcon className="w-4 h-4 shrink-0" />
            <span>Matches</span>
          </button>

          <button
            type="button"
            onClick={onOpenEntryRadarModal}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold text-[var(--tx)] hover:bg-[var(--sf-2)] transition-colors"
          >
            <span className="flex items-center gap-3">
              <Target className="w-4 h-4 shrink-0" />
              <span>Entry Radar</span>
            </span>
            {entryOpportunitiesCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--rd)] text-white tabular-nums">
                {entryOpportunitiesCount}
              </span>
            )}
          </button>

          <button
            type="button"
            aria-current={activeNav === 'settings' ? 'page' : undefined}
            onClick={() => onSelectNav('settings')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
              activeNav === 'settings'
                ? 'bg-[var(--rds)] text-[var(--rdt)]'
                : 'text-[var(--tx)] hover:bg-[var(--sf-2)]'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4 shrink-0" />
            <span>Settings</span>
          </button>
        </nav>
      </div>
    </aside>
  );
};

export const TabletRail: React.FC<
  Pick<
    AppShellNavProps,
    | 'activeNav'
    | 'onSelectNav'
    | 'onOpenEntryRadarModal'
    | 'entryOpportunitiesCount'
  >
> = ({
  activeNav,
  onSelectNav,
  onOpenEntryRadarModal,
  entryOpportunitiesCount,
}) => {
  return (
    <aside className="hidden md:flex lg:hidden flex-col items-center w-[76px] shrink-0 bg-[var(--sf)] border-r border-[var(--bd)] sticky top-0 h-screen py-4 z-30">
      <button
        type="button"
        onClick={() => onSelectNav('matches')}
        aria-label="Crex Scorer Home"
        className="w-10 h-10 rounded-xl bg-[var(--rd)] text-white flex items-center justify-center shrink-0 shadow-xs"
      >
        <Radio className="w-5 h-5" />
      </button>

      {/* Evenly spaced vertical navigation rail */}
      <nav
        aria-label="Compact navigation"
        className="flex-1 flex flex-col justify-evenly items-center w-full px-1 py-6"
      >
        <button
          type="button"
          aria-current={activeNav === 'matches' ? 'page' : undefined}
          onClick={() => onSelectNav('matches')}
          className={`flex flex-col items-center gap-1 py-2 px-2 rounded-xl w-full transition-colors ${
            activeNav === 'matches'
              ? 'text-[var(--rdt)]'
              : 'text-[var(--mu)] hover:text-[var(--tx)]'
          }`}
        >
          <MatchesBarsIcon className="w-4 h-4" />
          <span className="text-[11px] font-semibold">Matches</span>
        </button>

        <button
          type="button"
          onClick={onOpenEntryRadarModal}
          className="relative flex flex-col items-center gap-1 py-2 px-2 rounded-xl w-full text-[var(--mu)] hover:text-[var(--tx)] transition-colors"
        >
          <Target className="w-4 h-4" />
          <span className="text-[11px] font-semibold">Radar</span>
          {entryOpportunitiesCount > 0 && (
            <span className="absolute top-1 right-2.5 w-2 h-2 rounded-full bg-[var(--rd)]" />
          )}
        </button>

        <button
          type="button"
          aria-current={activeNav === 'settings' ? 'page' : undefined}
          onClick={() => onSelectNav('settings')}
          className={`flex flex-col items-center gap-1 py-2 px-2 rounded-xl w-full transition-colors ${
            activeNav === 'settings'
              ? 'text-[var(--rdt)]'
              : 'text-[var(--mu)] hover:text-[var(--tx)]'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="text-[11px] font-semibold">Settings</span>
        </button>
      </nav>
    </aside>
  );
};

export const TopHeaderBar: React.FC<AppShellNavProps> = ({
  activeNav,
  sport,
  onSelectSport,
  theme,
  onThemeChange,
  onOpenEntryRadarModal,
  entryOpportunitiesCount,
  liveCount,
  searchQuery,
  onSearchChange,
  selectedFormat,
  onFormatChange,
  isSseConnected = true,
}) => {
  return (
    <div className="space-y-3 mb-4 lg:mb-5">
      {/* Desktop Header (>= 1024px) */}
      <header className="hidden lg:flex items-center justify-between gap-3">
        <div className="min-w-0 shrink-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--tx)]">
              {activeNav === 'settings' ? 'Settings' : 'Matches'}
            </h1>
            {!isSseConnected && (
              <span
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--warn-bg)] text-[var(--warn-tx)] border border-[var(--warn-bd)]"
                title="Live stream disconnected — attempting to reconnect"
              >
                <WifiOff className="w-3 h-3" />
                <span>Reconnecting</span>
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--mu)] mt-0.5">
            {activeNav === 'settings'
              ? 'Appearance, sound alerts & live feed'
              : `Cricket · ${liveCount} live now`}
          </p>
        </div>

        <div className="flex items-center gap-2 xl:gap-2.5 min-w-0 justify-end">
          {activeNav === 'matches' && (
            <>
              <div className="relative w-40 xl:w-64 min-w-[130px] shrink">
                <Search className="w-3.5 h-3.5 text-[var(--mu)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search teams, tournament, venue"
                  aria-label="Search teams, tournament, venue"
                  className="w-full bg-[var(--sf)] border border-[var(--bd)] rounded-xl pl-8 pr-7 py-2 text-xs text-[var(--tx)] placeholder-[var(--mu)] focus:border-[var(--rd)]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => onSearchChange('')}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--mu)] hover:text-[var(--tx)]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <select
                aria-label="Filter by format"
                value={selectedFormat}
                onChange={(e) => onFormatChange(e.target.value)}
                className="bg-[var(--sf)] border border-[var(--rd)]/40 text-xs font-semibold text-[var(--rdt)] rounded-xl px-2.5 xl:px-3 py-2 cursor-pointer focus:border-[var(--rd)] shrink-0"
              >
                {FORMAT_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f === 'All' ? 'All Formats' : f}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            type="button"
            onClick={onOpenEntryRadarModal}
            aria-label={`Entry Radar: ${entryOpportunitiesCount > 0 ? `${entryOpportunitiesCount} ready` : 'wait'}`}
            className="inline-flex items-center gap-1.5 px-2.5 xl:px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--sf)] border border-[var(--rd)]/40 text-[var(--rdt)] hover:bg-[var(--rds)] transition-colors whitespace-nowrap shrink-0"
          >
            <Target className="w-3.5 h-3.5 xl:hidden" />
            <span className="hidden xl:inline">
              Entry Radar · {entryOpportunitiesCount > 0 ? `${entryOpportunitiesCount} Ready` : 'Wait'}
            </span>
            <span className="xl:hidden">
              {entryOpportunitiesCount > 0 ? `${entryOpportunitiesCount}` : 'Wait'}
            </span>
          </button>

          <ThemeToggle theme={theme} onToggle={onThemeChange} />
        </div>
      </header>

      {/* Mobile & Tablet Header (< 1024px) */}
      <header className="flex lg:hidden items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[var(--rd)] text-white flex items-center justify-center shrink-0 md:hidden shadow-xs">
            <Radio className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-[17px] font-bold tracking-tight text-[var(--tx)] leading-tight truncate">
                {activeNav === 'settings' ? 'Settings' : 'Crex Scorer'}
              </h1>
              {!isSseConnected && (
                <span
                  role="status"
                  aria-live="polite"
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[var(--warn-bg)] text-[var(--warn-tx)] border border-[var(--warn-bd)] shrink-0"
                  title="Live stream disconnected — attempting to reconnect"
                >
                  <WifiOff className="w-2.5 h-2.5" />
                  <span>Offline</span>
                </span>
              )}
            </div>
            <p className="text-[11px] text-[var(--mu)] leading-tight">
              {activeNav === 'settings' ? 'Preferences' : 'Live'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle theme={theme} onToggle={onThemeChange} />
        </div>
      </header>

      {/* Mobile & Tablet Sport Switcher (< 1024px) */}
      {activeNav === 'matches' && (
        <div className="grid grid-cols-2 gap-2.5 lg:hidden">
          <button
            type="button"
            aria-pressed={sport === 'cricket'}
            onClick={() => onSelectSport('cricket')}
            className={`py-2.5 px-3 rounded-xl text-xs font-semibold transition-colors ${
              sport === 'cricket'
                ? 'bg-[var(--rd)] text-white shadow-xs'
                : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--tx)]'
            }`}
          >
            Cricket
          </button>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="py-2.5 px-3 rounded-xl text-xs font-semibold bg-[var(--sf)] border border-[var(--bd)] text-[var(--tx)] flex items-center justify-center gap-1.5 cursor-not-allowed opacity-90"
          >
            <span>Football</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-[var(--rds)] text-[var(--rdt)]">
              SOON
            </span>
          </button>
        </div>
      )}
    </div>
  );
};

export const MobileBottomNav: React.FC<
  Pick<
    AppShellNavProps,
    | 'activeNav'
    | 'onSelectNav'
    | 'onOpenEntryRadarModal'
    | 'entryOpportunitiesCount'
  >
> = ({
  activeNav,
  onSelectNav,
  onOpenEntryRadarModal,
  entryOpportunitiesCount,
}) => {
  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--sf)] border-t border-[var(--bd)] px-2 py-1.5"
    >
      <div className="grid grid-cols-3 gap-1 max-w-md mx-auto">
        <button
          type="button"
          aria-current={activeNav === 'matches' ? 'page' : undefined}
          onClick={() => onSelectNav('matches')}
          className={`flex flex-col items-center justify-center py-1 rounded-xl text-[11px] font-semibold transition-colors ${
            activeNav === 'matches' ? 'text-[var(--rdt)]' : 'text-[var(--mu)]'
          }`}
        >
          <MatchesBarsIcon className="w-4 h-4 mb-0.5" />
          <span>Matches</span>
        </button>

        <button
          type="button"
          onClick={onOpenEntryRadarModal}
          className="relative flex flex-col items-center justify-center py-1 rounded-xl text-[11px] font-semibold text-[var(--mu)] hover:text-[var(--tx)] transition-colors"
        >
          <Target className="w-4 h-4 mb-0.5" />
          <span>Radar</span>
          {entryOpportunitiesCount > 0 && (
            <span className="absolute top-1 right-8 w-2 h-2 rounded-full bg-[var(--rd)]" />
          )}
        </button>

        <button
          type="button"
          aria-current={activeNav === 'settings' ? 'page' : undefined}
          onClick={() => onSelectNav('settings')}
          className={`flex flex-col items-center justify-center py-1 rounded-xl text-[11px] font-semibold transition-colors ${
            activeNav === 'settings' ? 'text-[var(--rdt)]' : 'text-[var(--mu)]'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4 mb-0.5" />
          <span>Settings</span>
        </button>
      </div>
    </nav>
  );
};
