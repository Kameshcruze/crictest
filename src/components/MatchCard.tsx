import React from 'react';
import {
  MapPin,
  CheckCircle,
  Clock,
  ChevronRight,
  Share2,
} from 'lucide-react';
import { ParsedCricketMatch } from '../types/cricket';
import { MatchOddsState } from '../types/odds';
import { KNOWN_TEAMS } from '../data/cricketMapping';

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

  const [isScoreFlashing, setIsScoreFlashing] = React.useState(false);
  const prevScoreStringRef = React.useRef<string>('');

  React.useEffect(() => {
    const scoreKey = `${match.team1Score?.runs || 0}/${match.team1Score?.wickets || 0}(${match.team1Score?.overs || 0})-${match.team2Score?.runs || 0}/${match.team2Score?.wickets || 0}(${match.team2Score?.overs || 0})-${match.resultText || ''}`;
    if (prevScoreStringRef.current && prevScoreStringRef.current !== scoreKey) {
      setIsScoreFlashing(true);
      const timer = setTimeout(() => setIsScoreFlashing(false), 1200);
      return () => clearTimeout(timer);
    }
    prevScoreStringRef.current = scoreKey;
  }, [
    match.team1Score?.runs,
    match.team1Score?.wickets,
    match.team1Score?.overs,
    match.team2Score?.runs,
    match.team2Score?.wickets,
    match.team2Score?.overs,
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
    const s1 = match.team1Score ? `${match.team1Score.runs}/${match.team1Score.wickets} (${match.team1Score.overs} ov)` : '';
    const s2 = match.team2Score ? `${match.team2Score.runs}/${match.team2Score.wickets} (${match.team2Score.overs} ov)` : '';
    const text = `${team1Name} vs ${team2Name}\n${s1 ? `${team1Short}: ${s1}\n` : ''}${s2 ? `${team2Short}: ${s2}\n` : ''}${match.resultText || match.statusLabel}\n${match.seriesName}`;
    navigator.clipboard.writeText(text);
  };

  // Crex style live status text
  const getLiveEquation = () => {
    if (match.resultText) return match.resultText;
    if (match.statusLabel && match.statusLabel !== 'Live') return match.statusLabel;

    if (match.target && match.team2Score) {
      const needed = Math.max(0, match.target - match.team2Score.runs);
      let maxOvers = 20;
      if (match.format.includes('ODI') || match.format.includes('List A')) maxOvers = 50;
      if (match.format.includes('T20')) maxOvers = 20;
      if (match.format.includes('Test') || match.format.includes('First Class')) maxOvers = 0;

      if (maxOvers > 0) {
        const remainingBalls = Math.max(0, maxOvers * 6 - match.team2Score.totalBalls);
        return `${needed} runs needed in ${remainingBalls} balls`;
      }
      return `Target: ${match.target} runs`;
    }

    if (match.sessionText) return match.sessionText;
    if (isLive) return 'Match in progress';
    return isUpcoming ? `Starts ${formatStartTime(match.startTime)}` : '';
  };

  return (
    <div
      onClick={() => onSelect(match)}
      className={`group relative rounded-2xl border p-4 sm:p-5 transition-all duration-300 cursor-pointer flex flex-col justify-between ${
        isScoreFlashing
          ? 'ring-2 ring-emerald-400 bg-emerald-950/30 border-emerald-500 shadow-xl shadow-emerald-900/40 scale-[1.01]'
          : isLive
          ? 'bg-slate-900/95 border-slate-700/90 hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-950/20'
          : 'bg-slate-900/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/80'
      }`}
    >
      {/* Top Header: Match Number, Venue, Format & Live Badge */}
      <div>
        <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-800/80 text-xs">
          <div className="flex items-center gap-1.5 truncate text-slate-400">
            <span className="font-semibold text-slate-300 truncate max-w-[200px] sm:max-w-[260px]">
              {match.matchTitlePrefix ? `${match.matchTitlePrefix}, ${match.venueName}` : `${match.seriesName} · ${match.venueName}`}
            </span>
          </div>

          {/* Status Indicator */}
          <div>
            {isScoreFlashing ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold tracking-wider animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                BALL UPDATE
              </span>
            ) : isLive ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[11px] font-semibold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                Live
              </span>
            ) : isCompleted ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                <CheckCircle className="w-3 h-3" />
                Finished
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400">
                <Clock className="w-3 h-3" />
                {formatStartTime(match.startTime)}
              </span>
            )}
          </div>
        </div>

        {/* Teams & Scores (Crex style) */}
        <div className="space-y-3">
          {/* Team 1 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {match.team1.flagUrl ? (
                <img
                  src={match.team1.flagUrl}
                  alt={team1Short}
                  className="w-6 h-6 rounded-full object-cover shrink-0 border border-slate-700 bg-slate-800 shadow-sm"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 shadow-sm"
                  style={{
                    backgroundColor: team1Resolved.color || match.team1.color,
                    color: team1Resolved.textColor || '#ffffff',
                  }}
                >
                  {team1Short.slice(0, 2)}
                </div>
              )}
              <div className="truncate">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-slate-100 truncate">
                    {team1Short}
                  </span>
                  <span className="text-xs text-slate-400 truncate hidden sm:inline">
                    {team1Name}
                  </span>
                </div>
              </div>
            </div>

            {/* Team 1 Score */}
            <div className="text-right shrink-0 flex items-center gap-1.5">
              {match.team1Score ? (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base sm:text-lg font-bold font-mono-numbers text-white">
                    {match.team1Score.wickets > 0
                      ? `${match.team1Score.runs}-${match.team1Score.wickets}`
                      : `${match.team1Score.runs}`}
                  </span>
                  <span className="text-xs text-slate-400 font-mono-numbers">
                    {match.team1Score.overs}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-slate-500 font-mono-numbers">Yet to bat</span>
              )}
              {match.battingTeamKey === match.team1.key && isLive && (
                <span className="text-xs shrink-0 text-amber-400" title="Batting">
                  🏏
                </span>
              )}
            </div>
          </div>

          {/* Team 2 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {match.team2.flagUrl ? (
                <img
                  src={match.team2.flagUrl}
                  alt={team2Short}
                  className="w-6 h-6 rounded-full object-cover shrink-0 border border-slate-700 bg-slate-800 shadow-sm"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 shadow-sm"
                  style={{
                    backgroundColor: team2Resolved.color || match.team2.color,
                    color: team2Resolved.textColor || '#ffffff',
                  }}
                >
                  {team2Short.slice(0, 2)}
                </div>
              )}
              <div className="truncate">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-slate-100 truncate">
                    {team2Short}
                  </span>
                  <span className="text-xs text-slate-400 truncate hidden sm:inline">
                    {team2Name}
                  </span>
                </div>
              </div>
            </div>

            {/* Team 2 Score */}
            <div className="text-right shrink-0 flex items-center gap-1.5">
              {match.team2Score ? (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base sm:text-lg font-bold font-mono-numbers text-white">
                    {match.team2Score.wickets > 0
                      ? `${match.team2Score.runs}-${match.team2Score.wickets}`
                      : `${match.team2Score.runs}`}
                  </span>
                  <span className="text-xs text-slate-400 font-mono-numbers">
                    {match.team2Score.overs}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-slate-500 font-mono-numbers">
                  {isUpcoming ? 'Scheduled' : 'Yet to bat'}
                </span>
              )}
              {match.battingTeamKey === match.team2.key && isLive && (
                <span className="text-xs shrink-0 text-amber-400" title="Batting">
                  🏏
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Live Status / Chasing Equation (Crex style amber footer) */}
        <div className="mt-3.5 pt-3 border-t border-slate-800/60">
          <p className="text-xs font-semibold text-amber-300/95 line-clamp-1">
            {getLiveEquation()}
          </p>
        </div>

        {/* Dedicated Live Match Odds Strip (Phase 4 Verified Integration) */}
        {oddsState && (
          <div className="mt-2.5 px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800/90 flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5 truncate">
              <span className="font-semibold text-slate-400">Odds:</span>
              {oddsState.status === 'loading' ? (
                <span className="text-slate-500 animate-pulse font-mono">Loading...</span>
              ) : oddsState.status === 'success' && oddsState.odds?.bookmaker && !oddsState.odds.bookmaker.isSuspended ? (
                <div className="flex items-center gap-1.5">
                  {oddsState.odds.favoriteTeamName && (
                    <span className="font-bold text-amber-300 truncate max-w-[80px]">
                      {oddsState.odds.favoriteTeamName}
                    </span>
                  )}
                  {oddsState.odds.bookmaker.backRate !== null && (
                    <span className="px-1.5 py-0.5 rounded bg-sky-950/80 border border-sky-600/40 text-sky-300 font-mono font-bold text-[10px]">
                      B: {oddsState.odds.bookmaker.backRate}
                    </span>
                  )}
                  {oddsState.odds.bookmaker.layRate !== null && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-600/40 text-rose-300 font-mono font-bold text-[10px]">
                      L: {oddsState.odds.bookmaker.layRate}
                    </span>
                  )}
                </div>
              ) : oddsState.status === 'unavailable' || oddsState.odds?.bookmaker?.isSuspended ? (
                <span className="text-slate-500 font-mono text-[10px]">Closed / Suspended</span>
              ) : oddsState.status === 'error' ? (
                <span className="text-rose-400 font-mono text-[10px]">Unavailable</span>
              ) : (
                <span className="text-slate-500 font-mono text-[10px]">Ready</span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {oddsState.consistency.status === 'verified' && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400"
                  title="Verified mapping with cricket match"
                />
              )}
              <span className="text-[10px] text-slate-500 font-mono">
                {oddsState.maskedKey}
              </span>
            </div>
          </div>
        )}

        {/* Win Probability Bar (if available) */}
        {match.winProbability && (
          <div className="mt-3 bg-slate-800/40 rounded-lg p-2 border border-slate-800/60">
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium mb-1">
              <span>{team1Short} {match.winProbability.team1Prob}%</span>
              <span className="text-slate-500">Win Probability</span>
              <span>{team2Short} {match.winProbability.team2Prob}%</span>
            </div>
            <div className="h-1.5 w-full bg-slate-700/60 rounded-full overflow-hidden flex">
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${match.winProbability.team1Prob}%`,
                  backgroundColor: match.team1.color,
                }}
              />
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${match.winProbability.team2Prob}%`,
                  backgroundColor: match.team2.color,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer Info: Series Name & Card Actions */}
      <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-1.5 truncate max-w-[200px]">
          <span className="truncate text-[11px] text-slate-400">{match.seriesName}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={copyMatchSummary}
            className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
            title="Copy match summary"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInspect(match);
            }}
            className="px-2 py-1 text-[11px] text-slate-300 hover:text-white rounded hover:bg-slate-800 transition-colors font-mono"
            title="Inspect raw match JSON"
          >
            JSON
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(match);
            }}
            className="px-2.5 py-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-500/30 rounded-md transition-colors flex items-center gap-1 group-hover:border-emerald-500/60"
            title="Open Dedicated Match Analysis & Live Odds"
          >
            <span>Analysis</span>
            <ChevronRight className="w-3.5 h-3.5 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
};
