import React from 'react';
import {
  Radio,
  LayoutGrid,
  Target,
  Bell,
  Send,
  SlidersHorizontal,
  Search,
  X,
  Code2,
} from 'lucide-react';
import { ThemeToggle, ThemeMode } from './ThemeToggle';

export type NavSection = 'matches' | 'settings';
export type SportMode = 'cricket' | 'football';

interface AppShellNavProps {
  activeNav: NavSection;
  onSelectNav: (nav: NavSection) => void;
  sport: SportMode;
  onSelectSport: (sport: SportMode) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onOpenEntryRadarModal: () => void;
  onOpenAlertsModal: () => void;
  onOpenTelegramModal: () => void;
  onOpenInspectorModal: () => void;
  entryOpportunitiesCount: number;
  liveCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedFormat: string;
  onFormatChange: (fmt: string) => void;
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
    | 'onOpenAlertsModal'
    | 'onOpenTelegramModal'
    | 'onOpenInspectorModal'
    | 'entryOpportunitiesCount'
  >
> = ({
  activeNav,
  onSelectNav,
  sport,
  onSelectSport,
  onOpenEntryRadarModal,
  onOpenAlertsModal,
  onOpenTelegramModal,
  onOpenInspectorModal,
  entryOpportunitiesCount,
}) => {
  return (
    <aside className="hidden lg:flex flex-col justify-between w-[236px] shrink-0 bg-[var(--sf)] border-r border-[var(--bd)] sticky top-0 h-screen p-4 z-30">
      <div>
        {/* Brand */}
        <button
          type="button"
          onClick={() => onSelectNav('matches')}
          className="flex items-center gap-2.5 w-full text-left mb-5"
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
            onClick={() => onSelectNav('matches')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
              activeNav === 'matches'
                ? 'bg-[var(--rds)] text-[var(--rdt)]'
                : 'text-[var(--tx)] hover:bg-[var(--sf-2)]'
            }`}
          >
            <LayoutGrid className="w-4 h-4 shrink-0" />
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
            onClick={onOpenAlertsModal}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-[var(--tx)] hover:bg-[var(--sf-2)] transition-colors"
          >
            <Bell className="w-4 h-4 shrink-0" />
            <span>Alerts</span>
          </button>

          <button
            type="button"
            onClick={onOpenTelegramModal}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-[var(--tx)] hover:bg-[var(--sf-2)] transition-colors"
          >
            <Send className="w-4 h-4 shrink-0" />
            <span>Telegram</span>
          </button>

          <button
            type="button"
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

      {/* Bottom Utility Links */}
      <div className="pt-4 border-t border-[var(--bd)] space-y-2 text-[11px]">
        <button
          type="button"
          onClick={onOpenTelegramModal}
          className="block w-full text-left text-[var(--mu)] hover:text-[var(--tx)] transition-colors font-medium"
        >
          Telegram Settings
        </button>
        <button
          type="button"
          onClick={onOpenInspectorModal}
          className="flex items-center gap-1.5 w-full text-left text-[var(--mu)] hover:text-[var(--tx)] transition-colors font-medium"
        >
          <Code2 className="w-3 h-3 shrink-0" />
          <span>API Raw Inspector</span>
        </button>
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
    | 'onOpenAlertsModal'
    | 'entryOpportunitiesCount'
  >
> = ({
  activeNav,
  onSelectNav,
  onOpenEntryRadarModal,
  onOpenAlertsModal,
  entryOpportunitiesCount,
}) => {
  return (
    <aside className="hidden md:flex lg:hidden flex-col items-center w-[76px] shrink-0 bg-[var(--sf)] border-r border-[var(--bd)] sticky top-0 h-screen py-4 z-30">
      <button
        type="button"
        onClick={() => onSelectNav('matches')}
        aria-label="Crex Scorer Home"
        className="w-10 h-10 rounded-xl bg-[var(--rd)] text-white flex items-center justify-center mb-8 shadow-xs"
      >
        <Radio className="w-5 h-5" />
      </button>

      <nav aria-label="Compact navigation" className="flex flex-col items-center gap-5 w-full px-1">
        <button
          type="button"
          onClick={() => onSelectNav('matches')}
          className={`flex flex-col items-center gap-1 py-1.5 px-2 rounded-xl w-full transition-colors ${
            activeNav === 'matches'
              ? 'text-[var(--rdt)]'
              : 'text-[var(--mu)] hover:text-[var(--tx)]'
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          <span className="text-[11px] font-semibold">Matches</span>
        </button>

        <button
          type="button"
          onClick={onOpenEntryRadarModal}
          className="relative flex flex-col items-center gap-1 py-1.5 px-2 rounded-xl w-full text-[var(--mu)] hover:text-[var(--tx)] transition-colors"
        >
          <Target className="w-4 h-4" />
          <span className="text-[11px] font-semibold">Radar</span>
          {entryOpportunitiesCount > 0 && (
            <span className="absolute top-0.5 right-2.5 w-2 h-2 rounded-full bg-[var(--rd)]" />
          )}
        </button>

        <button
          type="button"
          onClick={onOpenAlertsModal}
          className="flex flex-col items-center gap-1 py-1.5 px-2 rounded-xl w-full text-[var(--mu)] hover:text-[var(--tx)] transition-colors"
        >
          <Bell className="w-4 h-4" />
          <span className="text-[11px] font-semibold">Alerts</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectNav('settings')}
          className={`flex flex-col items-center gap-1 py-1.5 px-2 rounded-xl w-full transition-colors ${
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
  onOpenTelegramModal,
  entryOpportunitiesCount,
  liveCount,
  searchQuery,
  onSearchChange,
  selectedFormat,
  onFormatChange,
}) => {
  return (
    <div className="space-y-3 mb-4 lg:mb-5">
      {/* Desktop Header (>= 1024px) */}
      <header className="hidden lg:flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--tx)]">
            {activeNav === 'settings' ? 'Settings' : 'Matches'}
          </h1>
          <p className="text-xs text-[var(--mu)] mt-0.5">
            {activeNav === 'settings'
              ? 'Preferences, live feed & diagnostics'
              : `Cricket · ${liveCount} live now`}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {activeNav === 'matches' && (
            <>
              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 text-[var(--mu)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search teams, tournament, venue"
                  className="w-full bg-[var(--sf)] border border-[var(--bd)] rounded-xl pl-8 pr-7 py-2 text-xs text-[var(--tx)] placeholder-[var(--mu)] focus:outline-none focus:border-[var(--rd)]"
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
                className="bg-[var(--sf)] border border-[var(--bd)] text-xs font-semibold text-[var(--rdt)] rounded-xl px-3 py-2 cursor-pointer focus:outline-none focus:border-[var(--rd)]"
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
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--sf)] border border-[var(--rd)]/40 text-[var(--rdt)] hover:bg-[var(--rds)] transition-colors whitespace-nowrap"
          >
            <span>
              Entry Radar · {entryOpportunitiesCount > 0 ? `${entryOpportunitiesCount} Ready` : 'Wait'}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenTelegramModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--rd)] text-white hover:opacity-90 transition-opacity whitespace-nowrap shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Telegram</span>
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
            <h1 className="text-[17px] font-bold tracking-tight text-[var(--tx)] leading-tight truncate">
              {activeNav === 'settings' ? 'Settings' : 'Crex Scorer'}
            </h1>
            <p className="text-[11px] text-[var(--mu)] leading-tight">
              {activeNav === 'settings' ? 'Preferences & Tools' : 'Live'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenTelegramModal}
            className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[var(--rd)] text-white hover:opacity-90 transition-opacity"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Telegram</span>
          </button>
          <ThemeToggle theme={theme} onToggle={onThemeChange} />
        </div>
      </header>

      {/* Mobile & Tablet Sport Switcher (< 1024px) */}
      {activeNav === 'matches' && (
        <div className="grid grid-cols-2 gap-2.5 lg:hidden">
          <button
            type="button"
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
    | 'onOpenAlertsModal'
    | 'entryOpportunitiesCount'
  >
> = ({
  activeNav,
  onSelectNav,
  onOpenEntryRadarModal,
  onOpenAlertsModal,
  entryOpportunitiesCount,
}) => {
  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--sf)] border-t border-[var(--bd)] px-2 py-1.5"
    >
      <div className="grid grid-cols-4 gap-1 max-w-md mx-auto">
        <button
          type="button"
          onClick={() => onSelectNav('matches')}
          className={`flex flex-col items-center justify-center py-1 rounded-xl text-[11px] font-semibold transition-colors ${
            activeNav === 'matches' ? 'text-[var(--rdt)]' : 'text-[var(--mu)]'
          }`}
        >
          <LayoutGrid className="w-4 h-4 mb-0.5" />
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
            <span className="absolute top-1 right-6 w-2 h-2 rounded-full bg-[var(--rd)]" />
          )}
        </button>

        <button
          type="button"
          onClick={onOpenAlertsModal}
          className="flex flex-col items-center justify-center py-1 rounded-xl text-[11px] font-semibold text-[var(--mu)] hover:text-[var(--tx)] transition-colors"
        >
          <Bell className="w-4 h-4 mb-0.5" />
          <span>Alerts</span>
        </button>

        <button
          type="button"
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
