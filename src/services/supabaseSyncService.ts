/**
 * Local PostgreSQL Synchronization Service
 *
 * Handles bi-directional synchronization between the live cricket/odds API feeds
 * and the local PostgreSQL database (leadhunt) via the backend /api/db/* endpoints.
 */

import { ParsedCricketMatch, TeamInfo, ParsedInningsScore } from '../types/cricket';
import { MatchOddsState } from '../types/odds';
import {
  StrategySignal,
  TradePosition,
  StrategyTradeRecord,
  SerializedMatchStrategyState,
  PositionType,
} from './strategy/types';

export interface MatchTimelineTick {
  id: number;
  match_id: string;
  series_name: string | null;
  innings: number;
  overs: number;
  legal_ball_count: number;
  runs: number;
  wickets: number;
  batting_team: string | null;
  bowling_team: string | null;
  favorite_team: string | null;
  control: 'BATTING' | 'BOWLING' | 'UNKNOWN';
  back_rate: number | null;
  lay_rate: number | null;
  decimal_back: number | null;
  decimal_lay: number | null;
  control_team_odds: number | null;
  raw_rate_string: string | null;
  session_data: any;
  match_status: string;
  result_text: string | null;
  is_new_ball: boolean;
  runs_on_ball: number;
  score_fetched_at: string | null;
  odds_fetched_at: string | null;
  recorded_at: string;
}

export interface TimelineResponse {
  ok: boolean;
  matchId: string;
  missedTicks: number;
  count: number;
  data: MatchTimelineTick[];
}

/**
 * Persists a normalized cricket match and its latest score state to Local PostgreSQL
 */
export async function syncMatchToSupabase(match: ParsedCricketMatch): Promise<string | null> {
  if (!match?.id) return null;

  try {
    const res = await fetch('/api/db/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(match),
    });
    if (res.ok) {
      const json = await res.json();
      return json.matchUuid || match.id;
    }
  } catch (err) {
    console.warn('syncMatchToSupabase error:', err);
  }
  return null;
}

/**
 * Persists latest odds state and historical snapshots to Local PostgreSQL
 */
export async function syncOddsToSupabase(
  matchId: string,
  oddsState: MatchOddsState
): Promise<void> {
  if (!matchId || !oddsState?.odds) return;

  try {
    await fetch('/api/db/odds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, oddsState }),
    });
  } catch (err) {
    console.warn('syncOddsToSupabase error:', err);
  }
}

/**
 * Fetches historical odds ticks for a match from match_odds_ticks
 */
export async function fetchOddsTicksFromSupabase(
  matchId: string,
  limit = 100
): Promise<any[]> {
  if (!matchId) return [];

  try {
    const res = await fetch(`/api/db/odds-ticks/${encodeURIComponent(matchId)}?limit=${limit}`);
    if (res.ok) {
      const json = await res.json();
      return json.data || [];
    }
  } catch (err) {
    console.warn('fetchOddsTicksFromSupabase error:', err);
  }
  return [];
}

/**
 * Persists an entry/exit strategy signal to Local PostgreSQL with deduplication
 */
export async function syncStrategySignalToSupabase(signal: StrategySignal): Promise<void> {
  if (!signal?.matchId) return;

  try {
    await fetch('/api/db/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signal),
    });
  } catch (err) {
    console.warn('syncStrategySignalToSupabase error:', err);
  }
}

/**
 * Persists trade position (First Entry / Second Entry) to Local PostgreSQL
 */
export async function syncTradePositionToSupabase(position: TradePosition): Promise<void> {
  if (!position?.matchId) return;

  try {
    await fetch('/api/db/positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(position),
    });
  } catch (err) {
    console.warn('syncTradePositionToSupabase error:', err);
  }
}

/**
 * Persists an entry or exit to the dedicated `strategy_trades` table in Local PostgreSQL.
 * Atomically records entry/exit metrics and holds trade state without duplicate records.
 */
export async function syncStrategyTradeToDb(trade: StrategyTradeRecord): Promise<void> {
  if (!trade?.matchId) {
    console.warn('[PostgreSQL] Cannot sync trade: missing matchId', trade);
    return;
  }

  try {
    const res = await fetch('/api/db/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trade),
    });

    if (res.ok) {
      console.log(`[PostgreSQL] Synced strategy trade: ${trade.matchId} ${trade.entryType} status=${trade.status} @ ${trade.entryPaise}p (${trade.entryDecimal})`);
    } else {
      const err = await res.json().catch(() => ({}));
      console.warn('[PostgreSQL] syncStrategyTradeToDb warning:', err);
    }
  } catch (err) {
    console.warn('syncStrategyTradeToDb exception:', err);
  }
}

