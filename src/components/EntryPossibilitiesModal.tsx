import React, { useMemo, useState } from 'react';
import {
  X,
  Target,
  Clock,
  ShieldAlert,
  ArrowRight,
  TrendingUp,
  Layers,
  Sparkles,
  HelpCircle,
  Activity,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { ParsedCricketMatch } from '../types/cricket';
import { MatchOddsState } from '../types/odds';
import {
  strategyEngine,
  calculateOpposingOdds,
  isWithinEntryWindow,
  detectTeamInControl,
} from '../services/strategy/engine';

export interface EntryOpportunity {
  matchId: string;
  match: ParsedCricketMatch;
  type: 'FIRST_ENTRY' | 'SECOND_ENTRY';
  teamName: string;
  decimalOdds: number;
  opposingOdds?: number;
  currentOver: number;
  currentInnings: number;
  runs: number;
  wickets: number;
  crr?: number;
  explanation: string;
  booksetTarget: string;
  windowLimitOver: number;
  timestamp: Date;
}

export interface MatchRadarStatus {
  matchId: string;
  match: ParsedCricketMatch;
  oddsState?: MatchOddsState;
  decimalOdds: number | null;
  opposingOdds: number | null;
  currentOver: number;
  currentInnings: number;
  inWindow: boolean;
  hasFirstEntryRecorded: boolean;
  firstEntryQualified: boolean;
  secondEntryQualified: boolean;
  secondEntryLockedReason?: string;
  distanceToFirstEntry?: string;
  statusSummary: string;
}

interface EntryPossibilitiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  matches: ParsedCricketMatch[];
  oddsByMatchId: Record<string, MatchOddsState>;
  onSelectMatch: (matchId: string) => void;
  recordedFirstEntries?: Set<string>;
}

