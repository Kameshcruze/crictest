import React, { useState, useRef, useEffect } from 'react';
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
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  const hasActiveMobileFilter = Boolean(searchQuery.trim() || selectedFormat !== 'All');

  useEffect(() => {
    if (isMobilePanelOpen) {
      mobileSearchInputRef.current?.focus();
    }
  }, [isMobilePanelOpen]);

  const handleMobilePanelBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const nextTarget = e.relatedTarget as Node | null;
    if (nextTarget && mobilePanelRef.current?.contains(nextTarget)) {
      return;
    }
    if (!searchQuery.trim() && selectedFormat === 'All') {
      setIsMobilePanelOpen(false);
    }
  };

  return (
    <div className="space-y-3 mb-4">
      {/* Tablet Only (768px - 1023px): Full-width Search Bar above chips */}
      <div className="hidden md:block lg:hidden">
        <div className="relative w-full">
          <Search className="w-4 h-4 text-[var(--mu)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search teams, tournament, venue"
            aria-label="Search teams, tournament, venue"
            className="w-full bg-[var(--sf)] border border-[var(--bd)] rounded-xl pl-10 pr-8 py-2.5 text-xs text-[var(--tx)] placeholder-[var(--mu)] focus:border-[var(--rd)]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--mu)] hover:text-[var(--tx)] rounded-lg"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Status Filter Chips Row + Mobile 44px Search Button / Tablet Format Dropdown */}
      <div className="flex items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Filter matches by status"
          className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 min-w-0 flex-1"
        >
          <button
            type="button"
            aria-pressed={activeTab === 'all'}
            onClick={() => onTabChange('all')}
            className={`px-4 py-1.5 rounded-[22px] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              activeTab === 'all'
                ? 'bg-[var(--rd)] text-white shadow-xs'
                : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--tx)] hover:border-[var(--mu)]/60'
            }`}
          >
            All {totalCount}
          </button>

          <button
            type="button"
            aria-pressed={activeTab === 'live'}
            onClick={() => onTabChange('live')}
            className={`px-4 py-1.5 rounded-[22px] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
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
            aria-pressed={activeTab === 'upcoming'}
            onClick={() => onTabChange('upcoming')}
            className={`px-4 py-1.5 rounded-[22px] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'upcoming'
                ? 'bg-[var(--rd)] text-white shadow-xs'
                : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--tx)] hover:border-[var(--mu)]/60'
            }`}
          >
            Upcoming
          </button>

          <button
            type="button"
            aria-pressed={activeTab === 'completed'}
            onClick={() => onTabChange('completed')}
            className={`px-4 py-1.5 rounded-[22px] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'completed'
                ? 'bg-[var(--rd)] text-white shadow-xs'
                : 'bg-[var(--sf)] border border-[var(--bd)] text-[var(--tx)] hover:border-[var(--mu)]/60'
            }`}
          >
            Finished
          </button>
        </div>

        {/* Mobile Only (< 768px): 44px Search & Format Toggle Button at right end of chips row */}
        <button
          type="button"
          onClick={() => setIsMobilePanelOpen((prev) => !prev)}
          aria-expanded={isMobilePanelOpen}
          aria-controls="mobile-search-format-panel"
          aria-label={isMobilePanelOpen ? 'Close search and format filter' : 'Open search and format filter'}
          className={`md:hidden relative w-11 h-11 rounded-full flex items-center justify-center shrink-0 border transition-colors ${
            isMobilePanelOpen || hasActiveMobileFilter
              ? 'bg-[var(--rds)] border-[var(--rd)]/40 text-[var(--rdt)]'
              : 'bg-[var(--sf)] border-[var(--bd)] text-[var(--mu)] hover:text-[var(--tx)]'
          }`}
        >
          <Search className="w-4 h-4" />
          {hasActiveMobileFilter && (
            <span
              className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[var(--rd)]"
              aria-hidden="true"
            />
          )}
        </button>

        {/* Tablet Only (768px - 1023px): Format dropdown at right end of chips row */}
        <select
          aria-label="Filter by format"
          value={selectedFormat}
          onChange={(e) => onFormatChange(e.target.value)}
          className="hidden md:block lg:hidden bg-[var(--sf)] border border-[var(--rd)]/40 text-xs font-semibold text-[var(--rdt)] rounded-xl px-3 py-1.5 cursor-pointer focus:border-[var(--rd)] shrink-0"
        >
          {FORMAT_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f === 'All' ? 'All Formats' : f}
            </option>
          ))}
        </select>
      </div>

      {/* Mobile Collapsible Search + Format Panel (< 768px) */}
      {isMobilePanelOpen && (
        <div
          id="mobile-search-format-panel"
          ref={mobilePanelRef}
          onBlur={handleMobilePanelBlur}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setIsMobilePanelOpen(false);
            }
          }}
          className="md:hidden flex items-center gap-2 p-2.5 rounded-2xl bg-[var(--sf)] border border-[var(--bd)]"
          style={{ boxShadow: 'var(--card-shadow)' }}
        >
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-[var(--mu)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={mobileSearchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search teams, tournament, venue"
              aria-label="Search teams, tournament, venue"
              className="w-full bg-[var(--sf-2)] border border-[var(--bd)] rounded-xl pl-8 pr-7 py-2 text-xs text-[var(--tx)] placeholder-[var(--mu)] focus:border-[var(--rd)]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  onSearchChange('');
                  mobileSearchInputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--mu)] hover:text-[var(--tx)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            aria-label="Filter by format"
            value={selectedFormat}
            onChange={(e) => onFormatChange(e.target.value)}
            className="bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] rounded-xl px-2.5 py-2 cursor-pointer focus:border-[var(--rd)] shrink-0"
          >
            {FORMAT_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f === 'All' ? 'All Formats' : f}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};
