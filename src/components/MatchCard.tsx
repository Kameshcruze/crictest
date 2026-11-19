import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle,
  Clock,
  ChevronRight,
  Share2,
  MoreVertical,
  Code,
  Check,
} from 'lucide-react';
import { ParsedCricketMatch } from '../types/cricket';
import { MatchOddsState } from '../types/odds';
import { KNOWN_TEAMS } from '../data/cricketMapping';
import { parseInningsScore } from '../services/cricketApi';

interface MatchCardProps {
  match: ParsedCricketMatch;
  onSelect: (match: ParsedCricketMatch) => void;
  onInspect: (match: ParsedCricketMatch) => void;
  oddsState?: MatchOddsState;
}

export const MatchCard: React.FC<MatchCardProps> = ({ match, onSelect, onInspect, oddsState }) => {
  const isLive = match.status === 'live';
  const isCompleted = match.status === 'completed';
  const isUpcoming = match.status === 'upcoming';

  const [img1Failed, setImg1Failed] = useState(false);
  const [img2Failed, setImg2Failed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setImg1Failed(false);
  }, [match.team1.flagUrl]);

  useEffect(() => {
    setImg2Failed(false);
  }, [match.team2.flagUrl]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  // Dynamic resolution fallback: Check KNOWN_TEAMS or odds speechNames if name was fallback
  const team1Resolved = KNOWN_TEAMS[match.team1.key] || match.team1;
  const team2Resolved = KNOWN_TEAMS[match.team2.key] || match.team2;

  const team1Name =
    oddsState?.odds?.speechNames?.[match.team1.key] && team1Resolved.name.startsWith('Team ')
      ? oddsState.odds.speechNames[match.team1.key]
      : team1Resolved.name;

  const team1Short =
    team1Resolved.shortName !== match.team1.key && !team1Resolved.shortName.startsWith('TEAM')
      ? team1Resolved.shortName
      : oddsState?.odds?.speechNames?.[match.team1.key]
      ? oddsState.odds.speechNames[match.team1.key].slice(0, 4).toUpperCase()
      : match.team1.shortName;

  const team2Name =
    oddsState?.odds?.speechNames?.[match.team2.key] && team2Resolved.name.startsWith('Team ')
      ? oddsState.odds.speechNames[match.team2.key]
      : team2Resolved.name;

  const team2Short =
    team2Resolved.shortName !== match.team2.key && !team2Resolved.shortName.startsWith('TEAM')
      ? team2Resolved.shortName
      : oddsState?.odds?.speechNames?.[match.team2.key]
      ? oddsState.odds.speechNames[match.team2.key].slice(0, 4).toUpperCase()
      : match.team2.shortName;

  // Live sub-second score resolution: overlay raw ball-by-ball score from getSV3 if newer
  const rawJ = typeof oddsState?.odds?.raw?.j === 'string' ? oddsState.odds.raw.j : undefined;
  const rawK = typeof oddsState?.odds?.raw?.k === 'string' ? oddsState.odds.raw.k : undefined;

  const team1Score = React.useMemo(() => {
    if (rawJ) {
      const parsed = parseInningsScore(rawJ, 1);
      if (parsed) {
        if (!match.team1Score || parsed.totalBalls >= match.team1Score.totalBalls) {
          return { ...parsed, teamCode: team1Short };
        }
      }
    }
    return match.team1Score;
  }, [rawJ, match.team1Score, team1Short]);

  const team2Score = React.useMemo(() => {
    if (rawK) {
      const parsed = parseInningsScore(rawK, 2);
      if (parsed) {
        if (!match.team2Score || parsed.totalBalls >= match.team2Score.totalBalls) {
          return { ...parsed, teamCode: team2Short };
        }
      }
    }
    return match.team2Score;
  }, [rawK, match.team2Score, team2Short]);

  const [isScoreFlashing, setIsScoreFlashing] = React.useState(false);
  const prevScoreStringRef = React.useRef<string>('');

  React.useEffect(() => {
    const scoreKey = `${team1Score?.runs || 0}/${team1Score?.wickets || 0}(${team1Score?.overs || 0})-${team2Score?.runs || 0}/${team2Score?.wickets || 0}(${team2Score?.overs || 0})-${match.resultText || ''}`;
    if (prevScoreStringRef.current && prevScoreStringRef.current !== scoreKey) {
      setIsScoreFlashing(true);
      const timer = setTimeout(() => setIsScoreFlashing(false), 1200);
      return () => clearTimeout(timer);
    }
    prevScoreStringRef.current = scoreKey;
  }, [
    team1Score?.runs,
    team1Score?.wickets,
    team1Score?.overs,
    team2Score?.runs,
    team2Score?.wickets,
    team2Score?.overs,
    match.resultText,
  ]);

  const formatStartTime = (date: Date) => {
    try {
      const isToday = new Date().toDateString() === date.toDateString();
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) return `Today at ${timeStr}`;
      return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
    } catch {
      return 'Scheduled';
    }
  };

  const copyMatchSummary = (e: React.MouseEvent) => {
    e.stopPropagation();
    const s1 = team1Score ? `${team1Score.runs}/${team1Score.wickets} (${team1Score.overs} ov)` : '';
    const s2 = team2Score ? `${team2Score.runs}/${team2Score.wickets} (${team2Score.overs} ov)` : '';
    const text = `${team1Name} vs ${team2Name}\n${s1 ? `${team1Short}: ${s1}\n` : ''}${s2 ? `${team2Short}: ${s2}\n` : ''}${match.resultText || match.statusLabel}\n${match.seriesName}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setMenuOpen(false);
    setTimeout(() => setCopied(false), 2200);
  };

  const getLiveEquation = () => {
    if (isLive && match.target && team2Score && team2Score.totalBalls > 0) {
      const needed = Math.max(0, match.target - team2Score.runs);
      let maxOvers = 20;
      if (match.format.includes('ODI') || match.format.includes('List A')) maxOvers = 50;
      if (match.format.includes('T20')) maxOvers = 20;
      if (match.format.includes('Test') || match.format.includes('First Class')) maxOvers = 0;

      if (maxOvers > 0) {
        const remainingBalls = Math.max(0, maxOvers * 6 - team2Score.totalBalls);
        return `${needed} runs needed in ${remainingBalls} balls`;
      }
      return `Target: ${match.target} runs`;
    }

    if (match.resultText) return match.resultText;
    if (match.statusLabel && match.statusLabel !== 'Live') return match.statusLabel;

    if (match.target && team2Score) {
      const needed = Math.max(0, match.target - team2Score.runs);
      let maxOvers = 20;
      if (match.format.includes('ODI') || match.format.includes('List A')) maxOvers = 50;
      if (match.format.includes('T20')) maxOvers = 20;
      if (match.format.includes('Test') || match.format.includes('First Class')) maxOvers = 0;

      if (maxOvers > 0) {
        const remainingBalls = Math.max(0, maxOvers * 6 - team2Score.totalBalls);
        return `${needed} runs needed in ${remainingBalls} balls`;
      }
      return `Target: ${match.target} runs`;
    }

    if (match.sessionText) return match.sessionText;
    return '';
  };

  const equation = getLiveEquation();
  const headerLocation = match.matchTitlePrefix
    ? `${match.format} · ${match.venueName}`
    : `${match.format} · ${match.venueName || match.seriesName}`;

  const showImg1 = Boolean(match.team1.flagUrl && !img1Failed);
  const showImg2 = Boolean(match.team2.flagUrl && !img2Failed);

  return (
    <article
      style={{ boxShadow: 'var(--card-shadow)' }}
      className={`group relative rounded-2xl border p-4 transition-all duration-200 flex flex-col justify-between bg-[var(--sf)] ${
        isScoreFlashing
          ? 'ring-2 ring-[var(--rd)] border-[var(--rd)]'
          : 'border-[var(--bd)] hover:border-[var(--mu)]/60'
      }`}
    >
      <div>
        {/* Top Header: Format · Venue, Status Pill & 44px Overflow Menu */}
        <div className="flex items-center justify-between gap-2 mb-3.5 text-[11px]">
          <span className="text-[var(--mu)] font-medium truncate">
            {headerLocation}
          </span>

          <div className="flex items-center gap-1 shrink-0">
            {/* Screen-reader & visual Copied confirmation */}
            <span aria-live="polite" className="inline-flex items-center">
              {copied && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)] text-[10px] font-semibold mr-1">
                  <Check className="w-3 h-3" />
                  Copied
                </span>
              )}
            </span>

            {isScoreFlashing ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)] text-[10px] font-bold tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok-tx)] animate-ping" />
                Update
              </span>
            ) : isLive ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[var(--rds)] text-[var(--rdt)] text-[10px] font-bold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--rdt)]" />
                LIVE
              </span>
            ) : isCompleted ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--ok-bg)] text-[var(--ok-tx)] text-[10px] font-semibold">
                <CheckCircle className="w-3 h-3" />
                Finished
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--warn-bg)] text-[var(--warn-tx)] text-[10px] font-semibold">
                <Clock className="w-3 h-3" />
                {formatStartTime(match.startTime)}
              </span>
            )}

            {/* 44px Overflow Menu Button for Share & JSON */}
            <div ref={menuContainerRef} className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((prev) => !prev);
                }}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`More actions for ${team1Short} vs ${team2Short}`}
                className="w-11 h-11 -my-3 -mr-2.5 rounded-xl flex items-center justify-center text-[var(--mu)] hover:text-[var(--tx)] hover:bg-[var(--sf-2)] transition-colors"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  aria-label="Match actions"
                  className="absolute right-0 top-9 z-20 w-40 rounded-xl bg-[var(--sf)] border border-[var(--bd)] py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={copyMatchSummary}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-[var(--tx)] hover:bg-[var(--sf-2)] flex items-center gap-2 transition-colors"
                  >
                    <Share2 className="w-3.5 h-3.5 text-[var(--mu)]" />
                    <span>Share summary</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onInspect(match);
                    }}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-[var(--tx)] hover:bg-[var(--sf-2)] flex items-center gap-2 transition-colors"
                  >
                    <Code className="w-3.5 h-3.5 text-[var(--mu)]" />
                    <span>Inspect JSON</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Teams & Scores */}
        <div className="space-y-3">
          {/* Team 1 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {showImg1 ? (
                <img
                  src={match.team1.flagUrl}
                  alt={team1Short}
                  className="w-8 h-8 rounded-full object-cover shrink-0 border border-[var(--bd)] bg-[var(--sf-2)]"
                  onError={() => setImg1Failed(true)}
                />
              ) : (
                <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 bg-[var(--rds)] text-[var(--rdt)]">
                  {team1Short.slice(0, 2)}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-[var(--tx)] truncate">
                    {team1Short}
                  </span>
                  {match.battingTeamKey === match.team1.key && isLive && (
                    <span
                      role="img"
                      aria-label="Batting"
                      title="Batting"
                      className="w-1.5 h-1.5 rounded-full bg-[var(--rd)]/85 shrink-0"
                    />
                  )}
                </div>
                <div className="text-[11px] text-[var(--mu)] truncate">
                  {team1Name}
                </div>
              </div>
            </div>

            <div className="text-right shrink-0">
              {team1Score ? (
                <>
                  <div className="text-[20px] font-bold tabular-nums text-[var(--tx)] leading-tight">
                    {team1Score.runs}/{team1Score.wickets}
                  </div>
                  <div className="text-[11px] text-[var(--mu)] tabular-nums leading-tight mt-0.5">
                    {team1Score.overs} ov
                  </div>
                </>
              ) : (
                <span className="text-xs text-[var(--mu)]">Yet to bat</span>
              )}
            </div>
          </div>

          {/* Team 2 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {showImg2 ? (
                <img
                  src={match.team2.flagUrl}
                  alt={team2Short}
                  className="w-8 h-8 rounded-full object-cover shrink-0 border border-[var(--bd)] bg-[var(--sf-2)]"
                  onError={() => setImg2Failed(true)}
                />
              ) : (
                <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 bg-[var(--rds)] text-[var(--rdt)]">
                  {team2Short.slice(0, 2)}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-[var(--tx)] truncate">
                    {team2Short}
                  </span>
                  {match.battingTeamKey === match.team2.key && isLive && (
                    <span
                      role="img"
                      aria-label="Batting"
                      title="Batting"
                      className="w-1.5 h-1.5 rounded-full bg-[var(--rd)]/85 shrink-0"
                    />
                  )}
                </div>
                <div className="text-[11px] text-[var(--mu)] truncate">
                  {team2Name}
                </div>
              </div>
            </div>

            <div className="text-right shrink-0">
              {team2Score ? (
                <>
                  <div className="text-[20px] font-bold tabular-nums text-[var(--tx)] leading-tight">
                    {team2Score.runs}/{team2Score.wickets}
                  </div>
                  <div className="text-[11px] text-[var(--mu)] tabular-nums leading-tight mt-0.5">
                    {team2Score.overs} ov
                  </div>
                </>
              ) : (
                <span className="text-xs text-[var(--mu)]">
                  {isUpcoming ? 'Scheduled' : 'Yet to bat'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Single Divider (above Odds) */}
        <div className="mt-3.5 pt-3 border-t border-[var(--bd)] space-y-2.5">
          {/* Optional Chase / Result Equation */}
          {equation && (
            <p className="text-[11px] font-semibold text-[var(--rdt)] line-clamp-1">
              {equation}
            </p>
          )}

          {/* Odds Row */}
          {oddsState && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[var(--mu)] font-medium shrink-0">Odds</span>
                {oddsState.status === 'loading' ? (
                  <div className="flex items-center gap-1.5" aria-label="Loading odds">
                    <span className="inline-block h-4 w-20 rounded bg-[var(--sf-2)] animate-pulse" />
                    <span className="inline-block h-4 w-10 rounded bg-[var(--sf-2)] animate-pulse" />
                  </div>
                ) : oddsState.status === 'success' && oddsState.odds?.bookmaker && !oddsState.odds.bookmaker.isSuspended ? (
                  <div className="flex items-center gap-1.5 min-w-0">
                    {oddsState.odds.favoriteTeamName && (
                      <span className="font-bold text-[var(--tx)] truncate">
                        {oddsState.odds.favoriteTeamName}
                      </span>
                    )}
                    {oddsState.odds.bookmaker.backRate !== null && (
                      <span className="px-2 py-0.5 rounded-md bg-[var(--blu)] text-[var(--blut)] font-bold text-[11px] tabular-nums shrink-0">
                        B {oddsState.odds.bookmaker.backRate}
                      </span>
                    )}
                    {oddsState.odds.bookmaker.layRate !== null && (
                      <span className="px-2 py-0.5 rounded-md bg-[var(--rds)] text-[var(--rdt)] font-bold text-[11px] tabular-nums shrink-0">
                        L {oddsState.odds.bookmaker.layRate}
                      </span>
                    )}
                  </div>
                ) : oddsState.status === 'unavailable' || oddsState.odds?.bookmaker?.isSuspended ? (
                  <span className="text-[var(--mu)] font-normal truncate">
                    Closed · Suspended
                  </span>
                ) : oddsState.status === 'error' ? (
                  <span className="text-[var(--rdt)] font-medium">Unavailable</span>
                ) : (
                  <span className="text-[var(--mu)] font-normal">Ready</span>
                )}
              </div>
            </div>
          )}

          {/* Win Probability Bar */}
          {match.winProbability && (
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1 tabular-nums">
                <span className="font-bold text-[var(--tx)]">
                  {team1Short} {match.winProbability.team1Prob}%
                </span>
                <span className="text-[var(--mu)]">Win probability</span>
                <span className="font-bold text-[var(--tx)]">
                  {team2Short} {match.winProbability.team2Prob}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-[var(--bar)] rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-[var(--rd)] transition-all duration-500"
                  style={{ width: `${match.winProbability.team1Prob}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer: Series Name & Analysis Action Only (no second divider) */}
      <div className="mt-3.5 pt-1 flex items-center justify-between gap-3 text-xs">
        <span className="truncate text-[11px] text-[var(--mu)]">
          {match.seriesName}
        </span>

        <button
          type="button"
          onClick={() => onSelect(match)}
          className="px-3.5 py-2 text-xs font-semibold text-[var(--rdt)] bg-[var(--sf)] hover:bg-[var(--rds)] border border-[var(--rd)]/40 rounded-xl transition-colors inline-flex items-center gap-1 shrink-0"
          title="Open Dedicated Match Analysis & Live Odds"
        >
          <span>Analysis</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </article>
  );
};
