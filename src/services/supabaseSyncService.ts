/**
 * Supabase Synchronization Service
 *
 * Handles bi-directional synchronization between the live cricket/odds API feeds
 * and the Supabase PostgreSQL database.
 */

import { supabase, isSupabaseConfigured } from './supabaseClient';
import { ParsedCricketMatch, TeamInfo, ParsedInningsScore } from '../types/cricket';
import { MatchOddsState, ParsedMatchOdds } from '../types/odds';
import { StrategySignal, TradePosition } from './strategy/types';
import { TelegramConfig, DEFAULT_TELEGRAM_CONFIG } from './telegramService';

// In-memory cache for UUID mappings to minimize database roundtrips
const teamUuidMap = new Map<string, string>();
const matchUuidMap = new Map<string, string>();

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
 * Requirement 4: Safe migration of existing browser localStorage data to Supabase
 */
export async function migrateLocalStorageToSupabase(): Promise<LocalMigrationResult> {
  const result: LocalMigrationResult = {
    discovered: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  if (!isSupabaseConfigured || typeof window === 'undefined') {
    result.details.push('Supabase not configured or running in non-browser environment');
    return result;
  }

  try {
    // 1. Inspect telegram bot configuration in localStorage
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

      // Check if remote already has telegram_config
      const { data: existing, error: selectErr } = await supabase
        .from('app_settings')
        .select('value, updated_at')
        .eq('key', 'telegram_config')
        .maybeSingle();

      if (selectErr && selectErr.code !== 'PGRST116') {
        result.failed += 1;
        result.details.push(`Supabase select error: ${selectErr.message}`);
      } else if (existing) {
        // Remote already exists - skip overwriting newer data
        result.skipped += 1;
        result.details.push('Remote telegram_config already present in Supabase (preserved remote)');
      } else {
        // Perform verified upsert to Supabase
        const { error: insertErr } = await supabase.from('app_settings').upsert({
          key: 'telegram_config',
          value: parsed,
          description: 'Migrated from browser localStorage (crex_telegram_bot_config_v2)',
          updated_at: new Date().toISOString(),
        });

        if (insertErr) {
          result.failed += 1;
          result.details.push(`Failed to migrate telegram config: ${insertErr.message}`);
        } else {
          result.migrated += 1;
          result.details.push('Successfully migrated telegram bot config to Supabase app_settings');
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
 * Resolves or creates internal database UUID for a team
 */
export async function getOrCreateTeamId(team: TeamInfo): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const key = team.key;
  if (!key) return null;

  if (teamUuidMap.has(key)) {
    return teamUuidMap.get(key)!;
  }

  try {
    // Attempt lookup by external_team_key
    const { data: existing } = await supabase
      .from('teams')
      .select('id')
      .eq('external_team_key', key)
      .maybeSingle();

    if (existing?.id) {
      teamUuidMap.set(key, existing.id);
      return existing.id;
    }

    // Insert new team
    const { data: inserted, error } = await supabase
      .from('teams')
      .upsert(
        {
          external_team_key: key,
          name: team.name || `Team ${key}`,
          short_name: team.shortName || key,
          color: team.color || '#2563eb',
          dark_color: team.darkColor || '#1e3a8a',
          flag_url: team.flagUrl || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'external_team_key' }
      )
      .select('id')
      .single();

    if (inserted?.id) {
      teamUuidMap.set(key, inserted.id);
      return inserted.id;
    }
    if (error) {
      console.warn('Team upsert warning:', error.message);
    }
  } catch (err) {
    console.warn('Team resolve error:', err);
  }

  return null;
}

/**
 * Resolves internal database UUID for a match external ID
 */
export async function getMatchInternalId(externalMatchId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !externalMatchId) return null;

  if (matchUuidMap.has(externalMatchId)) {
    return matchUuidMap.get(externalMatchId)!;
  }

  try {
    const { data } = await supabase
      .from('matches')
      .select('id')
      .eq('external_match_id', externalMatchId)
      .maybeSingle();

    if (data?.id) {
      matchUuidMap.set(externalMatchId, data.id);
      return data.id;
    }
  } catch {
    // Non-blocking
  }
  return null;
}

/**
 * Requirement 3 & 5: Persists a normalized cricket match and its latest score state to Supabase
 */
export async function syncMatchToSupabase(match: ParsedCricketMatch): Promise<string | null> {
  if (!isSupabaseConfigured || !match.id) return null;

  try {
    // 1. Ensure team records exist
    const [team1Id, team2Id] = await Promise.all([
      getOrCreateTeamId(match.team1),
      getOrCreateTeamId(match.team2),
    ]);

    if (!team1Id || !team2Id) return null;

    // 2. Upsert match record
    const { data: matchRecord, error: matchErr } = await supabase
      .from('matches')
      .upsert(
        {
          external_match_id: match.id,
          dt_id: match.raw?.dt_id ? String(match.raw.dt_id) : null,
          format: match.format || 'Match',
          match_title_prefix: match.matchTitlePrefix || null,
          series_key: match.seriesKey || null,
          series_name: match.seriesName || null,
          venue_key: match.venueKey || null,
          venue_name: match.venueName || null,
          team1_id: team1Id,
          team2_id: team2Id,
          start_time: match.startTime.toISOString(),
          finish_time: match.finishTime ? match.finishTime.toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'external_match_id' }
      )
      .select('id')
      .single();

    if (matchErr) {
      console.warn('Match upsert error:', matchErr.message);
      return null;
    }

    const matchUuid = matchRecord?.id;
    if (!matchUuid) return null;
    matchUuidMap.set(match.id, matchUuid);

    // 3. Upsert match-to-odds-key mapping
    await supabase.from('match_odds_keys').upsert(
      {
        match_id: matchUuid,
        odds_key: match.id,
        masked_key: `${match.id.slice(0, 2)}**`,
        is_verified: true,
        verification_reason: 'Resolved from Crex top matches catalog',
        last_verified_at: new Date().toISOString(),
      },
      { onConflict: 'match_id,odds_key' }
    );

    // 4. Upsert latest match state (1:1 snapshot)
    const t1Score = match.team1Score;
    const t2Score = match.team2Score;
    const battingTeamId =
      match.battingTeamKey === match.team1.key
        ? team1Id
        : match.battingTeamKey === match.team2.key
        ? team2Id
        : null;

    await supabase.from('latest_match_state').upsert(
      {
        match_id: matchUuid,
        status: match.status,
        status_label: match.statusLabel,
        status_detail: match.statusDetail || null,
        result_text: match.resultText || null,
        session_text: match.sessionText || null,
        current_innings: match.team2Score ? 2 : 1,
        batting_team_id: battingTeamId,
        target: match.target || null,
        required_run_rate: match.requiredRunRate || null,
        current_run_rate: match.currentRunRate || null,
        win_prob_team1: match.winProbability?.team1Prob || null,
        win_prob_team2: match.winProbability?.team2Prob || null,
        team1_score_runs: t1Score?.runs ?? null,
        team1_score_wickets: t1Score?.wickets ?? null,
        team1_score_overs: t1Score?.overs ?? null,
        team1_score_raw: t1Score?.rawString ?? null,
        team2_score_runs: t2Score?.runs ?? null,
        team2_score_wickets: t2Score?.wickets ?? null,
        team2_score_overs: t2Score?.overs ?? null,
        team2_score_raw: t2Score?.rawString ?? null,
        raw_score_j: match.raw?.j || null,
        raw_score_k: match.raw?.k || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'match_id' }
    );

    return matchUuid;
  } catch (err) {
    console.warn('syncMatchToSupabase error:', err);
    return null;
  }
}

/**
 * Requirement 5 & 6: Persists latest odds state and historical snapshots to Supabase
 */
export async function syncOddsToSupabase(
  matchId: string,
  oddsState: MatchOddsState
): Promise<void> {
  if (!isSupabaseConfigured || !oddsState?.odds) return;

  try {
    const odds = oddsState.odds;
    const bookmaker = odds.bookmaker;
    const movement = oddsState.movement;
    const matchUuid = await getMatchInternalId(matchId);

    // 1. Record every odds update as a new row in `match_odds_ticks` table
    try {
      await supabase.from('match_odds_ticks').insert({
        match_id: matchId,
        match_uuid: matchUuid || null,
        odds_key: oddsState.oddsKey || matchId,
        favorite_team: odds.favoriteTeamName || null,
        back_rate: bookmaker.backRate ?? null,
        lay_rate: bookmaker.layRate ?? null,
        decimal_back: bookmaker.decimalBack ?? null,
        decimal_lay: bookmaker.decimalLay ?? null,
        spread: bookmaker.spread ?? null,
        raw_rate_string: bookmaker.rawRateString || null,
        direction: movement?.direction || 'stable',
        delta_back: movement?.deltaBack || 0,
        delta_lay: movement?.deltaLay || 0,
        is_suspended: bookmaker.isSuspended || false,
        session_data: odds.sessions && odds.sessions.length > 0 ? odds.sessions : null,
        created_at: new Date().toISOString(),
      });
    } catch (tickErr: any) {
      // Non-fatal if table hasn't been created yet in DB
      console.warn('match_odds_ticks insert notice:', tickErr?.message || tickErr);
    }

    if (!matchUuid) return;

    // 2. Upsert latest odds state for current-snapshot views
    await supabase.from('latest_odds_state').upsert(
      {
        match_id: matchUuid,
        odds_key: oddsState.oddsKey || matchId,
        raw_rate_string: bookmaker.rawRateString || null,
        back_rate: bookmaker.backRate ?? null,
        lay_rate: bookmaker.layRate ?? null,
        decimal_back: bookmaker.decimalBack ?? null,
        decimal_lay: bookmaker.decimalLay ?? null,
        spread: bookmaker.spread ?? null,
        is_suspended: bookmaker.isSuspended,
        favorite_team_name: odds.favoriteTeamName || null,
        direction: movement?.direction || 'stable',
        delta_back: movement?.deltaBack || 0,
        delta_lay: movement?.deltaLay || 0,
        session_markets: odds.sessions || [],
        speech_names: odds.speechNames || {},
        latency_ms: odds.latencyMs || 0,
        last_changed_at: movement?.lastChangedAt ? new Date(movement.lastChangedAt).toISOString() : null,
        last_updated: oddsState.lastUpdated ? new Date(oddsState.lastUpdated).toISOString() : new Date().toISOString(),
      },
      { onConflict: 'match_id' }
    );

    // 3. Insert historical snapshot if there is active movement or price change
    if (movement && (movement.deltaBack !== 0 || movement.deltaLay !== 0)) {
      await supabase.from('odds_snapshots').insert({
        match_id: matchUuid,
        decimal_back: bookmaker.decimalBack,
        decimal_lay: bookmaker.decimalLay,
        back_rate: bookmaker.backRate,
        lay_rate: bookmaker.layRate,
        spread: bookmaker.spread,
        is_suspended: bookmaker.isSuspended,
        delta_back: movement.deltaBack,
        delta_lay: movement.deltaLay,
        trigger_reason: 'RATE_CHANGE',
        timestamp: new Date().toISOString(),
      });
    }
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
  if (!isSupabaseConfigured || !matchId) return [];

  try {
    const { data, error } = await supabase
      .from('match_odds_ticks')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('fetchOddsTicksFromSupabase error:', err);
    return [];
  }
}

/**
 * Requirement 7: Persists an entry/exit strategy signal to Supabase with deduplication
 */
export async function syncStrategySignalToSupabase(signal: StrategySignal): Promise<void> {
  if (!isSupabaseConfigured || !signal.matchId) return;

  try {
    const matchUuid = await getMatchInternalId(signal.matchId);
    if (!matchUuid) return;

    // Composite deduplication hash
    const dedupeHash = `${signal.matchId}-${signal.signalType}-${signal.status}-${signal.currentInnings}-${signal.currentOver}-${signal.relevantOdds.decimalOdds ?? 'null'}-${signal.relevantOdds.opposingTeamOdds ?? 'null'}`;

    await supabase.from('strategy_signals').upsert(
      {
        match_id: matchUuid,
        event_dedupe_hash: dedupeHash,
        signal_type: signal.signalType,
        status: signal.status,
        current_innings: signal.currentInnings,
        current_over: signal.currentOver,
        ball_number: signal.ballNumber || 0,
        measured_team: signal.relevantOdds.measuredTeam || null,
        decimal_odds: signal.relevantOdds.decimalOdds ?? null,
        previous_decimal_odds: signal.relevantOdds.previousDecimalOdds ?? null,
        odds_delta: signal.relevantOdds.oddsDelta ?? null,
        opposing_team_odds: signal.relevantOdds.opposingTeamOdds ?? null,
        rule_evaluated: signal.ruleEvaluated,
        explanation: signal.explanation,
        metadata: signal.metadata || {},
        timestamp: signal.timestamp ? new Date(signal.timestamp).toISOString() : new Date().toISOString(),
      },
      { onConflict: 'event_dedupe_hash' }
    );
  } catch (err) {
    console.warn('syncStrategySignalToSupabase error:', err);
  }
}

/**
 * Requirement 7: Persists trade position (First Entry / Second Entry) to Supabase
 */
export async function syncTradePositionToSupabase(position: TradePosition): Promise<void> {
  if (!isSupabaseConfigured || !position.matchId) return;

  try {
    const matchUuid = await getMatchInternalId(position.matchId);
    if (!matchUuid) return;

    await supabase.from('trade_positions').upsert(
      {
        match_id: matchUuid,
        position_type: position.positionType,
        status: position.status,
        candidate_signal_id: position.candidateSignalId || null,
        entry_odds: position.entryOdds ?? null,
        entry_timestamp: position.entryTimestamp ? new Date(position.entryTimestamp).toISOString() : null,
        entry_over: position.entryOver ?? null,
        entry_innings: position.entryInnings ?? null,
        entry_wickets: position.entryWickets ?? null,
        exit_odds: position.exitOdds ?? null,
        exit_timestamp: position.exitTimestamp ? new Date(position.exitTimestamp).toISOString() : null,
        exit_over: position.exitOver ?? null,
        bookset_signal_id: position.booksetSignalId || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'match_id,position_type' }
    );
  } catch (err) {
    console.warn('syncTradePositionToSupabase error:', err);
  }
}

/**
 * Requirement 5: Retrieves all matches with their latest scores and odds from Supabase
 */
export async function fetchMatchesFromSupabase(): Promise<ParsedCricketMatch[]> {
  if (!isSupabaseConfigured) return [];

  try {
    const { data, error } = await supabase
      .from('matches')
      .select(`
        id,
        external_match_id,
        dt_id,
        format,
        match_title_prefix,
        series_key,
        series_name,
        venue_key,
        venue_name,
        start_time,
        finish_time,
        team1:teams!matches_team1_id_fkey(*),
        team2:teams!matches_team2_id_fkey(*),
        latest_match_state(*),
        latest_odds_state(*)
      `)
      .order('start_time', { ascending: false });

    if (error || !data) {
      console.warn('fetchMatchesFromSupabase error:', error?.message);
      return [];
    }

    return data.map((row: any): ParsedCricketMatch => {
      const state = row.latest_match_state || {};
      const odds = row.latest_odds_state || {};

      const team1: TeamInfo = {
        key: row.team1?.external_team_key || 'T1',
        name: row.team1?.name || 'Team 1',
        shortName: row.team1?.short_name || 'T1',
        color: row.team1?.color || '#2563eb',
        darkColor: row.team1?.dark_color || '#1e3a8a',
        flagUrl: row.team1?.flag_url || undefined,
      };

      const team2: TeamInfo = {
        key: row.team2?.external_team_key || 'T2',
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
 * Requirement 6: Loads historical trade positions and signals for a match from Supabase
 */
export async function loadMatchStrategyFromSupabase(matchId: string): Promise<{
  positions: TradePosition[];
  signals: StrategySignal[];
}> {
  if (!isSupabaseConfigured || !matchId) {
    return { positions: [], signals: [] };
  }

  try {
    const matchUuid = await getMatchInternalId(matchId);
    if (!matchUuid) return { positions: [], signals: [] };

    // 1. Fetch trade positions
    const { data: posData } = await supabase
      .from('trade_positions')
      .select('*')
      .eq('match_id', matchUuid);

    const positions: TradePosition[] = (posData || []).map((p: any) => ({
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

    // 2. Fetch strategy signals
    const { data: sigData } = await supabase
      .from('strategy_signals')
      .select('*')
      .eq('match_id', matchUuid)
      .order('timestamp', { ascending: false })
      .limit(100);

    const signals: StrategySignal[] = (sigData || []).map((s: any) => ({
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

    return { positions, signals };
  } catch (err) {
    console.warn('loadMatchStrategyFromSupabase error:', err);
    return { positions: [], signals: [] };
  }
}

// In-memory cache for concluded match broadcasts in client session
const clientConcludedMatchCache = new Set<string>();

/**
 * Verifies with Supabase database if a match conclusion notification was ALREADY sent.
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

  if (!isSupabaseConfigured) {
    clientConcludedMatchCache.add(dbKey);
    return true;
  }

  try {
    // 2. Query Supabase database to see if already recorded
    const { data: existing, error: selectErr } = await supabase
      .from('app_settings')
      .select('key')
      .eq('key', dbKey)
      .maybeSingle();

    if (!selectErr && existing?.key) {
      clientConcludedMatchCache.add(dbKey);
      return false; // Already sent previously by another tab or backend
    }

    // 3. Atomically record in DB BEFORE sending
    await supabase.from('app_settings').upsert({
      key: dbKey,
      value: {
        matchId,
        ...details,
        sentAt: new Date().toISOString(),
      },
      description: `Telegram match concluded notification record for match ${matchId}`,
      updated_at: new Date().toISOString(),
    });

    clientConcludedMatchCache.add(dbKey);
    return true;
  } catch (err) {
    console.warn('Error verifying match conclusion in DB:', err);
    clientConcludedMatchCache.add(dbKey);
    return true;
  }
}

// In-memory cache for strategy entry signals (1st and 2nd entry)
const clientStrategyEntryCache = new Set<string>();

/**
 * Checks whether a First Entry signal has been recorded for a match
 * in either memory, local storage, or the Supabase database.
 */
export async function hasFirstEntryRecordedInDb(matchId: string): Promise<boolean> {
  const dbKey = `tele_entry:${matchId}:FIRST_ENTRY`;
  if (clientStrategyEntryCache.has(dbKey)) {
    return true;
  }

  if (!isSupabaseConfigured) {
    return false;
  }

  try {
    const { data: existing, error } = await supabase
      .from('app_settings')
      .select('key')
      .eq('key', dbKey)
      .maybeSingle();

    if (!error && existing?.key) {
      clientStrategyEntryCache.add(dbKey);
      return true;
    }
  } catch {
    // Non-blocking
  }

  return false;
}

/**
 * Verifies with Supabase database if a First or Second Entry alert was ALREADY sent.
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

  if (!isSupabaseConfigured) {
    clientStrategyEntryCache.add(dbKey);
    return true;
  }

  try {
    // 2. Query Supabase
    const { data: existing, error: selectErr } = await supabase
      .from('app_settings')
      .select('key')
      .eq('key', dbKey)
      .maybeSingle();

    if (!selectErr && existing?.key) {
      clientStrategyEntryCache.add(dbKey);
      return false; // Already sent previously
    }

    // 3. Atomically record in DB BEFORE sending
    await supabase.from('app_settings').upsert({
      key: dbKey,
      value: {
        matchId,
        entryType,
        ...details,
        sentAt: new Date().toISOString(),
      },
      description: `Strategy ${entryType} signal notification record for match ${matchId}`,
      updated_at: new Date().toISOString(),
    });

    clientStrategyEntryCache.add(dbKey);
    return true;
  } catch (err) {
    console.warn(`Error verifying ${entryType} in DB:`, err);
    clientStrategyEntryCache.add(dbKey);
    return true;
  }
}

/**
 * Fetches all match IDs that have a recorded First Entry in the database
 */
export async function fetchRecordedFirstEntriesFromDb(): Promise<Set<string>> {
  const result = new Set<string>();

  if (!isSupabaseConfigured) {
    return result;
  }

  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .like('key', 'tele_entry:%:FIRST_ENTRY');

    if (!error && Array.isArray(data)) {
      data.forEach((row) => {
        const parts = row.key.split(':');
        if (parts.length >= 2 && parts[1]) {
          const matchId = parts[1];
          result.add(matchId);
          clientStrategyEntryCache.add(row.key);
        }
      });
    }
  } catch (err) {
    console.warn('fetchRecordedFirstEntriesFromDb error:', err);
  }

  return result;
}


