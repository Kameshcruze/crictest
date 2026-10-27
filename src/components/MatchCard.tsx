import React from 'react';
import {
  MapPin,
  CheckCircle,
  Clock,
  ChevronRight,
  Share2,
} from 'lucide-react';
import { ParsedCricketMatch } from '../types/cricket';

interface MatchCardProps {
  match: ParsedCricketMatch;
  onSelect: (match: ParsedCricketMatch) => void;
  onInspect: (match: ParsedCricketMatch) => void;
}

export const MatchCard: React.FC<MatchCardProps> = ({ match, onSelect, onInspect }) => {
  const isLive = match.status === 'live';
  const isCompleted = match.status === 'completed';
  const isUpcoming = match.status === 'upcoming';

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
    const t1 = match.team1;
    const t2 = match.team2;
    const s1 = match.team1Score ? `${match.team1Score.runs}/${match.team1Score.wickets} (${match.team1Score.overs} ov)` : '';
    const s2 = match.team2Score ? `${match.team2Score.runs}/${match.team2Score.wickets} (${match.team2Score.overs} ov)` : '';
    const text = `${t1.name} vs ${t2.name}\n${s1 ? `${t1.shortName}: ${s1}\n` : ''}${s2 ? `${t2.shortName}: ${s2}\n` : ''}${match.resultText || match.statusLabel}\n${match.seriesName}`;
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
      className={`group relative rounded-2xl border p-4 sm:p-5 transition-all cursor-pointer flex flex-col justify-between ${
        isLive
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
            {isLive ? (
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
                  alt={match.team1.shortName}
                  className="w-6 h-6 rounded-full object-cover shrink-0 border border-slate-700 bg-slate-800 shadow-sm"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 shadow-sm"
                  style={{
                    backgroundColor: match.team1.color,
                    color: match.team1.textColor || '#ffffff',
                  }}
                >
                  {match.team1.shortName.slice(0, 2)}
                </div>
              )}
              <div className="truncate">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-slate-100 truncate">
                    {match.team1.shortName}
                  </span>
                  <span className="text-xs text-slate-400 truncate hidden sm:inline">
                    {match.team1.name}
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
                  alt={match.team2.shortName}
                  className="w-6 h-6 rounded-full object-cover shrink-0 border border-slate-700 bg-slate-800 shadow-sm"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 shadow-sm"
                  style={{
                    backgroundColor: match.team2.color,
                    color: match.team2.textColor || '#ffffff',
                  }}
                >
                  {match.team2.shortName.slice(0, 2)}
                </div>
              )}
              <div className="truncate">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-slate-100 truncate">
                    {match.team2.shortName}
                  </span>
                  <span className="text-xs text-slate-400 truncate hidden sm:inline">
                    {match.team2.name}
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

        {/* Win Probability Bar (if available) */}
        {match.winProbability && (
          <div className="mt-3 bg-slate-800/40 rounded-lg p-2 border border-slate-800/60">
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium mb-1">
              <span>{match.team1.shortName} {match.winProbability.team1Prob}%</span>
              <span className="text-slate-500">Win Probability</span>
              <span>{match.team2.shortName} {match.winProbability.team2Prob}%</span>
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

        <div className="flex items-center gap-1">
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
          <div className="text-emerald-400 group-hover:translate-x-0.5 transition-transform flex items-center">
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      </div>
    </div>
  );
};
