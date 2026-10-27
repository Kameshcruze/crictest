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

const FORMAT_OPTIONS = ['All', 'T20', 'ODI', 'Test', 'First Class'];

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
    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pb-4 border-b border-slate-800">
      {/* Tab Selectors */}
      <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => onTabChange('all')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'all'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          All Matches ({totalCount})
        </button>

        <button
          type="button"
          onClick={() => onTabChange('live')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'live'
              ? 'bg-rose-950/80 text-rose-300 border border-rose-800/60 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
          <span>Live Now</span>
          {liveCount > 0 && (
            <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-mono-numbers">
              {liveCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onTabChange('upcoming')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'upcoming'
              ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Upcoming
        </button>

        <button
          type="button"
          onClick={() => onTabChange('completed')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'completed'
              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Finished
        </button>
      </div>

      {/* Search and Format dropdown */}
      <div className="flex items-center gap-2">
        {/* Search Input */}
        <div className="relative flex-1 sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search teams, tournament, venue..."
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Format Selector */}
        <select
          value={selectedFormat}
          onChange={(e) => onFormatChange(e.target.value)}
          className="bg-slate-900 border border-slate-800 text-xs text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
        >
          {FORMAT_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f === 'All' ? 'All Formats' : f}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
