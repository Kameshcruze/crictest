import React from 'react';
import {
  CheckCircle,
  Clock,
  ChevronRight,
  Share2,
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

  return (
    <div
      onClick={() => onSelect(match)}
      style={{ boxShadow: 'var(--card-shadow)' }}
      className={`group relative rounded-2xl border p-4 transition-all duration-200 cursor-pointer flex flex-col justify-between bg-[var(--sf)] ${
        isScoreFlashing
          ? 'ring-2 ring-[var(--rd)] border-[var(--rd)]'
          : 'border-[var(--bd)] hover:border-[var(--mu)]/60'
      }`}
    >
      <div>
        {/* Top Header: Format · Venue & Status Pill */}
        <div className="flex items-center justify-between gap-2 mb-3.5 text-[11px]">
          <span className="text-[var(--mu)] font-medium truncate">
            {headerLocation}
          </span>

          <div className="shrink-0">
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
          </div>
        </div>

        {/* Teams & Scores */}
        <div className="space-y-3">
          {/* Team 1 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {match.team1.flagUrl ? (
                <img
                  src={match.team1.flagUrl}
                  alt={team1Short}
                  className="w-8 h-8 rounded-full object-cover shrink-0 border border-[var(--bd)] bg-[var(--sf-2)]"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
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
                      className="w-1.5 h-1.5 rounded-full bg-[var(--rd)] shrink-0"
                      title="Batting"
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
                  <div className="text-lg font-bold tabular-nums text-[var(--tx)] leading-tight">
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
              {match.team2.flagUrl ? (
                <img
                  src={match.team2.flagUrl}
                  alt={team2Short}
                  className="w-8 h-8 rounded-full object-cover shrink-0 border border-[var(--bd)] bg-[var(--sf-2)]"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
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
                      className="w-1.5 h-1.5 rounded-full bg-[var(--rd)] shrink-0"
                      title="Batting"
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
                  <div className="text-lg font-bold tabular-nums text-[var(--tx)] leading-tight">
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

        {/* Divider */}
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
                  <span className="text-[var(--mu)] animate-pulse">Loading...</span>
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
                  <span className="text-[var(--tx)] font-medium truncate">
                    Closed · Suspended
                  </span>
                ) : oddsState.status === 'error' ? (
                  <span className="text-[var(--rdt)] font-medium">Unavailable</span>
                ) : (
                  <span className="text-[var(--mu)] font-medium">Ready</span>
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

      {/* Footer Info: Series Name & Card Actions */}
      <div className="mt-3.5 pt-3 border-t border-[var(--bd)] flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-[11px] text-[var(--mu)]">
          {match.seriesName}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={copyMatchSummary}
            className="p-1.5 text-[var(--mu)] hover:text-[var(--tx)] rounded-lg hover:bg-[var(--sf-2)] transition-colors"
            title="Copy match summary"
            aria-label="Copy match summary"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInspect(match);
            }}
            className="px-2 py-1 text-[11px] text-[var(--mu)] hover:text-[var(--tx)] rounded-lg hover:bg-[var(--sf-2)] transition-colors font-mono font-medium"
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
            className="px-3 py-1.5 text-xs font-semibold text-[var(--rdt)] bg-[var(--sf)] hover:bg-[var(--rds)] border border-[var(--rd)]/35 rounded-xl transition-colors inline-flex items-center gap-1"
            title="Open Dedicated Match Analysis & Live Odds"
          >
            <span>Analysis</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
