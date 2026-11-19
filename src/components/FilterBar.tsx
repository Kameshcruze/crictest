import React from 'react';
import { Search, X } from 'lucide-react';

interface FilterBarProps {
  activeTab: 'all' | 'live' | 'upcoming' | 'completed';
  onTabChange: (tab: 'all' | 'live' | 'upcoming' | 'completed') => void;
  selectedFormat: string;
  onFormatChange: (format: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  liveCount: number;
  totalCount: number;
}

const FORMAT_OPTIONS = ['All', 'T10', 'T20'];

export const FilterBar: React.FC<FilterBarProps> = ({
  activeTab,
  onTabChange,
  selectedFormat,
  onFormatChange,
  searchQuery,
  onSearchChange,
  liveCount,
  totalCount,
}) => {
  return (
    <div className="space-y-3 mb-4">
      {/* Mobile & Tablet Search + Format Row (Desktop puts these in TopHeaderBar) */}
      <div className="flex lg:hidden items-center gap-2">
        <div className="relative flex-1">
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
          className="bg-[var(--sf)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] rounded-xl px-2.5 py-2 cursor-pointer focus:outline-none focus:border-[var(--rd)] shrink-0"
        >
          {FORMAT_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f === 'All' ? 'All' : f}
            </option>
          ))}
        </select>
      </div>

      {/* Status Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
        <button
          type="button"
          onClick={() => onTabChange('all')}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
            activeTab === 'all'
              ? 'bg-[var(--rd)] text-white shadow-xs'
              : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--tx)] hover:border-[var(--mu)]/60'
          }`}
        >
          All {totalCount}
        </button>

        <button
          type="button"
          onClick={() => onTabChange('live')}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
            activeTab === 'live'
              ? 'bg-[var(--rd)] text-white shadow-xs'
              : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--tx)] hover:border-[var(--mu)]/60'
          }`}
        >
          <span className="md:hidden">Live {liveCount}</span>
          <span className="hidden md:inline">Live Now {liveCount}</span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange('upcoming')}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'upcoming'
              ? 'bg-[var(--rd)] text-white shadow-xs'
              : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--tx)] hover:border-[var(--mu)]/60'
          }`}
        >
          Upcoming
        </button>

        <button
          type="button"
          onClick={() => onTabChange('completed')}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'completed'
              ? 'bg-[var(--rd)] text-white shadow-xs'
              : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--tx)] hover:border-[var(--mu)]/60'
          }`}
        >
          Finished
        </button>
      </div>
    </div>
  );
};
