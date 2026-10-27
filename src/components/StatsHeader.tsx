import React from 'react';
import { Activity, Flame, Clock, CheckCircle2, Wifi } from 'lucide-react';
import { ParsedCricketMatch } from '../types/cricket';

interface StatsHeaderProps {
  matches: ParsedCricketMatch[];
  latencyMs: number;
  lastUpdated?: Date;
  activeTab: 'all' | 'live' | 'upcoming' | 'completed';
  onTabChange: (tab: 'all' | 'live' | 'upcoming' | 'completed') => void;
}

export const StatsHeader: React.FC<StatsHeaderProps> = ({
  matches,
  latencyMs,
  lastUpdated,
  activeTab,
  onTabChange,
}) => {
  const liveCount = matches.filter((m) => m.status === 'live').length;
  const upcomingCount = matches.filter((m) => m.status === 'upcoming').length;
  const completedCount = matches.filter((m) => m.status === 'completed').length;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 my-6">
      {/* Live Card */}
      <button
        type="button"
        onClick={() => onTabChange(activeTab === 'live' ? 'all' : 'live')}
        className={`text-left p-4 rounded-xl border transition-all ${
          activeTab === 'live'
            ? 'bg-rose-950/40 border-rose-500/50 ring-1 ring-rose-500/30'
            : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400">Live Matches</span>
          <div className="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400">
            <Flame className="w-4 h-4 animate-pulse" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-bold font-mono-numbers text-white">
            {liveCount}
          </span>
          {liveCount > 0 && (
            <span className="text-[11px] font-medium text-rose-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
              Active Now
            </span>
          )}
        </div>
      </button>

      {/* Upcoming Card */}
      <button
        type="button"
        onClick={() => onTabChange(activeTab === 'upcoming' ? 'all' : 'upcoming')}
        className={`text-left p-4 rounded-xl border transition-all ${
          activeTab === 'upcoming'
            ? 'bg-amber-950/40 border-amber-500/50 ring-1 ring-amber-500/30'
            : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400">Upcoming Fixtures</span>
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
            <Clock className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-bold font-mono-numbers text-white">
            {upcomingCount}
          </span>
          <span className="text-[11px] text-slate-400">Scheduled</span>
        </div>
      </button>

      {/* Completed Card */}
      <button
        type="button"
        onClick={() => onTabChange(activeTab === 'completed' ? 'all' : 'completed')}
        className={`text-left p-4 rounded-xl border transition-all ${
          activeTab === 'completed'
            ? 'bg-emerald-950/40 border-emerald-500/50 ring-1 ring-emerald-500/30'
            : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400">Finished & Results</span>
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-bold font-mono-numbers text-white">
            {completedCount}
          </span>
          <span className="text-[11px] text-slate-400">Completed</span>
        </div>
      </button>

      {/* API Stream Telemetry Card */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400">API Latency</span>
          <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
            <Wifi className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-bold font-mono-numbers text-white">
            {latencyMs > 0 ? `${latencyMs}` : '—'}
          </span>
          <span className="text-xs font-medium text-slate-400">ms</span>
          {lastUpdated && (
            <span className="text-[11px] text-slate-500 ml-auto font-mono-numbers hidden sm:inline">
              {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
