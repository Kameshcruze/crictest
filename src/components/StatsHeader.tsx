import React from 'react';
import { ParsedCricketMatch } from '../types/cricket';

interface StatsHeaderProps {
  matches: ParsedCricketMatch[];
  latencyMs?: number;
  lastUpdated?: Date;
  activeTab: 'all' | 'live' | 'upcoming' | 'completed';
  onTabChange: (tab: 'all' | 'live' | 'upcoming' | 'completed') => void;
}

export const StatsHeader: React.FC<StatsHeaderProps> = ({
  matches,
  activeTab,
  onTabChange,
}) => {
  const liveCount = matches.filter((m) => m.status === 'live').length;
  const upcomingCount = matches.filter((m) => m.status === 'upcoming').length;
  const completedCount = matches.filter((m) => m.status === 'completed').length;

  return (
    <>
      {/* Mobile Compact 3-Column Strip */}
      <div
        className="md:hidden grid grid-cols-3 rounded-2xl bg-[var(--sf)] border border-[var(--bd)] py-3 mb-4"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <button
          type="button"
          onClick={() => onTabChange(activeTab === 'live' ? 'all' : 'live')}
          className="flex flex-col items-center justify-center text-center px-2 border-r border-[var(--bd)]"
        >
          <span className="text-xl font-bold tabular-nums text-[var(--rdt)]">
            {liveCount}
          </span>
          <span className="text-[11px] font-medium text-[var(--mu)]">Live</span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange(activeTab === 'upcoming' ? 'all' : 'upcoming')}
          className="flex flex-col items-center justify-center text-center px-2 border-r border-[var(--bd)]"
        >
          <span className="text-xl font-bold tabular-nums text-[var(--tx)]">
            {upcomingCount}
          </span>
          <span className="text-[11px] font-medium text-[var(--mu)]">Upcoming</span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange(activeTab === 'completed' ? 'all' : 'completed')}
          className="flex flex-col items-center justify-center text-center px-2"
        >
          <span className="text-xl font-bold tabular-nums text-[var(--tx)]">
            {completedCount}
          </span>
          <span className="text-[11px] font-medium text-[var(--mu)]">Finished</span>
        </button>
      </div>

      {/* Tablet & Desktop 3 KPI Cards */}
      <div className="hidden md:grid grid-cols-3 gap-3.5 mb-5">
        <button
          type="button"
          onClick={() => onTabChange(activeTab === 'live' ? 'all' : 'live')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            activeTab === 'live'
              ? 'bg-[var(--sf)] border-[var(--rd)] ring-1 ring-[var(--rd)]/25'
              : 'bg-[var(--sf)] border-[var(--bd)] hover:border-[var(--mu)]/50'
          }`}
          style={{ boxShadow: 'var(--card-shadow)' }}
        >
          <div className="text-xs font-medium text-[var(--mu)]">
            <span className="lg:hidden">Live</span>
            <span className="hidden lg:inline">Live matches</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-bold tabular-nums text-[var(--rdt)]">
              {liveCount}
            </span>
            <span className="text-xs text-[var(--mu)]">
              <span className="lg:hidden">now</span>
              <span className="hidden lg:inline">active now</span>
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onTabChange(activeTab === 'upcoming' ? 'all' : 'upcoming')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            activeTab === 'upcoming'
              ? 'bg-[var(--sf)] border-[var(--rd)] ring-1 ring-[var(--rd)]/25'
              : 'bg-[var(--sf)] border-[var(--bd)] hover:border-[var(--mu)]/50'
          }`}
          style={{ boxShadow: 'var(--card-shadow)' }}
        >
          <div className="text-xs font-medium text-[var(--mu)]">
            <span className="lg:hidden">Upcoming</span>
            <span className="hidden lg:inline">Upcoming fixtures</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-bold tabular-nums text-[var(--tx)]">
              {upcomingCount}
            </span>
            <span className="text-xs text-[var(--mu)] hidden lg:inline">scheduled</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onTabChange(activeTab === 'completed' ? 'all' : 'completed')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            activeTab === 'completed'
              ? 'bg-[var(--sf)] border-[var(--rd)] ring-1 ring-[var(--rd)]/25'
              : 'bg-[var(--sf)] border-[var(--bd)] hover:border-[var(--mu)]/50'
          }`}
          style={{ boxShadow: 'var(--card-shadow)' }}
        >
          <div className="text-xs font-medium text-[var(--mu)]">Finished</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-bold tabular-nums text-[var(--tx)]">
              {completedCount}
            </span>
            <span className="text-xs text-[var(--mu)] hidden lg:inline">completed</span>
          </div>
        </button>
      </div>
    </>
  );
};
