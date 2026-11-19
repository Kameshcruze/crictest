import React, { useMemo, useState, useEffect } from 'react';
import {
  X,
  Target,
  Clock,
  ShieldAlert,
  ArrowRight,
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
  isWithinEntryWindow,
  detectTeamInControl,
} from '../services/strategy/engine';

export interface EntryOpportunity {
  matchId: string;
  match: ParsedCricketMatch;
  type: 'FIRST_ENTRY' | 'SECOND_ENTRY';
  teamName: string;
  decimalOdds: number;
  controlTeamOdds: number;
  control: 'BATTING' | 'BOWLING' | 'UNKNOWN';
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
  controlTeamOdds: number | null;
  control: 'BATTING' | 'BOWLING' | 'UNKNOWN';
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

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

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

      const controlInfo = detectTeamInControl(match, oddsState);
      const control = controlInfo.teamInControl;
      const controlTeamOdds = controlInfo.currentPaise;
      const decimalOdds =
        controlInfo.decimalOdds ??
        (controlTeamOdds !== null ? Number((1 + controlTeamOdds / 100).toFixed(2)) : null);
      const inWindow = isWithinEntryWindow(currentInnings, currentOver);
      const isBattingInControl = control === 'BATTING';
      const isBowlingInControl = control === 'BOWLING';
      const engineState = strategyEngine.getState(match.id);
      const isDisqualifiedByWickets =
        wickets >= 3 &&
        !recordedFirstEntries.has(match.id) &&
        engineState.stage !== 'ACTIVE_FIRST_ENTRY' &&
        engineState.stage !== 'ACTIVE_SECOND_ENTRY';

      const hasFirstEntryRecorded =
        recordedFirstEntries.has(match.id) ||
        engineState.stage === 'ACTIVE_FIRST_ENTRY' ||
        engineState.stage === 'ACTIVE_SECOND_ENTRY' ||
        engineState.stage === 'FIRST_BOOKSET_COMPLETED' ||
        engineState.stage === 'FULL_BOOKSET_COMPLETED' ||
        engineState.firstEntryPosition.status === 'RECORDED_ENTRY';

      const bookingTeamDisplay = engineState.bookingTeamName || controlInfo.battingTeamName;

      const firstEntryQualified =
        !isDisqualifiedByWickets &&
        inWindow &&
        !hasFirstEntryRecorded &&
        (engineState.stage === 'CONFIRMED_BOOKING_TEAM' || engineState.stage === 'CONFIRMED_PENDING_85') &&
        isBattingInControl &&
        controlTeamOdds !== null &&
        controlTeamOdds >= 85;

      let secondEntryQualified = false;
      let secondEntryLockedReason: string | undefined;

      const anchorWickets =
        engineState.firstEntryTrade?.entryWickets ?? engineState.firstEntryPosition.entryWickets ?? 0;

      if (isDisqualifiedByWickets) {
        secondEntryLockedReason = `Match skipped: ${wickets} wickets fell before entry (limit < 3).`;
      } else if (!hasFirstEntryRecorded) {
        secondEntryLockedReason = 'Locked: First Entry must be recorded before 2nd entry can unlock.';
      } else if (
        engineState.stage === 'FIRST_BOOKSET_COMPLETED' ||
        engineState.stage === 'FULL_BOOKSET_COMPLETED'
      ) {
        secondEntryLockedReason = 'Cycle completed via Exit/Bookset.';
      } else if (wickets <= anchorWickets) {
        secondEntryLockedReason = `Waiting for wicket after 1st entry (${wickets}/${anchorWickets} wkts).`;
      } else if (!isBowlingInControl || controlTeamOdds === null || controlTeamOdds >= 65) {
        secondEntryLockedReason = `Waiting: BOWLING control_team_odds must be < 65 paise (Currently: ${control} ${controlTeamOdds ?? 'N/A'}p).`;
      } else {
        secondEntryQualified = true;
      }

      const teamName = bookingTeamDisplay;
      const windowLimitOver = currentInnings === 1 ? 10.0 : 6.0;

      if (firstEntryQualified && controlTeamOdds !== null && decimalOdds !== null) {
        oppList.push({
          matchId: match.id,
          match,
          type: 'FIRST_ENTRY',
          teamName,
          decimalOdds,
          controlTeamOdds,
          control,
          currentOver,
          currentInnings,
          runs,
          wickets,
          crr,
          explanation: `Booking team ${teamName} (BATTING) confirmed. BATTING control_team_odds ${controlTeamOdds}p (>= 85p) ready for 1st Entry.`,
          booksetTarget: 'BOWLING > 85 Paise',
          windowLimitOver,
          timestamp: new Date(),
        });
      }