/**
 * Fetches recorded trades from `strategy_trades` table in Local PostgreSQL.
 */
export async function fetchStrategyTradesFromDb(matchId?: string): Promise<StrategyTradeRecord[]> {
  try {
    const url = matchId ? `/api/db/trades?matchId=${encodeURIComponent(matchId)}` : '/api/db/trades';
    const res = await fetch(url);
    if (!res.ok) return [];

    const json = await res.json();
    const rows = json.data || [];

    return rows.map((row: any): StrategyTradeRecord => ({
      id: row.id,
      matchId: row.match_id,
      matchName: row.match_name,
      seriesName: row.series_name,
      bookingTeam: row.booking_team,
      battingTeam: row.batting_team,
      bowlingTeam: row.bowling_team,
      entryType: row.entry_type,
      innings: row.innings,
      entryOver: Number(row.entry_over),
      entryPaise: Number(row.entry_paise),
      entryDecimal: Number(row.entry_decimal),
      entryWickets: Number(row.entry_wickets || 0),
      entryTime: new Date(row.entry_time),
      exitOver: row.exit_over ? Number(row.exit_over) : undefined,
      exitPaise: row.exit_paise ? Number(row.exit_paise) : undefined,
      exitDecimal: row.exit_decimal ? Number(row.exit_decimal) : undefined,
      exitTime: row.exit_time ? new Date(row.exit_time) : undefined,
      exitReason: row.exit_reason,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  } catch (err) {
    console.warn('fetchStrategyTradesFromDb error:', err);
    return [];
  }
}

/**
 * Retrieves all matches with their latest scores and odds from Local PostgreSQL
 */
export async function fetchMatchesFromSupabase(): Promise<ParsedCricketMatch[]> {
  try {
    const res = await fetch('/api/db/matches');
    if (!res.ok) return [];
    const json = await res.json();
    const rows = json.data || [];

    return rows.map((row: any): ParsedCricketMatch => {
      const state = row.latest_match_state || {};
      const odds = row.latest_odds_state || {};

      const team1: TeamInfo = {
        key: row.team1?.key || 'T1',
        name: row.team1?.name || 'Team 1',
        shortName: row.team1?.short_name || 'T1',
        color: row.team1?.color || '#2563eb',
        darkColor: row.team1?.dark_color || '#1e3a8a',
        flagUrl: row.team1?.flag_url || undefined,
      };

      const team2: TeamInfo = {
        key: row.team2?.key || 'T2',
        name: row.team2?.name || 'Team 2',
        shortName: row.team2?.short_name || 'T2',
        color: row.team2?.color || '#ef4444',
        darkColor: row.team2?.dark_color || '#991b1b',
        flagUrl: row.team2?.flag_url || undefined,
      };

      const innings: ParsedInningsScore[] = [];
      if (state.team1_score_runs !== null && state.team1_score_runs !== undefined) {
        innings.push({
          inningIndex: 1,
          runs: state.team1_score_runs,
          wickets: state.team1_score_wickets || 0,
          overs: Number(state.team1_score_overs || 0),
          completedOvers: Math.floor(Number(state.team1_score_overs || 0)),
          ballsInOver: 0,
          totalBalls: 0,
          runRate: 0,
          rawString: state.team1_score_raw || '',
          teamCode: team1.shortName,
        });
      }

      if (state.team2_score_runs !== null && state.team2_score_runs !== undefined) {
        innings.push({
          inningIndex: 2,
          runs: state.team2_score_runs,
          wickets: state.team2_score_wickets || 0,
          overs: Number(state.team2_score_overs || 0),
          completedOvers: Math.floor(Number(state.team2_score_overs || 0)),
          ballsInOver: 0,
          totalBalls: 0,
          runRate: 0,
          rawString: state.team2_score_raw || '',
          teamCode: team2.shortName,
        });
      }

      return {
        id: row.external_match_id,
        team1,
        team2,
        seriesName: row.series_name || 'Tournament',
        seriesKey: row.series_key || '',
        venueName: row.venue_name || 'Stadium',
        venueKey: row.venue_key || '',
        format: row.format || 'Match',
        matchTitlePrefix: row.match_title_prefix || undefined,
        status: state.status || 'upcoming',
        statusLabel: state.status_label || 'Scheduled',
        statusDetail: state.status_detail || undefined,
        resultText: state.result_text || undefined,
        sessionText: state.session_text || undefined,
        innings,
        team1Score: innings[0],
        team2Score: innings[1],
        startTime: new Date(row.start_time),
        finishTime: row.finish_time ? new Date(row.finish_time) : undefined,
        target: state.target || undefined,
        requiredRunRate: state.required_run_rate ? Number(state.required_run_rate) : undefined,
        currentRunRate: state.current_run_rate ? Number(state.current_run_rate) : undefined,
        battingTeamKey: state.batting_team_id === row.team1?.id ? team1.key : team2.key,
        odds: odds.raw_rate_string || undefined,
        raw: {
          b: team1.key,
          c: team2.key,
          d: state.status === 'live' ? 1 : state.status === 'completed' ? 2 : 0,
          ti: new Date(row.start_time).getTime(),
          dt_id: row.dt_id,
          q: row.series_key || '',
          v: row.venue_key || '',
        },
      };
    });
  } catch (err) {
    console.warn('fetchMatchesFromSupabase exception:', err);
    return [];
  }
}

/**
 * Fetches saved append-only 1-second & ball-by-ball timeline ticks for a match
 */
export async function fetchMatchTimelineFromDb(
  matchId: string,
  opts?: { ballsOnly?: boolean; order?: 'asc' | 'desc'; limit?: number }
): Promise<TimelineResponse> {
  if (!matchId) {
    return { ok: false, matchId: '', missedTicks: 0, count: 0, data: [] };
  }
  try {
    const params = new URLSearchParams();
    if (opts?.ballsOnly) params.set('ballsOnly', 'true');
    if (opts?.order) params.set('order', opts.order);
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    const url = `/api/db/timeline/${encodeURIComponent(matchId)}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { ok: false, matchId, missedTicks: 0, count: 0, data: [] };
    }
    const json = await res.json();
    return {
      ok: Boolean(json.ok),
      matchId: json.matchId || matchId,
      missedTicks: Number(json.missedTicks || 0),
      count: Number(json.count || 0),
      data: Array.isArray(json.data) ? json.data : [],
    };
  } catch (err) {
    console.warn('fetchMatchTimelineFromDb error:', err);
    return { ok: false, matchId, missedTicks: 0, count: 0, data: [] };
  }
}

/**
 * Fetches authoritative server-side strategy states for all tracked matches
 */
export async function fetchServerStrategyStates(): Promise<{
  strategyAlertsEnabled: boolean;
  states: Record<string, SerializedMatchStrategyState>;
}> {
  try {
    const res = await fetch('/api/strategy/state');
    if (!res.ok) return { strategyAlertsEnabled: false, states: {} };
    const json = await res.json();
    return {
      strategyAlertsEnabled: Boolean(json.strategyAlertsEnabled),
      states: json.states || {},
    };
  } catch (err) {
    console.warn('fetchServerStrategyStates error:', err);
    return { strategyAlertsEnabled: false, states: {} };
  }
}

/**
 * Server-Saved Manual Override: Record Entry on backend PostgreSQL
 */
export async function sendManualOverrideEntry(
  matchId: string,
  payload: {
    positionType: PositionType;
    entryOdds: number;
    innings: number;
    over: number;
    wickets: number;
    bookingTeam: string;
    battingTeam: string;
    bowlingTeam: string;
    matchName?: string;
    seriesName?: string;
  }
): Promise<SerializedMatchStrategyState | null> {
  const res = await fetch(`/api/strategy/${encodeURIComponent(matchId)}/override-entry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.state || null;
}

/**
 * Server-Saved Manual Override: Record Exit on backend PostgreSQL
 */
export async function sendManualOverrideExit(
  matchId: string,
  payload: {
    positionType: PositionType;
    exitOdds: number;
    over: number;
    exitReason?: string;
  }
): Promise<SerializedMatchStrategyState | null> {
  const res = await fetch(`/api/strategy/${encodeURIComponent(matchId)}/override-exit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.state || null;
}

/**
 * Server-Saved Manual Override: Reset Match Strategy State on backend PostgreSQL
 */
export async function sendManualStrategyReset(
  matchId: string
): Promise<SerializedMatchStrategyState | null> {
  const res = await fetch(`/api/strategy/${encodeURIComponent(matchId)}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.state || null;
}

/**
 * Loads historical trade positions, signals, trades, and serialized strategy state for a match from Local PostgreSQL
 */
export async function loadMatchStrategyFromSupabase(matchId: string): Promise<{
  positions: TradePosition[];
  signals: StrategySignal[];
  trades: StrategyTradeRecord[];
  strategyState: SerializedMatchStrategyState | null;
}> {
  if (!matchId) {
    return { positions: [], signals: [], trades: [], strategyState: null };
  }

  try {
    const res = await fetch(`/api/db/match-strategy/${encodeURIComponent(matchId)}`);
    if (!res.ok) return { positions: [], signals: [], trades: [], strategyState: null };
    const json = await res.json();

    const positions: TradePosition[] = (json.positions || []).map((p: any) => ({
      id: p.id,
      matchId,
      positionType: p.position_type,
      status: p.status,
      candidateSignalId: p.candidate_signal_id || undefined,
      entryOdds: p.entry_odds !== null && p.entry_odds !== undefined ? Number(p.entry_odds) : undefined,
      entryTimestamp: p.entry_timestamp ? new Date(p.entry_timestamp) : undefined,
      entryOver: p.entry_over !== null && p.entry_over !== undefined ? Number(p.entry_over) : undefined,
      entryInnings: p.entry_innings !== null && p.entry_innings !== undefined ? Number(p.entry_innings) : undefined,
      entryWickets: p.entry_wickets ?? undefined,
      exitOdds: p.exit_odds !== null && p.exit_odds !== undefined ? Number(p.exit_odds) : undefined,
      exitTimestamp: p.exit_timestamp ? new Date(p.exit_timestamp) : undefined,
      exitOver: p.exit_over !== null && p.exit_over !== undefined ? Number(p.exit_over) : undefined,
      booksetSignalId: p.bookset_signal_id || undefined,
    }));

    const signals: StrategySignal[] = (json.signals || []).map((s: any) => ({
      id: s.id,
      signalType: s.signal_type,
      matchId,
      timestamp: new Date(s.timestamp),
      currentInnings: s.current_innings,
      currentOver: Number(s.current_over),
      ballNumber: s.ball_number || 0,
      relevantOdds: {
        measuredTeam: s.measured_team || '',
        decimalOdds: s.decimal_odds !== null && s.decimal_odds !== undefined ? Number(s.decimal_odds) : null,
        previousDecimalOdds:
          s.previous_decimal_odds !== null && s.previous_decimal_odds !== undefined
            ? Number(s.previous_decimal_odds)
            : null,
        oddsDelta: s.odds_delta !== null && s.odds_delta !== undefined ? Number(s.odds_delta) : null,
        opposingTeamOdds:
          s.opposing_team_odds !== null && s.opposing_team_odds !== undefined
            ? Number(s.opposing_team_odds)
            : null,
      },
      ruleEvaluated: s.rule_evaluated,
      status: s.status,
      explanation: s.explanation,
      metadata: s.metadata || {},
    }));

    const trades: StrategyTradeRecord[] = (json.trades || []).map((row: any) => ({
      id: row.id,
      matchId: row.match_id,
      matchName: row.match_name,
      seriesName: row.series_name,
      bookingTeam: row.booking_team,
      battingTeam: row.batting_team,
      bowlingTeam: row.bowling_team,
      entryType: row.entry_type,
      innings: row.innings,
      entryOver: Number(row.entry_over),
      entryPaise: Number(row.entry_paise),
      entryDecimal: Number(row.entry_decimal),
      entryWickets: Number(row.entry_wickets || 0),
      entryTime: new Date(row.entry_time),
      exitOver: row.exit_over !== null && row.exit_over !== undefined ? Number(row.exit_over) : undefined,
      exitPaise: row.exit_paise !== null && row.exit_paise !== undefined ? Number(row.exit_paise) : undefined,
      exitDecimal:
        row.exit_decimal !== null && row.exit_decimal !== undefined ? Number(row.exit_decimal) : undefined,
      exitTime: row.exit_time ? new Date(row.exit_time) : undefined,
      exitReason: row.exit_reason,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));

    return {
      positions,
      signals,
      trades,
      strategyState: (json.strategyState as SerializedMatchStrategyState) || null,
    };
  } catch (err) {
    console.warn('loadMatchStrategyFromSupabase error:', err);
    return { positions: [], signals: [], trades: [], strategyState: null };
  }
}

// In-memory cache for concluded match broadcasts in client session
const clientConcludedMatchCache = new Set<string>();

/**
 * Verifies with PostgreSQL database if a match conclusion notification was ALREADY sent.
 * If not, atomically records it into `app_settings` with key `tele_concluded:${matchId}`
 * and returns `true`. If already recorded, returns `false`.
 * Guarantees zero duplicate broadcasts across page reloads, multiple tabs, and multiple devices.
 */
export async function checkAndRecordMatchConclusionInDb(
  matchId: string,
  details: {
    team1?: string;
    team2?: string;
    result?: string;
    seriesName?: string;
  }
): Promise<boolean> {
  const dbKey = `tele_concluded:${matchId}`;

  // 1. Fast in-memory check
  if (clientConcludedMatchCache.has(dbKey)) {
    return false;
  }

  try {
    const res = await fetch('/api/db/app-settings/check-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: dbKey,
        payload: {
          matchId,
          ...details,
          sentAt: new Date().toISOString(),
        },
        description: `Telegram match concluded notification record for match ${matchId}`,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.alreadyRecorded) {
        clientConcludedMatchCache.add(dbKey);
        return false;
      }
      clientConcludedMatchCache.add(dbKey);
      return true;
    }
  } catch (err) {
    console.warn('Error verifying match conclusion in DB:', err);
  }

  clientConcludedMatchCache.add(dbKey);
  return true;
}

// In-memory cache for strategy entry signals (1st and 2nd entry)
const clientStrategyEntryCache = new Set<string>();

/**
 * Checks whether a First Entry signal has been recorded for a match
 * in either memory, local storage, or the PostgreSQL database.
 */
export async function hasFirstEntryRecordedInDb(matchId: string): Promise<boolean> {
  const dbKey = `tele_entry:${matchId}:FIRST_ENTRY`;
  if (clientStrategyEntryCache.has(dbKey)) {
    return true;
  }

  try {
    const trades = await fetchStrategyTradesFromDb(matchId);
    if (trades.some((t) => t.entryType === 'FIRST_ENTRY')) {
      clientStrategyEntryCache.add(dbKey);
      return true;
    }
  } catch {
    // Non-blocking
  }

  return false;
}

/**
 * Verifies with PostgreSQL database if a First or Second Entry alert was ALREADY sent.
 * If not, atomically records it into `app_settings` with key `tele_entry:${matchId}:${entryType}`
 * and returns `true`. If already sent, returns `false`.
 * Guarantees zero duplicate broadcasts for entry signals.
 */
export async function checkAndRecordEntrySignalInDb(
  matchId: string,
  entryType: 'FIRST_ENTRY' | 'SECOND_ENTRY',
  details: {
    team1?: string;
    team2?: string;
    measuredTeam?: string;
    decimalOdds?: number | null;
    opposingOdds?: number | null;
    over?: number;
    innings?: number;
    score?: string;
    rule?: string;
  }
): Promise<boolean> {
  const dbKey = `tele_entry:${matchId}:${entryType}`;

  // 1. In-memory check
  if (clientStrategyEntryCache.has(dbKey)) {
    return false;
  }

  try {
    const res = await fetch('/api/db/app-settings/check-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: dbKey,
        payload: {
          matchId,
          entryType,
          ...details,
          sentAt: new Date().toISOString(),
        },
        description: `Strategy ${entryType} signal notification record for match ${matchId}`,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.alreadyRecorded) {
        clientStrategyEntryCache.add(dbKey);
        return false;
      }
      clientStrategyEntryCache.add(dbKey);
      return true;
    }
  } catch (err) {
    console.warn(`Error verifying ${entryType} in DB:`, err);
  }

  clientStrategyEntryCache.add(dbKey);
  return true;
}

/**
 * Fetches all match IDs that have a recorded First Entry in the database
 */
export async function fetchRecordedFirstEntriesFromDb(): Promise<Set<string>> {
  const result = new Set<string>();

  try {
    const res = await fetch('/api/db/app-settings/first-entries');
    if (res.ok) {
      const data = await res.json();
      (data.matchIds || []).forEach((mId: string) => {
        result.add(mId);
        clientStrategyEntryCache.add(`tele_entry:${mId}:FIRST_ENTRY`);
      });
    }
  } catch (err) {
    console.warn('fetchRecordedFirstEntriesFromDb error:', err);
  }

  return result;
}