export const EntryPossibilitiesModal: React.FC<EntryPossibilitiesModalProps> = ({
  isOpen,
  onClose,
  matches,
  oddsByMatchId,
  onSelectMatch,
  recordedFirstEntries = new Set(),
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'opportunities' | 'monitoring'>('all');

  // Compute live entry radar analysis across all matches
  const { opportunities, radarWatchlist } = useMemo(() => {
    const oppList: EntryOpportunity[] = [];
    const watchList: MatchRadarStatus[] = [];

    const liveMatches = matches.filter(
      (m) => m.status === 'live' || (m.status !== 'completed' && (m.team1Score || m.team2Score))
    );

    for (const match of liveMatches) {
      const oddsState = oddsByMatchId[match.id];
      const activeScore = match.team2Score || match.team1Score;
      const currentInnings = match.team2Score ? 2 : 1;
      const currentOver = activeScore ? activeScore.overs : 0;
      const runs = activeScore ? activeScore.runs : 0;
      const wickets = activeScore ? activeScore.wickets : 0;
      const crr = match.currentRunRate;

      const decimalOdds =
        oddsState?.odds?.bookmaker?.decimalBack ??
        oddsState?.odds?.bookmaker?.decimalLay ??
        null;
      const opposingOdds = decimalOdds ? calculateOpposingOdds(decimalOdds) : null;
      const inWindow = isWithinEntryWindow(currentInnings, currentOver);
      const controlInfo = detectTeamInControl(match, oddsState);
      const isBattingInControl = controlInfo.teamInControl === 'BATTING';
      const engineState = strategyEngine.getState(match.id);
      const isDisqualifiedByWickets = wickets >= 3 && !recordedFirstEntries.has(match.id) && engineState.stage !== 'ACTIVE_FIRST_ENTRY';

      // Check if First Entry was recorded in DB or actively held by strategy engine
      const hasFirstEntryRecorded =
        recordedFirstEntries.has(match.id) ||
        engineState.stage === 'ACTIVE_FIRST_ENTRY' ||
        engineState.stage === 'FIRST_BOOKSET_COMPLETED' ||
        engineState.firstEntryPosition.status === 'RECORDED_ENTRY';

      // Booking Team is strictly the batting team of that innings
      const bookingTeamDisplay = engineState.bookingTeamName || controlInfo.battingTeamName;

      // 1. Evaluate First Entry: 2nd boundary confirmed with batting in control and odds >= 85 paise
      const firstEntryQualified =
        !isDisqualifiedByWickets &&
        inWindow &&
        (engineState.stage === 'ACTIVE_FIRST_ENTRY' ||
          (engineState.stage === 'CONFIRMED_PENDING_85' && decimalOdds !== null && decimalOdds >= 1.85 && isBattingInControl));

      // 2. Evaluate Second Entry: STRICT RULE
      // "without the first entry you should not send the 2nd entry message."
      let secondEntryQualified = false;
      let secondEntryLockedReason: string | undefined;

      if (isDisqualifiedByWickets) {
        secondEntryLockedReason = `Match skipped: ${wickets} wickets fell before entry (limit < 3).`;
      } else if (!hasFirstEntryRecorded && !firstEntryQualified) {
        secondEntryLockedReason = 'Locked: First Entry must appear and be recorded before 2nd entry can unlock.';
      } else if (!inWindow) {
        secondEntryLockedReason = `Window closed: Over ${currentOver} > ${currentInnings === 1 ? '10.0' : '6.0'} ov.`;
      } else if (!opposingOdds || opposingOdds >= 1.65) {
        secondEntryLockedReason = `Waiting: Opposing odds must drop below 1.65 / 65 paise (Currently: ${opposingOdds ? opposingOdds.toFixed(2) : 'N/A'}).`;
      } else {
        secondEntryQualified = true;
      }

      // Add to Opportunities list
      const teamName = bookingTeamDisplay;
      const windowLimitOver = currentInnings === 1 ? 10.0 : 6.0;

      if (firstEntryQualified && !hasFirstEntryRecorded) {
        oppList.push({
          matchId: match.id,
          match,
          type: 'FIRST_ENTRY',
          teamName,
          decimalOdds: decimalOdds!,
          opposingOdds: opposingOdds ?? undefined,
          currentOver,
          currentInnings,
          runs,
          wickets,
          crr,
          explanation: `Booking team ${teamName} (Batting) confirmed via 2 boundaries. Odds ${decimalOdds!.toFixed(2)} are in optimal 1st entry range >= 1.85 / 85 paise.`,
          booksetTarget: '45 - 55 Paise (1.45 - 1.55)',
          windowLimitOver,
          timestamp: new Date(),
        });
      }

      if (secondEntryQualified && opposingOdds) {
        oppList.push({
          matchId: match.id,
          match,
          type: 'SECOND_ENTRY',
          teamName,
          decimalOdds: decimalOdds!,
          opposingOdds,
          currentOver,
          currentInnings,
          runs,
          wickets,
          crr,
          explanation: `Opposing odds ${opposingOdds.toFixed(2)} are below 1.65 / 65 paise after confirmed wicket with verified prior 1st entry on ${teamName}.`,
          booksetTarget: 'Opposing Odds >= 85 Paise (1.85)',
          windowLimitOver,
          timestamp: new Date(),
        });
      }

      // Compute status summary & distance to entry
      let distanceToFirstEntry = '';
      let statusSummary = '';

      if (isDisqualifiedByWickets || engineState.stage === 'DISQUALIFIED_3_WICKETS') {
        statusSummary = `⚠️ Skipped: ${wickets} wickets before entry (>= 3 limit)`;
      } else if (hasFirstEntryRecorded || engineState.stage === 'ACTIVE_FIRST_ENTRY') {
        statusSummary = `🛡️ 1st Entry Active on ${bookingTeamDisplay} (Holding state - Bookset target 45-55)`;
      } else if (engineState.stage === 'CONFIRMED_PENDING_85') {
        statusSummary = `⏳ 2nd Boundary Confirmed: Waiting for ${bookingTeamDisplay} to cross 85p in control`;
      } else if (engineState.stage === 'CONFIRMED_BOOKING_TEAM') {
        statusSummary = `🎯 Booking Confirmed: ${bookingTeamDisplay} (Waiting for 2nd boundary 4 >= 11p or 6 >= 18p)`;
      } else if (engineState.stage === 'WAITING_FOR_CONFIRMATION') {
        statusSummary = `⏳ Waiting for Booking Team: ${controlInfo.battingTeamName} must hit 4 (>= 11p) or 6 (>= 18p) in control`;
      } else if (firstEntryQualified) {
        statusSummary = '🎯 1st Entry Ready NOW';
      } else if (secondEntryQualified) {
        statusSummary = '🚀 2nd Entry Ready NOW';
      } else if (!inWindow) {
        statusSummary = `Window passed (${currentOver} ov > ${windowLimitOver} ov limit)`;
      } else if (decimalOdds !== null) {
        statusSummary = `Monitoring ball-by-ball odds & boundary shifts on ${controlInfo.battingTeamName}...`;
      } else {
        statusSummary = 'Connecting to real-time odds feed...';
      }

      watchList.push({
        matchId: match.id,
        match,
        oddsState,
        decimalOdds,
        opposingOdds,
        currentOver,
        currentInnings,
        inWindow,
        hasFirstEntryRecorded,
        firstEntryQualified,
        secondEntryQualified,
        secondEntryLockedReason,
        distanceToFirstEntry,
        statusSummary,
      });
    }

    return { opportunities: oppList, radarWatchlist: watchList };
  }, [matches, oddsByMatchId, recordedFirstEntries]);

  if (!isOpen) return null;

  const displayList =
    filterMode === 'opportunities'
      ? radarWatchlist.filter((m) => m.firstEntryQualified || m.secondEntryQualified)
      : filterMode === 'monitoring'
      ? radarWatchlist.filter((m) => !m.firstEntryQualified && !m.secondEntryQualified)
      : radarWatchlist;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-100"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-radar-title"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Target className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="entry-radar-title" className="text-lg font-bold tracking-tight text-white">
                  Entry Radar & Opportunities
                </h2>
                {opportunities.length > 0 ? (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    {opportunities.length} Opportunity Active
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
                    Scanning {radarWatchlist.length} Matches
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Ball 0.0 to match end surveillance · Strict rule: 2nd entry never fires without prior 1st entry
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="px-6 py-2.5 bg-slate-900/60 border-b border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filterMode === 'all'
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Matches ({radarWatchlist.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('opportunities')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                filterMode === 'opportunities'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              Ready Entries ({opportunities.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('monitoring')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filterMode === 'monitoring'
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Waiting for Entry ({radarWatchlist.filter((m) => !m.firstEntryQualified && !m.secondEntryQualified).length})
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-slate-400">
            <Activity className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
            <span>Updated Every Second</span>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Active Opportunities Section (if any) */}
          {opportunities.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white tracking-wide uppercase">
                  Actionable Entry Opportunities ({opportunities.length})
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {opportunities.map((opp, idx) => (
                  <div
                    key={`${opp.matchId}-${opp.type}-${idx}`}
                    className={`p-4 rounded-xl border transition-all ${
                      opp.type === 'FIRST_ENTRY'
                        ? 'bg-emerald-950/30 border-emerald-500/40 hover:border-emerald-500/70'
                        : 'bg-indigo-950/30 border-indigo-500/40 hover:border-indigo-500/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold ${
                          opp.type === 'FIRST_ENTRY'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                        }`}
                      >
                        <Target className="w-3 h-3" />
                        {opp.type === 'FIRST_ENTRY' ? '1ST ENTRY QUALIFIED' : '2ND ENTRY QUALIFIED'}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        Inn {opp.currentInnings} · Over {opp.currentOver}
                      </span>
                    </div>

                    <h4 className="font-bold text-white text-base">
                      {opp.match.team1.shortName} vs {opp.match.team2.shortName}
                    </h4>
                    <p className="text-xs text-slate-400 mb-3 truncate">
                      {opp.match.seriesName || opp.match.format} · {opp.match.venueName || 'Live'}
                    </p>

                    <div className="grid grid-cols-2 gap-2 bg-slate-900/80 rounded-lg p-2.5 mb-3 text-xs">
                      <div>
                        <div className="text-slate-400 text-[10px]">Active Odds</div>
                        <div className="font-mono font-bold text-emerald-400 text-sm">
                          {opp.decimalOdds.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px]">
                          {opp.type === 'FIRST_ENTRY' ? 'Target Range' : 'Opposing Odds'}
                        </div>
                        <div className="font-mono font-bold text-slate-200 text-sm">
                          {opp.type === 'FIRST_ENTRY'
                            ? '1.85 - 2.00'
                            : opp.opposingOdds
                            ? `< 1.65 (${opp.opposingOdds.toFixed(2)})`
                            : '< 1.65'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px]">Current Score</div>
                        <div className="font-mono font-semibold text-slate-200">
                          {opp.runs}/{opp.wickets} ({opp.currentOver} ov)
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px]">Bookset Target</div>
                        <div className="font-mono font-semibold text-amber-300">
                          {opp.booksetTarget}
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 mb-3">
                      {opp.explanation}
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        onSelectMatch(opp.matchId);
                        onClose();
                      }}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
                    >
                      <span>Open Match Analysis</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prominent "Wait for the entry" Section when no active opportunities exist */}
          {opportunities.length === 0 && (
            <div className="bg-gradient-to-br from-slate-800/80 via-slate-900/90 to-slate-950 p-6 rounded-2xl border border-slate-700/60 text-center relative overflow-hidden shadow-lg">
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <Target className="w-48 h-48" />
              </div>

              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto mb-3 shadow-inner">
                <Clock className="w-7 h-7 animate-pulse" />
              </div>

              <h3 className="text-xl font-bold text-white mb-1">
                Wait for the entry
              </h3>
              <p className="text-sm text-slate-300 max-w-lg mx-auto mb-5">
                No match currently meets the exact entry criteria. The radar is actively scanning every ball from 0.0 overs to match end. As soon as an opportunity qualifies, it will appear here immediately and ping the Telegram group.
              </p>

              {/* Exact Strategy Discipline Rules */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl mx-auto text-left">
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-xs mb-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Booking Team & 1st Entry</span>
                  </div>
                  <ul className="text-[11px] text-slate-400 space-y-1">
                    <li>• Boundary: 4 with <strong className="text-slate-200">&ge; 11 paise</strong> | 6 with <strong className="text-slate-200">&ge; 18 paise</strong></li>
                    <li>• Flip Formula: (100 - Pprev) + (100 - Pcurr) when bowling in control</li>
                    <li>• Wicket Filter: &lt; 3 wickets before entry (&ge; 3 skips match)</li>
                    <li>• Over Window: 1st Innings &le; 10.0 ov | 2nd Innings &le; 6.0 ov</li>
                    <li>• 1st Entry Odds: &ge; 85 paise (1.85+) | Bookset at 45 to 55 paise</li>
                  </ul>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="flex items-center gap-1.5 text-indigo-400 font-semibold text-xs mb-1">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Second Entry & Bookset</span>
                  </div>
                  <ul className="text-[11px] text-slate-400 space-y-1">
                    <li>• <strong className="text-amber-300">Mandatory:</strong> Wicket fell strictly after 1st entry</li>
                    <li>• Opposite team odds strictly &lt; 65 paise (decimal &lt; 1.65)</li>
                    <li>• Combined Bookset for both entries: Opposite team &ge; 85 paise (1.85+)</li>
                    <li>• Held State: Once entry fires, it is held without duplicate spam</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Real-time Match Radar Watchlist */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-slate-400" />
                <h3 className="text-sm font-semibold text-white tracking-wide uppercase">
                  Live Match Surveillance Feed ({displayList.length})
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">
                Monitored from ball 0.0 to match end
              </span>
            </div>

            {displayList.length === 0 ? (
              <div className="p-8 text-center text-slate-500 bg-slate-900/50 rounded-xl border border-slate-800">
                <HelpCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-xs">No active matches match the selected filter.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {displayList.map((item) => {
                  const t1 = item.match.team1;
                  const t2 = item.match.team2;
                  const score1 = item.match.team1Score
                    ? `${item.match.team1Score.runs}/${item.match.team1Score.wickets} (${item.match.team1Score.overs} ov)`
                    : 'Yet to bat';
                  const score2 = item.match.team2Score
                    ? `${item.match.team2Score.runs}/${item.match.team2Score.wickets} (${item.match.team2Score.overs} ov)`
                    : 'Yet to bat';

                  return (
                    <div
                      key={item.matchId}
                      className="p-3.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      {/* Match & Scores */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-white text-sm">
                            {t1.shortName} vs {t2.shortName}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 font-medium">
                            {item.match.format}
                          </span>
                          {item.firstEntryQualified && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              1ST ENTRY READY
                            </span>
                          )}
                          {item.secondEntryQualified && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              2ND ENTRY READY
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-slate-300 flex items-center gap-3">
                          <span>
                            <strong>{t1.shortName}:</strong> {score1}
                          </span>
                          <span>•</span>
                          <span>
                            <strong>{t2.shortName}:</strong> {score2}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                          <span className="font-medium text-amber-400">
                            {item.statusSummary}
                          </span>
                          {item.secondEntryLockedReason && (
                            <span className="text-slate-500 hidden md:inline">
                              · {item.secondEntryLockedReason}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Odds & Proximity */}
                      <div className="flex items-center gap-4 shrink-0 justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-700/60">
                        <div className="text-right">
                          <div className="text-[10px] text-slate-400">Live Decimal Odds</div>
                          <div className="font-mono font-bold text-base text-white">
                            {item.decimalOdds ? item.decimalOdds.toFixed(2) : '—'}
                          </div>
                          {item.opposingOdds && (
                            <div className="text-[10px] font-mono text-slate-400">
                              Opp: {item.opposingOdds.toFixed(2)}
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            onSelectMatch(item.matchId);
                            onClose();
                          }}
                          className="px-3 py-1.5 bg-slate-700 hover:bg-emerald-600 hover:text-white text-slate-200 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
                        >
                          <span>Analyze</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/90 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-2">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            <span>
              Engine locks 2nd entry automatically until a 1st entry is formally recorded.
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