      if (secondEntryQualified && controlTeamOdds !== null && decimalOdds !== null) {
        oppList.push({
          matchId: match.id,
          match,
          type: 'SECOND_ENTRY',
          teamName,
          decimalOdds,
          controlTeamOdds,
          control,
          currentOver,
          currentInnings,
          runs,
          wickets,
          crr,
          explanation: `Wicket confirmed after 1st entry and BOWLING control_team_odds ${controlTeamOdds}p (< 65p) on ${teamName}.`,
          booksetTarget: 'BOWLING > 85 Paise',
          windowLimitOver,
          timestamp: new Date(),
        });
      }

      let distanceToFirstEntry = '';
      let statusSummary = '';

      if (isDisqualifiedByWickets || engineState.stage === 'DISQUALIFIED_3_WICKETS') {
        statusSummary = `Skipped: ${wickets} wickets before entry (>= 3 limit)`;
      } else if (engineState.stage === 'ACTIVE_SECOND_ENTRY') {
        statusSummary = `1st & 2nd Entries Active on ${bookingTeamDisplay} (Bookset: BOWLING > 85p)`;
      } else if (hasFirstEntryRecorded || engineState.stage === 'ACTIVE_FIRST_ENTRY') {
        statusSummary = `1st Entry Active on ${bookingTeamDisplay} (Exit: BATTING <= 55p pre-wkt | Bookset: BOWLING > 85p)`;
      } else if (engineState.stage === 'CONFIRMED_PENDING_85') {
        statusSummary = `Entry Confirmed (${bookingTeamDisplay}): Waiting for first later ball with BATTING >= 85p`;
      } else if (engineState.stage === 'CONFIRMED_BOOKING_TEAM') {
        statusSummary = `Booking Confirmed: ${bookingTeamDisplay} (Waiting for next 4/6 entry confirmation)`;
      } else if (engineState.stage === 'WAITING_FOR_CONFIRMATION') {
        statusSummary = `Waiting for Booking Team: ${controlInfo.battingTeamName} needs BATTING >= 85p + 4 (>= 11p) or 6 (>= 18p)`;
      } else if (firstEntryQualified) {
        statusSummary = '1st Entry Ready NOW';
      } else if (secondEntryQualified) {
        statusSummary = '2nd Entry Ready NOW';
      } else if (!inWindow) {
        statusSummary = `Window passed (${currentOver} ov >= ${windowLimitOver} ov limit)`;
      } else if (controlTeamOdds !== null) {
        statusSummary = `Monitoring ball-by-ball control & boundary shifts on ${controlInfo.battingTeamName}...`;
      } else {
        statusSummary = 'Connecting to real-time odds feed...';
      }

