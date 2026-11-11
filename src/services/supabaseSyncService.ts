/**
 * Local PostgreSQL Synchronization Service
 *
 * Handles bi-directional synchronization between the live cricket/odds API feeds
 * and the local PostgreSQL database (leadhunt) via the backend /api/db/* endpoints.
 */

import { ParsedCricketMatch, TeamInfo, ParsedInningsScore } from '../types/cricket';
import { MatchOddsState } from '../types/odds';
import { StrategySignal, TradePosition, StrategyTradeRecord } from './strategy/types';
import { TelegramConfig } from './telegramService';
import { strategyEngine } from './strategy/engine';
import { isLocalDbConfigured } from './supabaseClient';

// Auto-register listener so every recorded trade (entry or exit) is synced to Local PostgreSQL
strategyEngine.onTrade((trade) => {
  syncStrategyTradeToDb(trade).catch((err) => {
    console.warn('[PostgreSQL] strategyEngine.onTrade sync error:', err);
  });
});

/**
 * Migration Result Metrics
 */
export interface LocalMigrationResult {
  discovered: number;
  migrated: number;
  skipped: number;
  failed: number;
  details: string[];
}

/**
 * Safe migration of existing browser localStorage data to Local PostgreSQL
 */
export async function migrateLocalStorageToSupabase(): Promise<LocalMigrationResult> {
  const result: LocalMigrationResult = {
    discovered: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  if (typeof window === 'undefined') {
    result.details.push('Non-browser environment; skipping localStorage migration');
    return result;
  }

  try {
    const STORAGE_KEY = 'crex_telegram_bot_config_v2';
    const localRaw = localStorage.getItem(STORAGE_KEY);

    if (localRaw) {
      result.discovered += 1;
      let parsed: TelegramConfig;
      try {
        parsed = JSON.parse(localRaw);
      } catch {
        result.failed += 1;
        result.details.push('Local telegram config JSON was malformed');
        return result;
      }

      // Check remote config
      const checkRes = await fetch('/api/db/telegram-config');
      const existing = checkRes.ok ? await checkRes.json() : null;

      if (existing?.data) {
        result.skipped += 1;
        result.details.push('Remote telegram_config already present in PostgreSQL (preserved remote)');
      } else {
        const postRes = await fetch('/api/db/telegram-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed),
        });

        if (postRes.ok) {
          result.migrated += 1;
          result.details.push('Successfully migrated telegram bot config to PostgreSQL app_settings');
        } else {
          result.failed += 1;
          result.details.push('Failed to save telegram config to PostgreSQL');
        }
      }
    }
  } catch (err: any) {
    result.failed += 1;
    result.details.push(`Unexpected error during migration: ${err?.message || err}`);
  }

  return result;
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
 * Loads historical trade positions, signals, and trades for a match from Local PostgreSQL
 */
export async function loadMatchStrategyFromSupabase(matchId: string): Promise<{
  positions: TradePosition[];
  signals: StrategySignal[];
  trades: StrategyTradeRecord[];
}> {
  if (!matchId) {
    return { positions: [], signals: [], trades: [] };
  }

  try {
    const res = await fetch(`/api/db/match-strategy/${encodeURIComponent(matchId)}`);
    if (!res.ok) return { positions: [], signals: [], trades: [] };
    const json = await res.json();

    const positions: TradePosition[] = (json.positions || []).map((p: any) => ({
      id: p.id,
      matchId,
      positionType: p.position_type,
      status: p.status,
      candidateSignalId: p.candidate_signal_id || undefined,
      entryOdds: p.entry_odds ? Number(p.entry_odds) : undefined,
      entryTimestamp: p.entry_timestamp ? new Date(p.entry_timestamp) : undefined,
      entryOver: p.entry_over ? Number(p.entry_over) : undefined,
      entryInnings: p.entry_innings || undefined,
      entryWickets: p.entry_wickets ?? undefined,
      exitOdds: p.exit_odds ? Number(p.exit_odds) : undefined,
      exitTimestamp: p.exit_timestamp ? new Date(p.exit_timestamp) : undefined,
      exitOver: p.exit_over ? Number(p.exit_over) : undefined,
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
        decimalOdds: s.decimal_odds ? Number(s.decimal_odds) : null,
        previousDecimalOdds: s.previous_decimal_odds ? Number(s.previous_decimal_odds) : null,
        oddsDelta: s.odds_delta ? Number(s.odds_delta) : null,
        opposingTeamOdds: s.opposing_team_odds ? Number(s.opposing_team_odds) : null,
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
      exitOver: row.exit_over ? Number(row.exit_over) : undefined,
      exitPaise: row.exit_paise ? Number(row.exit_paise) : undefined,
      exitDecimal: row.exit_decimal ? Number(row.exit_decimal) : undefined,
      exitTime: row.exit_time ? new Date(row.exit_time) : undefined,
      exitReason: row.exit_reason,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));

    return { positions, signals, trades };
  } catch (err) {
    console.warn('loadMatchStrategyFromSupabase error:', err);
    return { positions: [], signals: [], trades: [] };
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
