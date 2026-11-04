import React from 'react';
import {
  RefreshCw,
  Radio,
  Volume2,
  VolumeX,
  Send,
  Target,
} from 'lucide-react';

interface NavbarProps {
  countryCode?: string;
  onCountryCodeChange?: (code: string) => void;
  autoRefreshInterval?: number; // in seconds, 0 = paused
  onIntervalChange?: (sec: number) => void;
  secondsRemaining?: number;
  isFetching: boolean;
  onRefreshNow: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onOpenScriptModal?: () => void;
  onOpenInspectorModal?: () => void;
  onOpenTelegramModal: () => void;
  onOpenEntryRadarModal?: () => void;
  entryOpportunitiesCount?: number;
  isTelegramActive?: boolean;
  lastUpdated?: Date;
  isSseActive?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  isFetching,
  onRefreshNow,
  soundEnabled,
  onToggleSound,
  onOpenTelegramModal,
  onOpenEntryRadarModal,
  entryOpportunitiesCount = 0,
  isTelegramActive,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Brand Zone */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold tracking-tight text-white whitespace-nowrap">
                  Crex Scorer
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  LIVE
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Real-time Crex Match Extractor · Updated Every Second
              </p>
            </div>
          </div>

          {/* Controls Zone */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Manual Refresh Button */}
            <button
              type="button"
              onClick={onRefreshNow}
              disabled={isFetching}
              className="p-2 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50"
              title="Fetch latest matches now"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-emerald-400' : ''}`} />
            </button>

            {/* Sound Alerts Toggle */}
            <button
              type="button"
              onClick={onToggleSound}
              className={`p-2 rounded-lg border transition-colors ${
                soundEnabled
                  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20'
                  : 'text-slate-400 bg-slate-800 border-slate-700 hover:text-slate-200'
              }`}
              title={soundEnabled ? 'Live audio alerts ON (click to mute)' : 'Live audio alerts MUTED (click to unmute)'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Entry Radar & Possibilities Button */}
            <button
              type="button"
              onClick={onOpenEntryRadarModal}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all shadow-sm ${
                entryOpportunitiesCount > 0
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-900/40 ring-1 ring-emerald-400/60'
                  : 'bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30'
              }`}
              title="Check live entry possibilities (0.0 overs to finish) or wait for entry"
            >
              <Target className={`w-3.5 h-3.5 ${entryOpportunitiesCount > 0 ? 'text-white animate-pulse' : 'text-emerald-400'}`} />
              <span>Entry Radar</span>
              {entryOpportunitiesCount > 0 ? (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-white text-emerald-950 ml-0.5 shadow-sm">
                  {entryOpportunitiesCount} Ready
                </span>
              ) : (
                <span className="text-[10px] text-slate-400 hidden xl:inline">
                  (Wait)
                </span>
              )}
            </button>

            {/* Telegram Bot Integration Button */}
            <button
              type="button"
              onClick={onOpenTelegramModal}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors shadow-sm ${
                isTelegramActive
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40 ring-1 ring-blue-400/50'
                  : 'bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700'
              }`}
              title="Connect Telegram Bot to broadcast live cricket updates to your group"
            >
              <Send className="w-3.5 h-3.5 -rotate-12" />
              <span>Telegram Bot</span>
              {isTelegramActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

