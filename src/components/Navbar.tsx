import React from 'react';
import {
  RefreshCw,
  Radio,
  Code2,
  Terminal,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Zap,
} from 'lucide-react';

interface NavbarProps {
  countryCode: string;
  onCountryCodeChange: (code: string) => void;
  autoRefreshInterval: number; // in seconds, 0 = paused
  onIntervalChange: (sec: number) => void;
  secondsRemaining: number;
  isFetching: boolean;
  onRefreshNow: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onOpenScriptModal: () => void;
  onOpenInspectorModal: () => void;
  lastUpdated?: Date;
  isSseActive?: boolean;
}

const COUNTRY_OPTIONS = [
  { code: 'IN', label: 'India (IN)' },
  { code: 'AU', label: 'Australia (AU)' },
  { code: 'GB', label: 'UK (GB)' },
  { code: 'ZA', label: 'South Africa (ZA)' },
  { code: 'NZ', label: 'New Zealand (NZ)' },
  { code: 'PK', label: 'Pakistan (PK)' },
  { code: 'GLOBAL', label: 'All Regions' },
];

export const Navbar: React.FC<NavbarProps> = ({
  countryCode,
  onCountryCodeChange,
  autoRefreshInterval,
  onIntervalChange,
  secondsRemaining,
  isFetching,
  onRefreshNow,
  soundEnabled,
  onToggleSound,
  onOpenScriptModal,
  onOpenInspectorModal,
  isSseActive,
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
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/40">
                  <Zap className="w-3 h-3 text-amber-400 animate-bounce" />
                  {isSseActive ? 'Instant Push' : '1s Real-time'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Real-time Crex Match Extractor · Updated Every Second
              </p>
            </div>
          </div>

          {/* Controls Zone */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Country Selector */}
            <div className="relative hidden md:block">
              <select
                value={countryCode}
                onChange={(e) => onCountryCodeChange(e.target.value)}
                className="bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                title="API Payload Country Code"
              >
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Auto-Refresh Timer & Interval */}
            <div className="flex items-center bg-slate-800/80 border border-slate-700 rounded-lg p-1 text-xs">
              <button
                type="button"
                onClick={() => onIntervalChange(autoRefreshInterval === 0 ? 1 : 0)}
                className={`px-2 py-1 rounded flex items-center gap-1 font-medium transition-colors ${
                  autoRefreshInterval > 0
                    ? 'text-emerald-400 hover:bg-slate-700'
                    : 'text-amber-400 hover:bg-slate-700'
                }`}
                title={autoRefreshInterval > 0 ? 'Pause live auto-refresh' : 'Resume live auto-refresh'}
              >
                {autoRefreshInterval > 0 ? (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    <span className="font-mono-numbers text-[11px]">
                      {secondsRemaining}s
                    </span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Paused</span>
                  </>
                )}
              </button>

              <select
                value={autoRefreshInterval}
                onChange={(e) => onIntervalChange(Number(e.target.value))}
                className="bg-transparent text-slate-300 text-[11px] border-l border-slate-700 pl-1.5 pr-1 py-0.5 focus:outline-none cursor-pointer font-medium"
                title="Select live refresh frequency"
              >
                <option value={1} className="bg-slate-900 text-slate-100">1s (Every Second)</option>
                <option value={2} className="bg-slate-900 text-slate-100">2s</option>
                <option value={3} className="bg-slate-900 text-slate-100">3s</option>
                <option value={5} className="bg-slate-900 text-slate-100">5s</option>
                <option value={0} className="bg-slate-900 text-slate-100">Off</option>
              </select>
            </div>

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

            {/* Online Script Modal Button */}
            <button
              type="button"
              onClick={onOpenScriptModal}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors shadow-sm"
              title="Online scripts: Cloudflare Worker, Python, Node.js continuous runners"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Online Script</span>
            </button>

            {/* Raw API Inspector Button */}
            <button
              type="button"
              onClick={onOpenInspectorModal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors shadow-sm shadow-emerald-900/30"
              title="Inspect payload and raw JSON data from api.goscorer.com"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">API Inspector</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