      watchList.push({
        matchId: match.id,
        match,
        oddsState,
        decimalOdds,
        controlTeamOdds,
        control,
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-md"
      style={{ backgroundColor: 'var(--overlay)' }}
      onClick={onClose}
    >
      <div
        className="bg-[var(--sf)] border border-[var(--bd)] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-[var(--tx)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-radar-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-[var(--bd)] flex items-center justify-between bg-[var(--sf)] sticky top-0 z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[var(--rds)] border border-[var(--rd)]/30 flex items-center justify-center text-[var(--rdt)] shrink-0">
              <Target className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="entry-radar-title" className="text-base sm:text-lg font-bold tracking-tight text-[var(--tx)]">
                  Entry Radar & Opportunities
                </h2>
                {opportunities.length > 0 ? (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok-tx)] animate-ping" />
                    {opportunities.length} Opportunity Active
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--sf-2)] text-[var(--mu)] border border-[var(--bd)]">
                    Scanning {radarWatchlist.length} Matches
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--mu)] truncate">
                Ball 0.0 to match end surveillance · Strict rule: 2nd entry never fires without prior 1st entry
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[var(--mu)] hover:text-[var(--tx)] hover:bg-[var(--sf-2)] rounded-lg transition-colors shrink-0"
            title="Close"
            aria-label="Close Entry Radar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Bar */}
        <div className="px-5 sm:px-6 py-2.5 bg-[var(--sf-2)] border-b border-[var(--bd)] flex items-center justify-between gap-2 text-xs overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap ${
                filterMode === 'all'
                  ? 'bg-[var(--rd)] text-white'
                  : 'text-[var(--mu)] hover:text-[var(--tx)] bg-[var(--sf)] border border-[var(--bd)]'
              }`}
            >
              All Matches ({radarWatchlist.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('opportunities')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                filterMode === 'opportunities'
                  ? 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)]'
                  : 'text-[var(--mu)] hover:text-[var(--tx)] bg-[var(--sf)] border border-[var(--bd)]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Ready Entries ({opportunities.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('monitoring')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap ${
                filterMode === 'monitoring'
                  ? 'bg-[var(--rd)] text-white'
                  : 'text-[var(--mu)] hover:text-[var(--tx)] bg-[var(--sf)] border border-[var(--bd)]'
              }`}
            >
              Waiting ({radarWatchlist.filter((m) => !m.firstEntryQualified && !m.secondEntryQualified).length})
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-[var(--mu)] shrink-0">
            <Activity className="w-3.5 h-3.5 text-[var(--ok-tx)] animate-spin" />
            <span>Updated Every Second</span>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {opportunities.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-[var(--ok-tx)]" />
                <h3 className="text-sm font-semibold text-[var(--tx)] tracking-wide uppercase">
                  Actionable Entry Opportunities ({opportunities.length})
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {opportunities.map((opp, idx) => (
                  <div
                    key={`${opp.matchId}-${opp.type}-${idx}`}
                    className={`p-4 rounded-xl border transition-all ${
                      opp.type === 'FIRST_ENTRY'
                        ? 'bg-[var(--ok-bg)] border-[var(--ok-bd)]'
                        : 'bg-[var(--blu)] border-[var(--info-bd)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold border ${
                          opp.type === 'FIRST_ENTRY'
                            ? 'bg-[var(--sf)] text-[var(--ok-tx)] border-[var(--ok-bd)]'
                            : 'bg-[var(--sf)] text-[var(--blut)] border-[var(--info-bd)]'
                        }`}
                      >
                        <Target className="w-3 h-3" />
                        {opp.type === 'FIRST_ENTRY' ? '1ST ENTRY QUALIFIED' : '2ND ENTRY QUALIFIED'}
                      </span>
                      <span className="text-[11px] font-mono text-[var(--mu)] tabular-nums">
                        Inn {opp.currentInnings} · Over {opp.currentOver}
                      </span>
                    </div>

                    <h4 className="font-bold text-[var(--tx)] text-base">
                      {opp.match.team1.shortName} vs {opp.match.team2.shortName}
                    </h4>
                    <p className="text-xs text-[var(--mu)] mb-3 truncate">
                      {opp.match.seriesName || opp.match.format} · {opp.match.venueName || 'Live'}
                    </p>

                    <div className="grid grid-cols-2 gap-2 bg-[var(--sf)] border border-[var(--bd)] rounded-lg p-2.5 mb-3 text-xs">
                      <div>
                        <div className="text-[var(--mu)] text-[10px]">Active Odds</div>
                        <div className="font-mono font-bold text-[var(--ok-tx)] text-sm tabular-nums">
                          {opp.decimalOdds.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[var(--mu)] text-[10px]">
                          {opp.type === 'FIRST_ENTRY' ? 'Entry Condition' : 'Control Trigger'}
                        </div>
                        <div className="font-mono font-bold text-[var(--tx)] text-sm tabular-nums">
                          {opp.type === 'FIRST_ENTRY'
                            ? `BATTING >= 85p (${opp.controlTeamOdds}p)`
                            : `BOWLING < 65p (${opp.controlTeamOdds}p)`}
                        </div>
                      </div>
                      <div>
                        <div className="text-[var(--mu)] text-[10px]">Current Score</div>
                        <div className="font-mono font-semibold text-[var(--tx)] tabular-nums">
                          {opp.runs}/{opp.wickets} ({opp.currentOver} ov)
                        </div>
                      </div>
                      <div>
                        <div className="text-[var(--mu)] text-[10px]">Bookset Target</div>
                        <div className="font-mono font-semibold text-[var(--warn-tx)]">
                          {opp.booksetTarget}
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-[var(--tx)] mb-3">{opp.explanation}</p>

                    <button
                      type="button"
                      onClick={() => {
                        onSelectMatch(opp.matchId);
                        onClose();
                      }}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-[var(--rd)] hover:opacity-90 text-white rounded-xl text-xs font-semibold transition-opacity"
                    >
                      <span>Open Match Analysis</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {opportunities.length === 0 && (
            <div className="bg-[var(--sf-2)] p-6 rounded-2xl border border-[var(--bd)] text-center relative overflow-hidden">
              <div className="w-12 h-12 rounded-2xl bg-[var(--warn-bg)] border border-[var(--warn-bd)] flex items-center justify-center text-[var(--warn-tx)] mx-auto mb-3">
                <Clock className="w-6 h-6" />
              </div>

              <h3 className="text-lg font-bold text-[var(--tx)] mb-1">
                Wait for the entry
              </h3>
              <p className="text-xs sm:text-sm text-[var(--mu)] max-w-lg mx-auto mb-5">
                No match currently meets the exact entry criteria. The radar is actively scanning every ball from 0.0 overs to match end.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl mx-auto text-left">
                <div className="p-3 rounded-xl bg-[var(--sf)] border border-[var(--bd)]">
                  <div className="flex items-center gap-1.5 text-[var(--ok-tx)] font-semibold text-xs mb-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Booking Team &amp; 1st Entry</span>
                  </div>
                  <ul className="text-[11px] text-[var(--mu)] space-y-1">
                    <li>• Boundary: 4 with <strong className="text-[var(--tx)]">&ge; 11 paise</strong> | 6 with <strong className="text-[var(--tx)]">&ge; 18 paise</strong></li>
                    <li>• Switch Formula: (100 - bowl_before) + (100 - bat_after)</li>
                    <li>• Wicket Filter: &lt; 3 wickets before entry (&ge; 3 skips match)</li>
                    <li>• Over Window: 1st Innings &lt; 10.0 ov | 2nd Innings &lt; 6.0 ov</li>
                    <li>• Booking &amp; Entry: BATTING &ge; 85p (defers if confirmed &lt; 85p)</li>
                  </ul>
                </div>

                <div className="p-3 rounded-xl bg-[var(--sf)] border border-[var(--bd)]">
                  <div className="flex items-center gap-1.5 text-[var(--blut)] font-semibold text-xs mb-1">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Exits &amp; Second Entry</span>
                  </div>
                  <ul className="text-[11px] text-[var(--mu)] space-y-1">
                    <li>• <strong className="text-[var(--warn-tx)]">Early Exit (&le; 55p):</strong> No wicket since 1st entry + BATTING &le; 55p</li>
                    <li>• <strong className="text-[var(--warn-tx)]">Second Entry:</strong> Wicket after 1st entry + BOWLING &lt; 65p (any over)</li>
                    <li>• Bookset for BOTH entries: BOWLING control &amp; odds &gt; 85 paise</li>
                    <li>• Held State: Once entry fires, server locks it in PostgreSQL</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Real-time Match Radar Watchlist */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[var(--mu)]" />
                <h3 className="text-sm font-semibold text-[var(--tx)] tracking-wide uppercase">
                  Live Match Surveillance Feed ({displayList.length})
                </h3>
              </div>
              <span className="text-[11px] text-[var(--mu)] hidden sm:inline">
                Monitored from ball 0.0 to match end
              </span>
            </div>

            {displayList.length === 0 ? (
              <div className="p-8 text-center text-[var(--mu)] bg-[var(--sf-2)] rounded-xl border border-[var(--bd)]">
                <HelpCircle className="w-8 h-8 mx-auto mb-2 opacity-60" />
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
                      className="p-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-bold text-[var(--tx)] text-sm">
                            {t1.shortName} vs {t2.shortName}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--sf)] border border-[var(--bd)] text-[var(--mu)] font-medium">
                            {item.match.format}
                          </span>
                          {item.firstEntryQualified && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--ok-bg)] text-[var(--ok-tx)] border border-[var(--ok-bd)]">
                              1ST ENTRY READY
                            </span>
                          )}
                          {item.secondEntryQualified && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--blu)] text-[var(--blut)] border border-[var(--info-bd)]">
                              2ND ENTRY READY
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-[var(--tx)] flex items-center gap-3 flex-wrap tabular-nums">
                          <span>
                            <strong>{t1.shortName}:</strong> {score1}
                          </span>
                          <span className="text-[var(--mu)]">•</span>
                          <span>
                            <strong>{t2.shortName}:</strong> {score2}
                          </span>
                        </div>

                        <div className="text-[11px] text-[var(--mu)] mt-1 flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-[var(--warn-tx)]">
                            {item.statusSummary}
                          </span>
                          {item.secondEntryLockedReason && (
                            <span className="text-[var(--mu)] hidden md:inline">
                              · {item.secondEntryLockedReason}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0 justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-[var(--bd)]">
                        <div className="text-right tabular-nums">
                          <div className="text-[10px] text-[var(--mu)]">Control &amp; Odds</div>
                          <div className="font-mono font-bold text-base text-[var(--tx)]">
                            {item.controlTeamOdds !== null ? `${item.controlTeamOdds}p` : '—'}
                          </div>
                          <div className="text-[10px] font-mono text-[var(--mu)]">
                            {item.control}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            onSelectMatch(item.matchId);
                            onClose();
                          }}
                          className="px-3 py-1.5 bg-[var(--sf)] hover:bg-[var(--rds)] border border-[var(--rd)]/40 text-[var(--rdt)] rounded-xl text-xs font-semibold transition-colors flex items-center gap-1"
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
        <div className="px-5 sm:px-6 py-3 border-t border-[var(--bd)] bg-[var(--sf)] flex flex-col sm:flex-row items-center justify-between text-xs text-[var(--mu)] gap-2">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-[var(--warn-tx)] shrink-0" />
            <span>
              Engine locks 2nd entry automatically until a 1st entry is formally recorded.
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[var(--sf-2)] hover:bg-[var(--rds)] border border-[var(--bd)] text-[var(--tx)] rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
