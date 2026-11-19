import React from 'react';
import {
  Sun,
  Moon,
  Volume2,
  VolumeX,
  RefreshCw,
  Globe,
  Wifi,
} from 'lucide-react';
import { ThemeMode } from './ThemeToggle';

interface SettingsViewProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  countryCode: string;
  onCountryCodeChange: (code: string) => void;
  isFetching: boolean;
  onRefreshNow: () => void;
  isSseActive: boolean;
  latencyMs: number;
  lastUpdated: Date;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  theme,
  onThemeChange,
  soundEnabled,
  onToggleSound,
  countryCode,
  onCountryCodeChange,
  isFetching,
  onRefreshNow,
  isSseActive,
  latencyMs,
  lastUpdated,
}) => {
  const [ccDraft, setCcDraft] = React.useState(countryCode);

  React.useEffect(() => {
    setCcDraft(countryCode);
  }, [countryCode]);

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Appearance */}
      <section
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-sm font-bold text-[var(--tx)]">Appearance</h2>
        <p className="text-xs text-[var(--mu)] mt-0.5">
          Switch between Day and Night themes across all views and modals.
        </p>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <button
            type="button"
            onClick={() => onThemeChange('light')}
            className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition-all ${
              theme === 'light'
                ? 'bg-[var(--rds)] border-[var(--rd)] text-[var(--rdt)]'
                : 'bg-[var(--sf-2)] border-[var(--bd)] text-[var(--tx)] hover:border-[var(--mu)]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Sun className="w-4 h-4 shrink-0" />
              <div>
                <div className="text-xs font-bold">Day Mode</div>
                <div className="text-[11px] text-[var(--mu)]">Clean light surface</div>
              </div>
            </div>
            {theme === 'light' && (
              <span className="w-2 h-2 rounded-full bg-[var(--rd)]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onThemeChange('dark')}
            className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition-all ${
              theme === 'dark'
                ? 'bg-[var(--rds)] border-[var(--rd)] text-[var(--rdt)]'
                : 'bg-[var(--sf-2)] border-[var(--bd)] text-[var(--tx)] hover:border-[var(--mu)]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Moon className="w-4 h-4 shrink-0" />
              <div>
                <div className="text-xs font-bold">Night Mode</div>
                <div className="text-[11px] text-[var(--mu)]">Low-glare dark surface</div>
              </div>
            </div>
            {theme === 'dark' && (
              <span className="w-2 h-2 rounded-full bg-[var(--rd)]" />
            )}
          </button>
        </div>
      </section>

      {/* Live Feed & Audio */}
      <section
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-4"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[var(--tx)]">Live Feed & Audio</h2>
            <p className="text-xs text-[var(--mu)] mt-0.5">
              Control live match sync, audio chimes, and API region code.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)] tabular-nums">
            <Wifi className="w-3 h-3" />
            <span>{isSseActive ? 'SSE Stream Active' : 'Polling 1s'}</span>
            <span>·</span>
            <span>{latencyMs > 0 ? `${latencyMs}ms` : '—'}</span>
          </div>
        </div>

        <div className="divide-y divide-[var(--bd)] border-t border-[var(--bd)]">
          {/* Audio Chimes */}
          <div className="py-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] flex items-center justify-center text-[var(--tx)]">
                {soundEnabled ? <Volume2 className="w-4 h-4 text-[var(--rdt)]" /> : <VolumeX className="w-4 h-4 text-[var(--mu)]" />}
              </div>
              <div>
                <div className="text-xs font-semibold text-[var(--tx)]">Sound Alerts</div>
                <div className="text-[11px] text-[var(--mu)]">
                  Play chime on live wicket or boundary score updates
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onToggleSound}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                soundEnabled
                  ? 'bg-[var(--rd)] border-[var(--rd)] text-white'
                  : 'bg-[var(--sf-2)] border-[var(--bd)] text-[var(--mu)] hover:text-[var(--tx)]'
              }`}
            >
              {soundEnabled ? 'Enabled' : 'Muted'}
            </button>
          </div>

          {/* Country Code */}
          <div className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] flex items-center justify-center text-[var(--tx)]">
                <Globe className="w-4 h-4 text-[var(--blut)]" />
              </div>
              <div>
                <div className="text-xs font-semibold text-[var(--tx)]">Crex Region Code (cc)</div>
                <div className="text-[11px] text-[var(--mu)]">
                  Default is IN. Updates match feed payload immediately.
                </div>
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (ccDraft.trim()) onCountryCodeChange(ccDraft.trim().toUpperCase());
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={ccDraft}
                maxLength={6}
                onChange={(e) => setCcDraft(e.target.value.toUpperCase())}
                className="w-20 px-2.5 py-1.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-mono font-semibold text-[var(--tx)] text-center"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-xl bg-[var(--sf-2)] hover:bg-[var(--rds)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] hover:text-[var(--rdt)] transition-colors"
              >
                Apply
              </button>
            </form>
          </div>

          {/* Manual Refresh */}
          <div className="py-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] flex items-center justify-center text-[var(--tx)]">
                <RefreshCw className={`w-4 h-4 text-[var(--rdt)] ${isFetching ? 'animate-spin' : ''}`} />
              </div>
              <div>
                <div className="text-xs font-semibold text-[var(--tx)]">Manual Sync</div>
                <div className="text-[11px] text-[var(--mu)] tabular-nums">
                  Last updated: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onRefreshNow}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-[var(--sf-2)] hover:bg-[var(--rds)] border border-[var(--bd)] text-[var(--tx)] hover:text-[var(--rdt)] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              <span>{isFetching ? 'Syncing...' : 'Refresh Now'}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
