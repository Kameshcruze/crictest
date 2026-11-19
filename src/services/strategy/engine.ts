/**
 * Cricket Trading Strategy Engine (Phase 3 Final Specification)
 *
 * Core Rules:
 * - Always trade the batting team.
 * - Control-only odds: Use ONLY `control` ('BATTING' | 'BOWLING' | 'UNKNOWN') and `control_team_odds`
 *   (no "100 - X" or calculateOpposingOdds estimation).
 * - Switch formula: When control switches BOWLING -> BATTING on a boundary ball,
 *   move = (100 - bowling_odds_before) + (100 - batting_odds_after), where bowling_odds_before is
 *   control_team_odds from the last tick before the ball where control was BOWLING.
 * - Same-control move: When control stays BATTING -> BATTING, move = current - previous (must be positive).
 * 1. Booking Team Confirmation: control = BATTING, control_team_odds >= 85, boundary 4 (>= 11p) or 6 (>= 18p).
 * 2. First Entry & Deferred Entry: After booking team confirmed, next 4 (>= 11p) or 6 (>= 18p) with control = BATTING:
 *    - If control_team_odds >= 85 on that ball, enter IMMEDIATELY.
 *    - If below 85, move to CONFIRMED_PENDING_85 and enter on first later ball with BATTING >= 85 (no new 4/6 needed).
 * 3. FIRST_EXIT_BELOW_55: While no wicket has fallen since 1st entry, exit 1st entry if control = BATTING and odds <= 55.
 *    Stops applying permanently once any wicket falls after 1st entry.
 * 4. Second Entry: Only after 1st entry, when a wicket falls after 1st entry and control = BOWLING
 *    with control_team_odds < 65 (works even after the over window). Do NOT exit at the wicket.
 * 5. Bookset (Exit) for BOTH entries: When control = BOWLING and control_team_odds > 85.
 * 6. Over limits (First Entry): 1st innings entries only before over 10 (< 10.0);
 *    2nd innings entries only before over 6 (< 6.0). Otherwise skip the match.
 * 7. Wicket safety filter: >= 3 wickets before any entry (in either innings) skips the match; open entries unaffected.
 */

import { ParsedCricketMatch } from '../../types/cricket';
import { MatchOddsState } from '../../types/odds';
import {
  SignalType,
  SignalStatus,
  StrategySignal,
  TradePosition,
  PositionType,
  StrategyStage,
  TeamControlState,
  StrategyTradeRecord,
  MatchStrategyState,
  SerializedMatchStrategyState,
} from './types';
import { StrategyConfig, DEFAULT_STRATEGY_CONFIG } from './config';
import {
  CanonicalMatchFormat,
  DEFAULT_STRATEGY_ALLOWED_FORMATS,
  EvaluableMatchFormat,
  normalizeMatchFormat,
  sanitizeCanonicalFormatList,
} from './formatFilter';

/**
 * Converts decimal odds to integer paise rate (e.g. 1.86 -> 86 paise).
 */
export function decimalOddsToPaise(decimalOdds: number | null | undefined): number | null {
  if (decimalOdds === null || decimalOdds === undefined || isNaN(decimalOdds) || decimalOdds <= 1.0) {
    return null;
  }
  return Math.round((decimalOdds - 1) * 100);
}

/**
 * Extracts total legal balls bowled in the innings from a score object.
 * Handles 6th-ball over rollovers cleanly (e.g. 0.5 -> 5, 1.0 -> 6, 1.5 -> 11, 2.0 -> 12).
 */
export function getLegalBallCount(score?: {
  overs?: number;
  completedOvers?: number;
  ballsInOver?: number;
  totalBalls?: number;
} | null): number {
  if (!score) return 0;
  if (typeof score.totalBalls === 'number' && !isNaN(score.totalBalls) && score.totalBalls >= 0) {
    return score.totalBalls;
  }
  const overs = typeof score.overs === 'number' && !isNaN(score.overs) ? score.overs : 0;
  const completed = Math.floor(overs);
  const fracBalls = Math.round((overs - completed) * 10);
  if (fracBalls > 0 || overs === completed) {
    return completed * 6 + fracBalls;
  }
  const ballsInOver =
    typeof score.ballsInOver === 'number' && !isNaN(score.ballsInOver) ? score.ballsInOver : 0;
  return completed * 6 + ballsInOver;
}

/**
 * Checks whether the current over falls strictly before the innings over limit:
 * - 1st Innings: entries only before over 10 (< 10.0 overs, e.g. 9.5 passes, 10.0 fails)
 * - 2nd Innings: entries only before over 6 (< 6.0 overs, e.g. 5.5 passes, 6.0 fails)
 */
export function isWithinEntryWindow(
  innings: number,
  over: number,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): boolean {
  if (innings <= 1) {
    return over < config.entryWindows.firstInningsMaxOver;
  }
  return over < config.entryWindows.secondInningsMaxOver;
}

/**
 * Calculates the exact paise change on a boundary ball:
 * - If control switches from Bowling (Pprev) to Batting (Pcurr):
 *     Difference = (100 - Pprev) + (100 - Pcurr)
 *     Example: 98 before (BOWLING) and 90 after (BATTING) -> (100 - 98) + (100 - 90) = 2 + 10 = 12.
 * - If Batting team was already in control:
 *     Difference = Pcurr - Pprev (must be positive; downward moves never pass)
 * - If Batting is NOT in control after the ball:
 *     Does not qualify.
 */
export function calculatePaiseChange(
  prevControl: TeamControlState,
  prevPaise: number,
  currControl: TeamControlState,
  currPaise: number
): {
  delta: number;
  formula: string;
  qualifiesBattingControl: boolean;
} {
  if (currControl !== 'BATTING') {
    return {
      delta: 0,
      formula: 'Batting team is not in control after the ball',
      qualifiesBattingControl: false,
    };
  }

  if (prevControl === 'BOWLING') {
    const delta = (100 - prevPaise) + (100 - currPaise);
    return {
      delta,
      formula: `(100 - ${prevPaise}) + (100 - ${currPaise}) = ${100 - prevPaise} + ${100 - currPaise} = ${delta} paise`,
      qualifiesBattingControl: true,
    };
  }

  if (prevControl !== 'BATTING') {
    return {
      delta: 0,
      formula: `Previous control is ${prevControl} (requires BATTING or BOWLING before the ball)`,
      qualifiesBattingControl: false,
    };
  }

  const delta = currPaise - prevPaise;
  return {
    delta,
    formula: `${currPaise} - ${prevPaise} = ${delta} paise`,
    qualifiesBattingControl: delta > 0,
  };
}

/**
 * Normalizes a Crex team key by stripping leading `^`, trimming, and lowercasing.
 */
export function normalizeTeamKey(key?: string | null): string {
  return String(key || '').replace(/^\^/, '').trim().toLowerCase();
}

function cleanTeamKeyDisplay(key?: string | null): string {
  return String(key || '').replace(/^\^/, '').trim();
}

export interface SignalAuditTelemetry {
  innings: number;
  over: number;
  legal_ball_count: number;
  battingTeamKey: string;
  bowlingTeamKey: string;
  'raw.F': string | null;
  rawF: string | null;
  controlTeamKey: string | null;
  control_before: TeamControlState;
  control_after: TeamControlState;
  odds_before: number | null;
  odds_after: number | null;
  move: number | null;
  odds_fetched_at: string | null;
  score_fetched_at: string | null;
}

function buildAuditMetadata(
  telemetry: SignalAuditTelemetry,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    innings: telemetry.innings,
    over: telemetry.over,
    legal_ball_count: telemetry.legal_ball_count,
    battingTeamKey: telemetry.battingTeamKey,
    bowlingTeamKey: telemetry.bowlingTeamKey,
    'raw.F': telemetry['raw.F'],
    rawF: telemetry.rawF,
    controlTeamKey: telemetry.controlTeamKey,
    control_before: telemetry.control_before,
    control_after: telemetry.control_after,
    odds_before: telemetry.odds_before,
    odds_after: telemetry.odds_after,
    move: telemetry.move,
    odds_fetched_at: telemetry.odds_fetched_at,
    score_fetched_at: telemetry.score_fetched_at,
    ...(extra || {}),
  };
}

function formatAuditTelemetrySuffix(telemetry: SignalAuditTelemetry): string {
  return (
    ` [innings=${telemetry.innings}, over=${telemetry.over}, legal_ball_count=${telemetry.legal_ball_count}, ` +
    `battingTeamKey=${telemetry.battingTeamKey}, bowlingTeamKey=${telemetry.bowlingTeamKey}, ` +
    `raw.F=${telemetry['raw.F'] ?? 'null'}, controlTeamKey=${telemetry.controlTeamKey ?? 'null'}, ` +
    `control_before=${telemetry.control_before}, control_after=${telemetry.control_after}, ` +
    `odds_before=${telemetry.odds_before ?? 'null'}, odds_after=${telemetry.odds_after ?? 'null'}, ` +
    `move=${telemetry.move ?? 'null'}, odds_fetched_at=${telemetry.odds_fetched_at ?? 'null'}, ` +
    `score_fetched_at=${telemetry.score_fetched_at ?? 'null'}]`
  );
}

/**
 * Exact normalized control matching shared between strategy engine & server timeline loop:
 * - NO substring matching (includes) anywhere.
 * - NO matching when shortName or name is empty.
 * - NO fallback to winProbability or partial names.
 * - Matches raw.F to battingTeamKey / bowlingTeamKey by EXACT normalized key first.
 * - If no exact key match, tries raw.cl code lookup (exact code match -> exact non-empty team name/shortName match).
 * - Otherwise returns UNKNOWN.
 * - Control is BATTING only when resolved controlTeamKey === battingTeamKey (normalized exact equality).
 */
export function resolveExactTeamControl(params: {
  rawF?: unknown;
  favoriteTeamKey?: string | null;
  favoriteTeamName?: string | null;
  clList?: Array<{ code?: string; name?: string }>;
  speechNames?: Record<string, string>;
  battingTeamKey: string;
  battingTeamName?: string;
  battingTeamShortName?: string;
  bowlingTeamKey: string;
  bowlingTeamName?: string;
  bowlingTeamShortName?: string;
}): {
  teamInControl: TeamControlState;
  controlTeamKey?: string;
  controlTeamName?: string;
  battingTeamKey: string;
  bowlingTeamKey: string;
  rawF: string | null;
} {
  const battingTeamKey = cleanTeamKeyDisplay(params.battingTeamKey);
  const bowlingTeamKey = cleanTeamKeyDisplay(params.bowlingTeamKey);
  const batKeyNorm = normalizeTeamKey(battingTeamKey);
  const bowlKeyNorm = normalizeTeamKey(bowlingTeamKey);

  const rawFStr =
    typeof params.rawF === 'string' && params.rawF.trim().length > 0 ? params.rawF.trim() : null;
  const favKey = rawFStr
    ? cleanTeamKeyDisplay(rawFStr)
    : cleanTeamKeyDisplay(params.favoriteTeamKey);
  const favKeyNorm = normalizeTeamKey(favKey);

  let controlTeamKey: string | undefined;
  let teamInControl: TeamControlState = 'UNKNOWN';

  if (favKeyNorm) {
    // 1. Exact normalized key match against batting / bowling key
    if (batKeyNorm && favKeyNorm === batKeyNorm && favKeyNorm !== bowlKeyNorm) {
      controlTeamKey = battingTeamKey;
      teamInControl = 'BATTING';
    } else if (bowlKeyNorm && favKeyNorm === bowlKeyNorm && favKeyNorm !== batKeyNorm) {
      controlTeamKey = bowlingTeamKey;
      teamInControl = 'BOWLING';
    }
    // 2. Exact raw.cl code lookup -> exact non-empty team name or shortName match only
    else if (Array.isArray(params.clList)) {
      const clEntry = params.clList.find(
        (item) =>
          item &&
          typeof item.code === 'string' &&
          normalizeTeamKey(item.code) === favKeyNorm
      );
      const clNameNorm =
        clEntry && typeof clEntry.name === 'string' ? clEntry.name.trim().toLowerCase() : '';

      if (clNameNorm.length > 0) {
        const batNameNorm = String(params.battingTeamName || '').trim().toLowerCase();
        const batShortNorm = String(params.battingTeamShortName || '').trim().toLowerCase();
        const bowlNameNorm = String(params.bowlingTeamName || '').trim().toLowerCase();
        const bowlShortNorm = String(params.bowlingTeamShortName || '').trim().toLowerCase();

        const matchesBatting =
          (batNameNorm.length > 0 && clNameNorm === batNameNorm) ||
          (batShortNorm.length > 0 && clNameNorm === batShortNorm);
        const matchesBowling =
          (bowlNameNorm.length > 0 && clNameNorm === bowlNameNorm) ||
          (bowlShortNorm.length > 0 && clNameNorm === bowlShortNorm);

        if (matchesBatting && !matchesBowling && batKeyNorm) {
          controlTeamKey = battingTeamKey;
          teamInControl = 'BATTING';
        } else if (matchesBowling && !matchesBatting && bowlKeyNorm) {
          controlTeamKey = bowlingTeamKey;
          teamInControl = 'BOWLING';
        }
      }
    }
  }

  // Enforce strict invariant: control is BATTING ONLY when normalized controlTeamKey === battingTeamKey
  if (
    !controlTeamKey ||
    !batKeyNorm ||
    normalizeTeamKey(controlTeamKey) !== batKeyNorm
  ) {
    if (teamInControl === 'BATTING') {
      teamInControl = 'UNKNOWN';
    }
  }

  let controlTeamName: string | undefined;
  if (teamInControl === 'BATTING') {
    controlTeamName = params.battingTeamName || params.battingTeamShortName || battingTeamKey;
  } else if (teamInControl === 'BOWLING') {
    controlTeamName = params.bowlingTeamName || params.bowlingTeamShortName || bowlingTeamKey;
  } else if (favKey) {
    const speech = params.speechNames?.[favKey];
    controlTeamName =
      (typeof speech === 'string' && speech.trim()) ||
      (params.favoriteTeamName && params.favoriteTeamName.trim()) ||
      undefined;
    controlTeamKey = favKey;
  }

  return {
    teamInControl,
    controlTeamKey,
    controlTeamName,
    battingTeamKey,
    bowlingTeamKey,
    rawF: rawFStr,
  };
}

/**
 * Resolves which team is currently in control ('BATTING' | 'BOWLING' | 'UNKNOWN')
 * from Crex getSV3 API (field F) using exact normalized key / exact raw.cl lookup ONLY,
 * and returns Crex's raw `control_team_odds` directly.
 */
export function detectTeamInControl(
  match: ParsedCricketMatch,
  oddsState?: MatchOddsState | null
): {
  teamInControl: TeamControlState;
  controlTeamKey?: string;
  controlTeamName?: string;
  battingTeamKey: string;
  battingTeamName: string;
  bowlingTeamKey: string;
  bowlingTeamName: string;
  currentPaise: number | null;
  decimalOdds: number | null;
  rawF: string | null;
} {
  const is2ndInnings = !!match.team2Score;
  const battingTeam = is2ndInnings ? match.team2 : match.team1;
  const bowlingTeam = is2ndInnings ? match.team1 : match.team2;

  const battingTeamKey = cleanTeamKeyDisplay(
    battingTeam.key || (is2ndInnings ? match.raw?.c : match.raw?.b) || 'BAT'
  );
  const battingTeamName = battingTeam.name || battingTeam.shortName || 'Batting Team';
  const bowlingTeamKey = cleanTeamKeyDisplay(
    bowlingTeam.key || (is2ndInnings ? match.raw?.b : match.raw?.c) || 'BOWL'
  );
  const bowlingTeamName = bowlingTeam.name || bowlingTeam.shortName || 'Bowling Team';

  // Reject non-getSV3 snapshots (e.g. item.flb) for control and odds evaluation
  if (!oddsState || oddsState.oddsSource === 'flb' || oddsState.oddsSource === 'none' || !oddsState.odds) {
    return {
      teamInControl: 'UNKNOWN',
      controlTeamKey: undefined,
      controlTeamName: undefined,
      battingTeamKey,
      battingTeamName,
      bowlingTeamKey,
      bowlingTeamName,
      currentPaise: null,
      decimalOdds: null,
      rawF: null,
    };
  }

  const bookmaker = oddsState.odds.bookmaker;
  const decimalOdds = bookmaker?.decimalBack ?? bookmaker?.decimalLay ?? null;
  const currentPaise =
    bookmaker?.backRate !== null && bookmaker?.backRate !== undefined
      ? bookmaker.backRate
      : decimalOddsToPaise(decimalOdds);

  const exactResolved = resolveExactTeamControl({
    rawF: oddsState.odds.raw?.F,
    favoriteTeamKey: oddsState.odds.favoriteTeamKey,
    favoriteTeamName: oddsState.odds.favoriteTeamName,
    clList: oddsState.odds.raw?.cl,
    speechNames: oddsState.odds.speechNames,
    battingTeamKey,
    battingTeamName,
    battingTeamShortName: battingTeam.shortName,
    bowlingTeamKey,
    bowlingTeamName,
    bowlingTeamShortName: bowlingTeam.shortName,
  });

  return {
    teamInControl: exactResolved.teamInControl,
    controlTeamKey: exactResolved.controlTeamKey,
    controlTeamName: exactResolved.controlTeamName,
    battingTeamKey: exactResolved.battingTeamKey,
    battingTeamName,
    bowlingTeamKey: exactResolved.bowlingTeamKey,
    bowlingTeamName,
    currentPaise,
    decimalOdds,
    rawF: exactResolved.rawF,
  };
}

export type TradeListener = (trade: StrategyTradeRecord) => void;

export class CricketStrategyEngine {
  private config: StrategyConfig;
  private matchStates: Map<string, MatchStrategyState> = new Map();
  private tradeListeners: Set<TradeListener> = new Set();

  constructor(config: Partial<StrategyConfig> = {}) {
    this.config = {
      ...DEFAULT_STRATEGY_CONFIG,
      ...config,
      abnormalActivity: {
        ...DEFAULT_STRATEGY_CONFIG.abnormalActivity,
        ...config.abnormalActivity,
      },
      wicketFilter: {
        ...DEFAULT_STRATEGY_CONFIG.wicketFilter,
        ...config.wicketFilter,
      },
      firstEntry: {
        ...DEFAULT_STRATEGY_CONFIG.firstEntry,
        ...config.firstEntry,
      },
      firstExitBelow55: {
        ...DEFAULT_STRATEGY_CONFIG.firstExitBelow55,
        ...config.firstExitBelow55,
      },
      secondEntry: {
        ...DEFAULT_STRATEGY_CONFIG.secondEntry,
        ...config.secondEntry,
      },
      bookset: {
        ...DEFAULT_STRATEGY_CONFIG.bookset,
        ...config.bookset,
      },
      entryWindows: {
        ...DEFAULT_STRATEGY_CONFIG.entryWindows,
        ...config.entryWindows,
      },
    };
  }

  public onTrade(listener: TradeListener): () => void {
    this.tradeListeners.add(listener);
    return () => this.tradeListeners.delete(listener);
  }

  public notifyTrade(trade: StrategyTradeRecord): void {
    for (const listener of this.tradeListeners) {
      try {
        listener(trade);
      } catch (err) {
        console.warn('Error in tradeListener:', err);
      }
    }
  }

  public getConfig(): StrategyConfig {
    return this.config;
  }

  private allowedFormats: EvaluableMatchFormat[] = [...DEFAULT_STRATEGY_ALLOWED_FORMATS];
  private warnedUnknownFormatMatches = new Set<string>();

  public getAllowedFormats(): EvaluableMatchFormat[] {
    return [...this.allowedFormats];
  }

  public setAllowedFormats(formats: readonly EvaluableMatchFormat[]): void {
    this.allowedFormats = sanitizeCanonicalFormatList(formats, []);
  }

  public checkFormatEligibility(match: Pick<ParsedCricketMatch, 'id' | 'format' | 'raw'>): {
    allowed: boolean;
    detectedFormat: CanonicalMatchFormat;
    wasUnknownWarningLogged: boolean;
  } {
    const rawFo = match.raw?.fo !== undefined ? match.raw.fo : match.format;
    const rawT = match.raw?.t;
    const detectedFormat = normalizeMatchFormat(rawFo, rawT);

    if (detectedFormat === 'UNKNOWN') {
      let wasUnknownWarningLogged = false;
      if (!this.warnedUnknownFormatMatches.has(match.id)) {
        this.warnedUnknownFormatMatches.add(match.id);
        wasUnknownWarningLogged = true;
        console.warn(
          `[Strategy Format Warning] match_id=${match.id} has missing/unknown format (raw.fo=${JSON.stringify(match.raw?.fo ?? null)}, raw.t=${JSON.stringify(match.raw?.t ?? null)}, format=${JSON.stringify(match.format ?? null)}) — skipping strategy evaluation.`
        );
      }
      return { allowed: false, detectedFormat, wasUnknownWarningLogged };
    }

    return {
      allowed: this.allowedFormats.includes(detectedFormat),
      detectedFormat,
      wasUnknownWarningLogged: false,
    };
  }

  public getState(matchId: string): MatchStrategyState {
    const existing = this.matchStates.get(matchId);
    if (existing) return existing;

    const initialFirstPosition: TradePosition = {
      id: `${matchId}-first-pos`,
      matchId,
      positionType: 'FIRST_ENTRY',
      status: 'NONE',
    };

    const initialSecondPosition: TradePosition = {
      id: `${matchId}-second-pos`,
      matchId,
      positionType: 'SECOND_ENTRY',
      status: 'NONE',
    };

    const newState: MatchStrategyState = {
      matchId,
      stage: 'WAITING_FOR_CONFIRMATION',
      bookingTeamName: null,
      bookingTeamKey: null,
      battingTeamKey: null,
      bowlingTeamKey: null,
      teamInControl: 'UNKNOWN',
      firstEntryPosition: initialFirstPosition,
      secondEntryPosition: initialSecondPosition,
      firstEntryTrade: null,
      secondEntryTrade: null,
      pending85: false,
      signalsHistory: [],
      candidates: [],
      lastEvaluatedOver: 0,
      lastEvaluatedInnings: 0,
      lastEvaluatedWickets: 0,
      lastEvaluatedRuns: 0,
      lastEvaluatedBalls: 0,
      lastEvaluatedLegalBalls: 0,
      lastEvaluatedOdds: null,
      lastEvaluatedPaise: null,
      lastEvaluatedControl: 'UNKNOWN',
      preBallControl: 'UNKNOWN',
      preBallPaise: null,
      pendingBoundaryBall: null,
      lastScoreUpdatedAtMs: null,
      lastOddsFetchedAtMs: null,
      bookingConfirmedBoundary: null,
      entryConfirmedBoundary: null,
      processedEventKeys: new Set<string>(),
      abnormalActivityCount: 0,
      lastUpdated: new Date(),
    };

    this.matchStates.set(matchId, newState);
    return newState;
  }

  public hasState(matchId: string): boolean {
    return this.matchStates.has(matchId);
  }

  public getAllMatchIds(): string[] {
    return Array.from(this.matchStates.keys());
  }

  public serializeState(matchId: string): SerializedMatchStrategyState {
    const state = this.getState(matchId);
    return {
      ...state,
      firstEntryPosition: { ...state.firstEntryPosition },
      secondEntryPosition: { ...state.secondEntryPosition },
      firstEntryTrade: state.firstEntryTrade ? { ...state.firstEntryTrade } : null,
      secondEntryTrade: state.secondEntryTrade ? { ...state.secondEntryTrade } : null,
      signalsHistory: [...state.signalsHistory],
      candidates: [...state.candidates],
      pendingBoundaryBall: state.pendingBoundaryBall ? { ...state.pendingBoundaryBall } : null,
      bookingConfirmedBoundary: state.bookingConfirmedBoundary
        ? { ...state.bookingConfirmedBoundary }
        : null,
      entryConfirmedBoundary: state.entryConfirmedBoundary
        ? { ...state.entryConfirmedBoundary }
        : null,
      processedEventKeys: Array.from(state.processedEventKeys).slice(-500),
    };
  }

  public getAllSerializedStates(): Record<string, SerializedMatchStrategyState> {
    const out: Record<string, SerializedMatchStrategyState> = {};
    for (const matchId of this.matchStates.keys()) {
      out[matchId] = this.serializeState(matchId);
    }
    return out;
  }

  /**
   * Hydrates strategy state from a persisted snapshot or DB records WITHOUT firing alerts/listeners.
   */
  public hydrateState(
    matchId: string,
    snapshot: Partial<Omit<MatchStrategyState, 'processedEventKeys'>> & {
      processedEventKeys?: Set<string> | string[];
    }
  ): MatchStrategyState {
    const state = this.getState(matchId);

    const toDate = (v: unknown): Date | undefined => {
      if (!v) return undefined;
      if (v instanceof Date) return isNaN(v.getTime()) ? undefined : v;
      const d = new Date(String(v));
      return isNaN(d.getTime()) ? undefined : d;
    };

    const hydratePosition = (
      current: TradePosition,
      incoming?: Partial<TradePosition>
    ): TradePosition => {
      if (!incoming) return current;
      return {
        ...current,
        ...incoming,
        id: incoming.id || current.id,
        matchId,
        positionType: incoming.positionType || current.positionType,
        status: incoming.status || current.status,
        entryTimestamp: toDate(incoming.entryTimestamp) ?? current.entryTimestamp,
        exitTimestamp: toDate(incoming.exitTimestamp) ?? current.exitTimestamp,
      };
    };

    const hydrateTrade = (
      incoming?: StrategyTradeRecord | null
    ): StrategyTradeRecord | null | undefined => {
      if (incoming === undefined) return undefined;
      if (incoming === null) return null;
      return {
        ...incoming,
        entryTime: toDate(incoming.entryTime) || new Date(),
        exitTime: toDate(incoming.exitTime),
        createdAt: toDate(incoming.createdAt) || new Date(),
        updatedAt: toDate(incoming.updatedAt) || new Date(),
      };
    };

    const hydrateSignal = (sig: StrategySignal): StrategySignal => ({
      ...sig,
      timestamp: toDate(sig.timestamp) || new Date(),
    });

    if (snapshot.stage !== undefined) state.stage = snapshot.stage;
    if (snapshot.bookingTeamName !== undefined) state.bookingTeamName = snapshot.bookingTeamName;
    if (snapshot.bookingTeamKey !== undefined) state.bookingTeamKey = snapshot.bookingTeamKey;
    if (snapshot.battingTeamKey !== undefined) state.battingTeamKey = snapshot.battingTeamKey;
    if (snapshot.bowlingTeamKey !== undefined) state.bowlingTeamKey = snapshot.bowlingTeamKey;
    if (snapshot.teamInControl !== undefined) state.teamInControl = snapshot.teamInControl;
    if (snapshot.pending85 !== undefined) state.pending85 = snapshot.pending85;
    if (snapshot.lastEvaluatedOver !== undefined) state.lastEvaluatedOver = snapshot.lastEvaluatedOver;
    if (snapshot.lastEvaluatedInnings !== undefined) state.lastEvaluatedInnings = snapshot.lastEvaluatedInnings;
    if (snapshot.lastEvaluatedWickets !== undefined) state.lastEvaluatedWickets = snapshot.lastEvaluatedWickets;
    if (snapshot.lastEvaluatedRuns !== undefined) state.lastEvaluatedRuns = snapshot.lastEvaluatedRuns;
    if (snapshot.lastEvaluatedBalls !== undefined) state.lastEvaluatedBalls = snapshot.lastEvaluatedBalls;
    if (snapshot.lastEvaluatedLegalBalls !== undefined) {
      state.lastEvaluatedLegalBalls = snapshot.lastEvaluatedLegalBalls;
    }
    if (snapshot.lastEvaluatedOdds !== undefined) state.lastEvaluatedOdds = snapshot.lastEvaluatedOdds;
    if (snapshot.lastEvaluatedPaise !== undefined) state.lastEvaluatedPaise = snapshot.lastEvaluatedPaise;
    if (snapshot.lastEvaluatedControl !== undefined) state.lastEvaluatedControl = snapshot.lastEvaluatedControl;
    if (snapshot.preBallControl !== undefined) state.preBallControl = snapshot.preBallControl;
    if (snapshot.preBallPaise !== undefined) state.preBallPaise = snapshot.preBallPaise;
    if (snapshot.pendingBoundaryBall !== undefined) {
      state.pendingBoundaryBall = snapshot.pendingBoundaryBall ? { ...snapshot.pendingBoundaryBall } : null;
    }
    if (snapshot.lastScoreUpdatedAtMs !== undefined) {
      state.lastScoreUpdatedAtMs = snapshot.lastScoreUpdatedAtMs;
    }
    if (snapshot.lastOddsFetchedAtMs !== undefined) {
      state.lastOddsFetchedAtMs = snapshot.lastOddsFetchedAtMs;
    }
    if (snapshot.abnormalActivityCount !== undefined) state.abnormalActivityCount = snapshot.abnormalActivityCount;

    if (snapshot.firstEntryPosition) {
      state.firstEntryPosition = hydratePosition(state.firstEntryPosition, snapshot.firstEntryPosition);
    }
    if (snapshot.secondEntryPosition) {
      state.secondEntryPosition = hydratePosition(state.secondEntryPosition, snapshot.secondEntryPosition);
    }
    if (snapshot.firstEntryTrade !== undefined) {
      state.firstEntryTrade = hydrateTrade(snapshot.firstEntryTrade) ?? null;
    }
    if (snapshot.secondEntryTrade !== undefined) {
      state.secondEntryTrade = hydrateTrade(snapshot.secondEntryTrade) ?? null;
    }
    if (Array.isArray(snapshot.signalsHistory)) {
      state.signalsHistory = snapshot.signalsHistory.map(hydrateSignal).slice(0, 200);
    }
    if (Array.isArray(snapshot.candidates)) {
      state.candidates = snapshot.candidates.map(hydrateSignal).slice(0, 200);
    }
    if (snapshot.bookingConfirmedBoundary !== undefined) {
      state.bookingConfirmedBoundary = snapshot.bookingConfirmedBoundary
        ? {
            ...snapshot.bookingConfirmedBoundary,
            timestamp: toDate(snapshot.bookingConfirmedBoundary.timestamp) || new Date(),
          }
        : null;
    }
    if (snapshot.entryConfirmedBoundary !== undefined) {
      state.entryConfirmedBoundary = snapshot.entryConfirmedBoundary
        ? {
            ...snapshot.entryConfirmedBoundary,
            timestamp: toDate(snapshot.entryConfirmedBoundary.timestamp) || new Date(),
          }
        : null;
    }
    if (snapshot.processedEventKeys) {
      state.processedEventKeys =
        snapshot.processedEventKeys instanceof Set
          ? new Set(snapshot.processedEventKeys)
          : new Set(snapshot.processedEventKeys);
    }
    if (snapshot.lastUpdated) {
      state.lastUpdated = toDate(snapshot.lastUpdated) || new Date();
    }

    return state;
  }

  public resetState(matchId: string): void {
    this.matchStates.delete(matchId);
  }

  /**
   * Explicitly records an entry position and creates a StrategyTradeRecord.
   * Note: We always trade the batting team; for FIRST_ENTRY entryOdds/Paise is BATTING control_team_odds (> 85),
   * for SECOND_ENTRY entryOdds/Paise records the triggering BOWLING control_team_odds (< 65).
   */
  public recordEntry(
    matchId: string,
    positionType: PositionType,
    entryOdds: number,
    innings: number,
    over: number,
    wickets: number,
    timestamp: Date = new Date(),
    bookingTeam = 'Booking Team',
    battingTeam = 'Batting Team',
    bowlingTeam = 'Bowling Team',
    matchName?: string,
    seriesName?: string,
    isManual = false
  ): TradePosition {
    const state = this.getState(matchId);
    const targetPos =
      positionType === 'FIRST_ENTRY' ? state.firstEntryPosition : state.secondEntryPosition;

    targetPos.status = 'RECORDED_ENTRY';
    targetPos.entryOdds = entryOdds;
    targetPos.entryTimestamp = timestamp;
    targetPos.entryInnings = innings;
    targetPos.entryOver = over;
    targetPos.entryWickets = wickets;

    const entryPaise = Math.round((entryOdds - 1) * 100);
    const rawBookingTeam = state.bookingTeamName || bookingTeam;
    const formattedBookingTeam = isManual
      ? /^\[?MANUAL\]?/i.test(rawBookingTeam)
        ? rawBookingTeam.replace(/^manual\b/i, '[MANUAL]')
        : `[MANUAL] ${rawBookingTeam}`
      : rawBookingTeam;

    const tradeRecord: StrategyTradeRecord = {
      id: `${matchId}-${positionType}-${Date.now()}`,
      matchId,
      matchName,
      seriesName,
      bookingTeam: formattedBookingTeam,
      battingTeam,
      bowlingTeam,
      entryType: positionType,
      innings,
      entryOver: over,
      entryPaise,
      entryDecimal: entryOdds,
      entryWickets: wickets,
      entryTime: timestamp,
      status: 'ACTIVE',
      isManual,
      source: isManual ? 'MANUAL' : 'AUTO',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    if (positionType === 'FIRST_ENTRY') {
      state.firstEntryTrade = tradeRecord;
      state.stage = 'ACTIVE_FIRST_ENTRY';
      state.pending85 = false;
    } else {
      state.secondEntryTrade = tradeRecord;
      state.stage = 'ACTIVE_SECOND_ENTRY';
    }

    state.lastUpdated = new Date();
    this.notifyTrade(tradeRecord);
    return { ...targetPos };
  }

  /**
   * Explicitly records an exit position (Bookset) and updates StrategyTradeRecord(s).
   * When exiting SECOND_ENTRY (combined bookset), BOTH SECOND_ENTRY and active FIRST_ENTRY are closed.
   */
  public recordExit(
    matchId: string,
    positionType: PositionType,
    exitOdds: number,
    over: number,
    timestamp: Date = new Date(),
    exitReason: 'FIRST_EXIT_BELOW_55' | 'FIRST_BOOKSET_45_55' | 'FULL_BOOKSET_OPPOSING_85' = 'FULL_BOOKSET_OPPOSING_85',
    isManual = false
  ): TradePosition {
    const state = this.getState(matchId);
    const targetPos =
      positionType === 'FIRST_ENTRY' ? state.firstEntryPosition : state.secondEntryPosition;

    targetPos.status = 'RECORDED_EXIT';
    targetPos.exitOdds = exitOdds;
    targetPos.exitTimestamp = timestamp;
    targetPos.exitOver = over;

    const exitPaise = Math.round((exitOdds - 1) * 100);

    if (positionType === 'FIRST_ENTRY' && state.firstEntryTrade) {
      state.firstEntryTrade.exitOver = over;
      state.firstEntryTrade.exitPaise = exitPaise;
      state.firstEntryTrade.exitDecimal = exitOdds;
      state.firstEntryTrade.exitTime = timestamp;
      state.firstEntryTrade.exitReason = exitReason;
      state.firstEntryTrade.status = 'BOOKSET_COMPLETED';
      if (isManual) {
        state.firstEntryTrade.isManual = true;
        state.firstEntryTrade.source = 'MANUAL';
        if (!/^\[?MANUAL\]?/i.test(state.firstEntryTrade.bookingTeam || '')) {
          state.firstEntryTrade.bookingTeam = `[MANUAL] ${state.firstEntryTrade.bookingTeam || 'Override'}`;
        }
      }
      state.firstEntryTrade.updatedAt = timestamp;
      state.stage = 'FIRST_BOOKSET_COMPLETED';
      this.notifyTrade(state.firstEntryTrade);
    }

    if (positionType === 'SECOND_ENTRY' && state.secondEntryTrade) {
      state.secondEntryTrade.exitOver = over;
      state.secondEntryTrade.exitPaise = exitPaise;
      state.secondEntryTrade.exitDecimal = exitOdds;
      state.secondEntryTrade.exitTime = timestamp;
      state.secondEntryTrade.exitReason = exitReason;
      state.secondEntryTrade.status = 'BOOKSET_COMPLETED';
      if (isManual) {
        state.secondEntryTrade.isManual = true;
        state.secondEntryTrade.source = 'MANUAL';
        if (!/^\[?MANUAL\]?/i.test(state.secondEntryTrade.bookingTeam || '')) {
          state.secondEntryTrade.bookingTeam = `[MANUAL] ${state.secondEntryTrade.bookingTeam || 'Override'}`;
        }
      }
      state.secondEntryTrade.updatedAt = timestamp;
      state.stage = 'FULL_BOOKSET_COMPLETED';
      this.notifyTrade(state.secondEntryTrade);

      // Also close first entry trade and position if still active
      if (state.firstEntryPosition.status === 'RECORDED_ENTRY' || state.firstEntryPosition.status === 'EXIT_CANDIDATE_DETECTED') {
        state.firstEntryPosition.status = 'RECORDED_EXIT';
        state.firstEntryPosition.exitOdds = exitOdds;
        state.firstEntryPosition.exitTimestamp = timestamp;
        state.firstEntryPosition.exitOver = over;
      }

      if (state.firstEntryTrade && state.firstEntryTrade.status === 'ACTIVE') {
        state.firstEntryTrade.exitOver = over;
        state.firstEntryTrade.exitPaise = exitPaise;
        state.firstEntryTrade.exitDecimal = exitOdds;
        state.firstEntryTrade.exitTime = timestamp;
        state.firstEntryTrade.exitReason = 'FULL_BOOKSET_OPPOSING_85';
        state.firstEntryTrade.status = 'BOOKSET_COMPLETED';
        if (isManual) {
          state.firstEntryTrade.isManual = true;
          state.firstEntryTrade.source = 'MANUAL';
        }
        state.firstEntryTrade.updatedAt = timestamp;
        this.notifyTrade(state.firstEntryTrade);
      }
    }

    state.lastUpdated = new Date();
    return { ...targetPos };
  }

  /**
   * Evaluates Abnormal Activity rule on a boundary (Four or Six):
   * - Four: Must have at least 11 paise change (>= 11 paise / >= 0.11).
   * - Six: Must have at least 18 paise change (>= 18 paise / >= 0.18).
   * - Batting team must be in control after the boundary.
   */
  public evaluateAbnormalActivity(params: {
    matchId: string;
    boundaryType: 'FOUR' | 'SIX';
    oddsMovement: number; // in decimal e.g. 0.11 or paise e.g. 11
    currentInnings: number;
    currentOver: number;
    ballNumber?: number;
    measuredTeam: string;
    decimalOdds: number | null;
    previousDecimalOdds?: number | null;
    timestamp?: Date;
    teamInControl?: TeamControlState;
    customFormulaExplanation?: string;
  }): StrategySignal {
    const {
      matchId,
      boundaryType,
      oddsMovement,
      currentInnings,
      currentOver,
      ballNumber = 0,
      measuredTeam,
      decimalOdds,
      previousDecimalOdds,
      timestamp = new Date(),
      teamInControl = 'BATTING',
      customFormulaExplanation,
    } = params;

    const state = this.getState(matchId);
    const signalType: SignalType =
      boundaryType === 'FOUR' ? 'ABNORMAL_ACTIVITY_FOUR' : 'ABNORMAL_ACTIVITY_SIX';

    const minDecimal =
      boundaryType === 'FOUR'
        ? this.config.abnormalActivity.fourMinMovement
        : this.config.abnormalActivity.sixMinMovement;
    const minPaise =
      boundaryType === 'FOUR'
        ? this.config.abnormalActivity.fourMinPaise
        : this.config.abnormalActivity.sixMinPaise;

    const ruleEvaluated =
      boundaryType === 'FOUR'
        ? `Abnormal Activity Four: Batting control + odds movement >= ${minPaise} paise / ${minDecimal.toFixed(2)}`
        : `Abnormal Activity Six: Batting control + odds movement >= ${minPaise} paise / ${minDecimal.toFixed(2)}`;

    if (oddsMovement === null || oddsMovement === undefined || isNaN(oddsMovement)) {
      return {
        id: `${matchId}-${signalType}-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds,
          previousDecimalOdds,
          oddsDelta: null,
        },
        ruleEvaluated,
        status: 'DATA UNAVAILABLE',
        explanation: `Odds movement data is not available for ${boundaryType} boundary.`,
      };
    }

    const isPaiseScale = oddsMovement >= 1.0 || oddsMovement <= -1.0;
    const decimalMovement = isPaiseScale ? oddsMovement / 100 : oddsMovement;
    const paiseMovement = isPaiseScale ? Math.round(oddsMovement) : Math.round(oddsMovement * 100);
    const normalizedMovement = Number(decimalMovement.toFixed(4));

    const battingInControl = teamInControl === 'BATTING';
    const qualifies = battingInControl && paiseMovement > 0 && paiseMovement >= minPaise;
    const status: SignalStatus = qualifies ? 'PASS' : 'FAIL';

    let explanation = '';
    if (!battingInControl) {
      explanation = `FAILED: ${boundaryType} boundary did not leave BATTING team in control (control: ${teamInControl}).`;
    } else if (customFormulaExplanation) {
      explanation = qualifies
        ? `QUALIFIED: ${boundaryType} change of ${paiseMovement} paise (${normalizedMovement.toFixed(2)}) meets threshold >= ${minPaise} paise. Calculation: ${customFormulaExplanation}`
        : `FAILED: ${boundaryType} change of ${paiseMovement} paise (${normalizedMovement.toFixed(2)}) does not meet threshold >= ${minPaise} paise. Calculation: ${customFormulaExplanation}`;
    } else {
      explanation = qualifies
        ? `QUALIFIED: ${boundaryType} odds movement of ${normalizedMovement.toFixed(2)} meets threshold >= ${minDecimal.toFixed(2)}.`
        : `FAILED: ${boundaryType} odds movement of ${normalizedMovement.toFixed(2)} does not meet threshold >= ${minDecimal.toFixed(2)}.`;
    }

    const signal: StrategySignal = {
      id: `${matchId}-${signalType}-${currentInnings}-${currentOver}-${ballNumber}-${paiseMovement}`,
      signalType,
      matchId,
      timestamp,
      currentInnings,
      currentOver,
      ballNumber,
      relevantOdds: {
        measuredTeam,
        teamInControl,
        decimalOdds,
        previousDecimalOdds,
        oddsDelta: normalizedMovement,
        currentPaise: paiseMovement,
      },
      ruleEvaluated,
      status,
      explanation,
      metadata: {
        boundaryType,
        minPaise,
        minDecimal,
        observedPaise: paiseMovement,
        observedDecimal: normalizedMovement,
        battingInControl,
      },
    };

    const dedupeKey = `${matchId}-${signalType}-${status}-${currentInnings}-${currentOver}-${ballNumber}-${paiseMovement}`;
    if (!state.processedEventKeys.has(dedupeKey)) {
      state.processedEventKeys.add(dedupeKey);
      if (qualifies) {
        state.abnormalActivityCount += 1;
      }
      state.signalsHistory.unshift(signal);
      if (state.signalsHistory.length > 200) {
        state.signalsHistory.pop();
      }
    }
    state.lastUpdated = new Date();

    return signal;
  }

  /**
   * Evaluates First Entry / Booking eligibility snapshot using ONLY control & control_team_odds:
   * - control === 'BATTING'
   * - control_team_odds >= 85 paise (>= 1.85 decimal; 85 passes, 84 fails)
   * - Over window: 1st inn < 10.0 ov, 2nd inn < 6.0 ov
   * - Wicket safety filter: < 3 wickets before entry
   */
  public evaluateFirstEntry(params: {
    matchId: string;
    decimalOdds: number | null;
    currentPaise?: number | null;
    teamInControl?: TeamControlState;
    currentInnings: number;
    currentOver: number;
    currentWickets?: number;
    ballNumber?: number;
    measuredTeam: string;
    timestamp?: Date;
  }): StrategySignal {
    const {
      matchId,
      decimalOdds,
      currentPaise: providedPaise,
      teamInControl = 'BATTING',
      currentInnings,
      currentOver,
      currentWickets = 0,
      ballNumber = 0,
      measuredTeam,
      timestamp = new Date(),
    } = params;

    const state = this.getState(matchId);
    const signalType: SignalType = 'FIRST_ENTRY_CANDIDATE';
    const { minPaiseInclusive, minOddsInclusive } = this.config.firstEntry;
    const currentPaise = providedPaise ?? decimalOddsToPaise(decimalOdds);

    const ruleEvaluated = `First Entry: control = BATTING and control_team_odds >= ${minPaiseInclusive} paise (>=${minOddsInclusive.toFixed(2)}) during entry window (Inn 1 < ${this.config.entryWindows.firstInningsMaxOver} ov, Inn 2 < ${this.config.entryWindows.secondInningsMaxOver} ov, < 3 wkts)`;

    // 1. Hold active or completed states without flickering
    if (
      state.stage === 'ACTIVE_FIRST_ENTRY' ||
      state.stage === 'ACTIVE_SECOND_ENTRY' ||
      state.firstEntryPosition.status === 'RECORDED_ENTRY'
    ) {
      const entryPaise =
        state.firstEntryTrade?.entryPaise ??
        (state.firstEntryPosition.entryOdds
          ? Math.round((state.firstEntryPosition.entryOdds - 1) * 100)
          : 85);
      const entryDecimal =
        state.firstEntryTrade?.entryDecimal ?? state.firstEntryPosition.entryOdds ?? 1.85;

      const heldSignal: StrategySignal = {
        id: `${matchId}-FIRST_ENTRY_HELD-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds,
          currentPaise,
        },
        ruleEvaluated: `First Entry (Held): Entered at ${entryPaise} paise (${entryDecimal.toFixed(2)}). Holding until Bookset (BOWLING > ${this.config.bookset.minBowlingPaiseExclusive}p).`,
        status: 'PASS',
        explanation: `FIRST ENTRY ACTIVE & HELD: Entered at ${entryPaise} paise (${entryDecimal.toFixed(2)}). Monitoring for Bookset exit when BOWLING control_team_odds > ${this.config.bookset.minBowlingPaiseExclusive} paise.`,
        metadata: {
          held: true,
          entryPaise,
          entryDecimal,
          currentPaise,
        },
      };

      const heldDedupeKey = `${matchId}-FIRST_ENTRY_HELD-${currentInnings}-${currentOver}`;
      if (!state.processedEventKeys.has(heldDedupeKey)) {
        state.processedEventKeys.add(heldDedupeKey);
        state.signalsHistory.unshift(heldSignal);
        if (state.signalsHistory.length > 200) state.signalsHistory.pop();
      }
      return heldSignal;
    }

    if (
      state.stage === 'FIRST_BOOKSET_COMPLETED' ||
      state.stage === 'FULL_BOOKSET_COMPLETED' ||
      state.firstEntryPosition.status === 'RECORDED_EXIT'
    ) {
      const exitPaise = state.firstEntryTrade?.exitPaise ?? 86;
      const exitDecimal = state.firstEntryTrade?.exitDecimal ?? 1.86;
      return {
        id: `${matchId}-FIRST_ENTRY_COMPLETED-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds,
          currentPaise,
        },
        ruleEvaluated: `First Entry: Completed exit at ${exitPaise} paise (${exitDecimal.toFixed(2)})`,
        status: 'PASS',
        explanation: `FIRST ENTRY COMPLETED: Exit reached and secured at ${exitPaise} paise (${exitDecimal.toFixed(2)}). Position safely closed.`,
        metadata: { completed: true, exitPaise, exitDecimal },
      };
    }

    // 2. Wicket safety filter
    if (currentWickets >= this.config.wicketFilter.maxAllowedWicketsBeforeEntry) {
      state.stage = 'DISQUALIFIED_3_WICKETS';
      state.pending85 = false;
      return {
        id: `${matchId}-DISQUALIFIED_WICKET_LIMIT-${Date.now()}`,
        signalType: 'DISQUALIFIED_WICKET_LIMIT',
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds,
          currentPaise,
        },
        ruleEvaluated: `Wicket Safety: < ${this.config.wicketFilter.maxAllowedWicketsBeforeEntry} wickets required before entry`,
        status: 'FAIL',
        explanation: `SKIPPED MATCH: ${currentWickets} wickets have fallen before entry (limit >= ${this.config.wicketFilter.maxAllowedWicketsBeforeEntry}).`,
      };
    }

    // 3. Entry window check
    const inWindow = isWithinEntryWindow(currentInnings, currentOver, this.config);
    if (!inWindow) {
      return {
        id: `${matchId}-${signalType}-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds,
          currentPaise,
        },
        ruleEvaluated,
        status: 'FAIL',
        explanation: `Entry window closed: Over ${currentOver} is not before limit for innings ${currentInnings} (Inn 1 < ${this.config.entryWindows.firstInningsMaxOver}, Inn 2 < ${this.config.entryWindows.secondInningsMaxOver}).`,
        metadata: { inWindow: false },
      };
    }

    // 4. Availability check
    if (currentPaise === null || currentPaise === undefined || isNaN(currentPaise)) {
      return {
        id: `${matchId}-${signalType}-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds: null,
          currentPaise: null,
        },
        ruleEvaluated,
        status: 'DATA UNAVAILABLE',
        explanation: 'Active odds are currently unavailable or suspended.',
      };
    }

    // 5. Control check (>= 85 paise passes, 84 fails)
    const battingInControl = teamInControl === 'BATTING';
    const meets85 = currentPaise >= minPaiseInclusive;
    const qualifies = battingInControl && meets85;
    const status: SignalStatus = qualifies ? 'PASS' : 'FAIL';

    let explanation = '';
    if (!battingInControl) {
      explanation = `Waiting for BATTING control: Current control is ${teamInControl} at ${currentPaise} paise.`;
    } else if (!meets85) {
      explanation =
        state.stage === 'CONFIRMED_PENDING_85'
          ? `Entry confirmation recorded (CONFIRMED_PENDING_85). Waiting for first later ball with BATTING >= ${minPaiseInclusive} paise (currently ${currentPaise}p).`
          : `Odds ${currentPaise} paise (${(decimalOdds ?? 1 + currentPaise / 100).toFixed(2)}) are below ${minPaiseInclusive} paise (requires >= ${minPaiseInclusive} paise).`;
    } else if (state.stage === 'CONFIRMED_BOOKING_TEAM') {
      explanation = `Booking team ${state.bookingTeamName || measuredTeam} confirmed. Odds ${currentPaise} paise (>= ${minPaiseInclusive}) qualify; waiting for next qualifying 4 (>= 11p) or 6 (>= 18p) entry confirmation.`;
    } else if (state.stage === 'CONFIRMED_PENDING_85') {
      explanation = `Deferred First Entry condition met: BATTING control reached ${currentPaise} paise (>= ${minPaiseInclusive}) inside window.`;
    } else {
      explanation = `First-entry odds eligible: BATTING control at ${currentPaise} paise (>= ${minPaiseInclusive}) within window at over ${currentOver} (awaiting qualifying 4/6 boundary sequence).`;
    }

    const signal: StrategySignal = {
      id: `${matchId}-${signalType}-${Date.now()}`,
      signalType,
      matchId,
      timestamp,
      currentInnings,
      currentOver,
      ballNumber,
      relevantOdds: {
        measuredTeam,
        teamInControl,
        decimalOdds: decimalOdds ?? Number((1 + currentPaise / 100).toFixed(2)),
        currentPaise,
      },
      ruleEvaluated,
      status,
      explanation,
      metadata: {
        inWindow,
        battingInControl,
        meets85,
        minPaiseInclusive,
        currentPaise,
      },
    };

    const historyDedupeKey = `${matchId}-${signalType}-${status}-${currentInnings}-${currentOver}-${ballNumber}-${teamInControl}-${currentPaise}`;
    if (!state.processedEventKeys.has(historyDedupeKey)) {
      state.processedEventKeys.add(historyDedupeKey);
      state.signalsHistory.unshift(signal);
      if (state.signalsHistory.length > 200) {
        state.signalsHistory.pop();
      }
    }

    state.lastUpdated = new Date();
    return signal;
  }

  /**
   * Evaluates Second Entry rule (Control-Only):
   * - Only after active First Entry (not yet exited).
   * - Confirmed wicket fell strictly after First Entry (no exit at wicket).
   * - control === 'BOWLING' and control_team_odds strictly < 65 paise (< 1.65 decimal).
   * - Allowed even after the over window once First Entry was opened inside the window.
   */
  public evaluateSecondEntry(params: {
    matchId: string;
    teamInControl: TeamControlState;
    controlTeamOdds: number | null; // control_team_odds in paise (e.g. 64)
    decimalOdds?: number | null;
    currentWickets: number;
    currentInnings: number;
    currentOver: number;
    ballNumber?: number;
    measuredTeam: string;
    timestamp?: Date;
  }): StrategySignal {
    const {
      matchId,
      teamInControl,
      controlTeamOdds,
      decimalOdds,
      currentWickets,
      currentInnings,
      currentOver,
      ballNumber = 0,
      measuredTeam,
      timestamp = new Date(),
    } = params;

    const state = this.getState(matchId);
    const signalType: SignalType = 'SECOND_ENTRY_CANDIDATE';
    const { maxBowlingPaiseExclusive, requiresConfirmedWicket } = this.config.secondEntry;
    const paise =
      controlTeamOdds !== null && controlTeamOdds !== undefined && !isNaN(controlTeamOdds)
        ? controlTeamOdds
        : decimalOddsToPaise(decimalOdds);
    const effectiveDecimal =
      decimalOdds ?? (paise !== null ? Number((1 + paise / 100).toFixed(2)) : null);

    const ruleEvaluated = `Second Entry: Requires active 1st entry, confirmed wicket after 1st entry, control = BOWLING and control_team_odds < ${maxBowlingPaiseExclusive} paise (allowed after over window)`;

    // Condition 1: Must have an active (un-exited) first entry
    const hasActiveFirstEntry =
      state.stage === 'ACTIVE_FIRST_ENTRY' ||
      (state.firstEntryPosition.status === 'RECORDED_ENTRY' &&
        state.stage !== 'FIRST_BOOKSET_COMPLETED' &&
        state.stage !== 'FULL_BOOKSET_COMPLETED');

    if (!hasActiveFirstEntry) {
      return {
        id: `${matchId}-${signalType}-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds: effectiveDecimal,
          currentPaise: paise,
        },
        ruleEvaluated,
        status: 'FAIL',
        explanation: 'Ineligible: Second entry requires an active prior first entry.',
        metadata: { hasActiveFirstEntry: false },
      };
    }

    // Condition 2: Confirmed wicket strictly after first entry
    const anchorWickets = state.firstEntryTrade?.entryWickets ?? state.firstEntryPosition.entryWickets ?? 0;
    const wicketConfirmed = currentWickets > anchorWickets;

    if (requiresConfirmedWicket && !wicketConfirmed) {
      return {
        id: `${matchId}-${signalType}-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds: effectiveDecimal,
          currentPaise: paise,
        },
        ruleEvaluated,
        status: 'FAIL',
        explanation: `Wicket requirement not satisfied: Requires confirmed wicket after first entry (Wickets at entry: ${anchorWickets}, Current wickets: ${currentWickets}).`,
        metadata: { anchorWickets, currentWickets, wicketConfirmed: false },
      };
    }

    // Condition 3: Bowling team must be in control (no over-window block once 1st entry is open)
    if (teamInControl !== 'BOWLING') {
      return {
        id: `${matchId}-${signalType}-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds: effectiveDecimal,
          currentPaise: paise,
        },
        ruleEvaluated,
        status: 'FAIL',
        explanation: `Waiting for BOWLING control: Current control is ${teamInControl} (requires BOWLING < ${maxBowlingPaiseExclusive} paise).`,
        metadata: { teamInControl, wicketConfirmed, anchorWickets, currentWickets },
      };
    }

    // Condition 5: Odds availability
    if (paise === null || isNaN(paise)) {
      return {
        id: `${matchId}-${signalType}-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds: null,
          currentPaise: null,
        },
        ruleEvaluated,
        status: 'DATA UNAVAILABLE',
        explanation: 'Bowling control odds are unavailable.',
      };
    }

    // Condition 6: Strictly below 65 paise
    const qualifies = paise < maxBowlingPaiseExclusive;
    const status: SignalStatus = qualifies ? 'PASS' : 'FAIL';
    const explanation = qualifies
      ? `Second-entry triggered: Bowling team in control at ${paise} paise (< ${maxBowlingPaiseExclusive} paise) after confirmed wicket (${currentWickets} > ${anchorWickets}).`
      : `Bowling control odds ${paise} paise are not below ${maxBowlingPaiseExclusive} paise (requires < ${maxBowlingPaiseExclusive} paise).`;

    const signal: StrategySignal = {
      id: `${matchId}-${signalType}-${Date.now()}`,
      signalType,
      matchId,
      timestamp,
      currentInnings,
      currentOver,
      ballNumber,
      relevantOdds: {
        measuredTeam,
        teamInControl,
        decimalOdds: effectiveDecimal,
        currentPaise: paise,
      },
      ruleEvaluated,
      status,
      explanation,
      metadata: {
        controlTeamOdds: paise,
        maxBowlingPaiseExclusive,
        wicketConfirmed,
        currentWickets,
        anchorWickets,
      },
    };

    const eventKey = `${matchId}-${signalType}-${currentInnings}-${currentOver}-${paise}`;
    if (status === 'PASS' && !state.processedEventKeys.has(eventKey)) {
      state.processedEventKeys.add(eventKey);
      state.candidates.unshift(signal);
      if (state.secondEntryPosition.status === 'NONE') {
        state.secondEntryPosition.status = 'CANDIDATE_DETECTED';
        state.secondEntryPosition.candidateSignalId = signal.id;
      }
    }

    const dedupeKey = `${matchId}-${signalType}-${status}-${currentInnings}-${currentOver}-${ballNumber}-${currentWickets}-${paise}`;
    if (!state.processedEventKeys.has(dedupeKey)) {
      state.processedEventKeys.add(dedupeKey);
      state.signalsHistory.unshift(signal);
      if (state.signalsHistory.length > 200) {
        state.signalsHistory.pop();
      }
    }

    state.lastUpdated = new Date();
    return signal;
  }

  /**
   * Evaluates Bookset (Exit) for BOTH First Entry and Second Entry:
   * - control === 'BOWLING' and control_team_odds strictly > 85 paise (> 1.85 decimal).
   * - Monitored continuously even after the entry over window closes.
   */
  public evaluateBooksetExit(params: {
    matchId: string;
    teamInControl: TeamControlState;
    controlTeamOdds: number | null; // control_team_odds in paise (e.g. 86)
    decimalOdds?: number | null;
    currentInnings: number;
    currentOver: number;
    ballNumber?: number;
    measuredTeam: string;
    signalType?: 'FIRST_BOOKSET_TARGET' | 'SECOND_BOOKSET_TARGET' | 'FULL_BOOKSET_TARGET';
    timestamp?: Date;
    auditTelemetry?: SignalAuditTelemetry;
  }): StrategySignal {
    const {
      matchId,
      teamInControl,
      controlTeamOdds,
      decimalOdds,
      currentInnings,
      currentOver,
      ballNumber = 0,
      measuredTeam,
      signalType = 'SECOND_BOOKSET_TARGET',
      timestamp = new Date(),
      auditTelemetry,
    } = params;

    const state = this.getState(matchId);
    const { minBowlingPaiseExclusive } = this.config.bookset;
    const paise =
      controlTeamOdds !== null && controlTeamOdds !== undefined && !isNaN(controlTeamOdds)
        ? controlTeamOdds
        : decimalOddsToPaise(decimalOdds);
    const effectiveDecimal =
      decimalOdds ?? (paise !== null ? Number((1 + paise / 100).toFixed(2)) : null);

    const ruleEvaluated = `Bookset Exit: control = BOWLING and control_team_odds > ${minBowlingPaiseExclusive} paise`;

    if (teamInControl !== 'BOWLING') {
      return {
        id: `${matchId}-${signalType}-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds: effectiveDecimal,
          currentPaise: paise,
        },
        ruleEvaluated,
        status: 'FAIL',
        explanation: `Bookset waiting: Control is ${teamInControl} (requires BOWLING > ${minBowlingPaiseExclusive} paise).`,
        metadata: auditTelemetry
          ? buildAuditMetadata(auditTelemetry, { teamInControl, minBowlingPaiseExclusive, qualifies: false })
          : { teamInControl, minBowlingPaiseExclusive, qualifies: false },
      };
    }

    if (paise === null || isNaN(paise)) {
      return {
        id: `${matchId}-${signalType}-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds: null,
          currentPaise: null,
        },
        ruleEvaluated,
        status: 'DATA UNAVAILABLE',
        explanation: 'Bowling control odds are unavailable for bookset evaluation.',
      };
    }

    const qualifies = paise > minBowlingPaiseExclusive;
    const status: SignalStatus = qualifies ? 'PASS' : 'FAIL';
    const baseExplanation = qualifies
      ? `Bookset target reached: Bowling team in control at ${paise} paise (> ${minBowlingPaiseExclusive} paise). Closing open position(s).`
      : `Bookset not reached: Bowling control odds ${paise} paise are not above ${minBowlingPaiseExclusive} paise (requires > ${minBowlingPaiseExclusive} paise).`;
    const explanation =
      qualifies && auditTelemetry
        ? `${baseExplanation}${formatAuditTelemetrySuffix(auditTelemetry)}`
        : baseExplanation;

    const signal: StrategySignal = {
      id: `${matchId}-${signalType}-${Date.now()}`,
      signalType,
      matchId,
      timestamp,
      currentInnings,
      currentOver,
      ballNumber,
      relevantOdds: {
        measuredTeam,
        teamInControl,
        decimalOdds: effectiveDecimal,
        currentPaise: paise,
        rawF: auditTelemetry?.rawF,
        controlTeamKey: auditTelemetry?.controlTeamKey ?? undefined,
        oddsFetchedAt: auditTelemetry?.odds_fetched_at,
        scoreFetchedAt: auditTelemetry?.score_fetched_at,
      },
      ruleEvaluated,
      status,
      explanation,
      metadata: auditTelemetry
        ? buildAuditMetadata(auditTelemetry, {
            controlTeamOdds: paise,
            minBowlingPaiseExclusive,
            qualifies,
          })
        : {
            controlTeamOdds: paise,
            minBowlingPaiseExclusive,
            qualifies,
          },
    };

    const booksetDedupeKey = `${matchId}-${signalType}-${status}-${currentInnings}-${currentOver}-${ballNumber}-${paise}`;
    if (status === 'PASS') {
      if (state.secondEntryPosition.status === 'RECORDED_ENTRY') {
        state.secondEntryPosition.status = 'EXIT_CANDIDATE_DETECTED';
        state.secondEntryPosition.booksetSignalId = signal.id;
      } else if (state.firstEntryPosition.status === 'RECORDED_ENTRY') {
        state.firstEntryPosition.status = 'EXIT_CANDIDATE_DETECTED';
        state.firstEntryPosition.booksetSignalId = signal.id;
      }
    }

    if (!state.processedEventKeys.has(booksetDedupeKey)) {
      state.processedEventKeys.add(booksetDedupeKey);
      state.signalsHistory.unshift(signal);
      if (state.signalsHistory.length > 200) {
        state.signalsHistory.pop();
      }
    }

    state.lastUpdated = new Date();
    return signal;
  }

  public evaluateFirstBookset(params: {
    matchId: string;
    teamInControl: TeamControlState;
    controlTeamOdds: number | null;
    decimalOdds?: number | null;
    currentInnings: number;
    currentOver: number;
    ballNumber?: number;
    measuredTeam: string;
    timestamp?: Date;
    auditTelemetry?: SignalAuditTelemetry;
  }): StrategySignal {
    return this.evaluateBooksetExit({ ...params, signalType: 'FIRST_BOOKSET_TARGET' });
  }

  public evaluateSecondBookset(params: {
    matchId: string;
    teamInControl: TeamControlState;
    controlTeamOdds: number | null;
    decimalOdds?: number | null;
    currentInnings: number;
    currentOver: number;
    ballNumber?: number;
    measuredTeam: string;
    timestamp?: Date;
    auditTelemetry?: SignalAuditTelemetry;
  }): StrategySignal {
    return this.evaluateBooksetExit({ ...params, signalType: 'SECOND_BOOKSET_TARGET' });
  }

  /**
   * Evaluates FIRST_EXIT_BELOW_55 rule:
   * - While no wicket has fallen since the first entry (currentWickets === anchorWickets)
   *   and second entry has not been taken:
   *   exit the first entry when control === 'BATTING' and control_team_odds <= 55 (55 exits, 56 does not).
   * - After any wicket falls after first entry (currentWickets > anchorWickets), stops applying permanently.
   */
  public evaluateFirstExitBelow55(params: {
    matchId: string;
    teamInControl: TeamControlState;
    controlTeamOdds: number | null;
    decimalOdds?: number | null;
    currentWickets: number;
    currentInnings: number;
    currentOver: number;
    ballNumber?: number;
    measuredTeam: string;
    timestamp?: Date;
    auditTelemetry?: SignalAuditTelemetry;
  }): StrategySignal {
    const {
      matchId,
      teamInControl,
      controlTeamOdds,
      decimalOdds,
      currentWickets,
      currentInnings,
      currentOver,
      ballNumber = 0,
      measuredTeam,
      timestamp = new Date(),
      auditTelemetry,
    } = params;

    const state = this.getState(matchId);
    const signalType: SignalType = 'FIRST_EXIT_BELOW_55';
    const { maxBattingPaiseInclusive } = this.config.firstExitBelow55;
    const paise =
      controlTeamOdds !== null && controlTeamOdds !== undefined && !isNaN(controlTeamOdds)
        ? controlTeamOdds
        : decimalOddsToPaise(decimalOdds);
    const effectiveDecimal =
      decimalOdds ?? (paise !== null ? Number((1 + paise / 100).toFixed(2)) : null);

    const ruleEvaluated = `FIRST_EXIT_BELOW_55: No wicket since 1st entry + BATTING control_team_odds <= ${maxBattingPaiseInclusive} paise`;

    const hasActiveFirstOnly =
      state.stage === 'ACTIVE_FIRST_ENTRY' &&
      state.secondEntryTrade === null &&
      state.secondEntryPosition.status !== 'RECORDED_ENTRY';

    if (!hasActiveFirstOnly) {
      return {
        id: `${matchId}-${signalType}-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds: effectiveDecimal,
          currentPaise: paise,
        },
        ruleEvaluated,
        status: 'FAIL',
        explanation: 'FIRST_EXIT_BELOW_55 inactive: First entry is not solely active.',
      };
    }

    const anchorWickets = state.firstEntryTrade?.entryWickets ?? state.firstEntryPosition.entryWickets ?? 0;
    if (currentWickets > anchorWickets) {
      return {
        id: `${matchId}-${signalType}-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds: effectiveDecimal,
          currentPaise: paise,
        },
        ruleEvaluated,
        status: 'FAIL',
        explanation: `FIRST_EXIT_BELOW_55 stopped: Wicket fell after 1st entry (${currentWickets} > ${anchorWickets}). Holding for BOWLING > ${this.config.bookset.minBowlingPaiseExclusive}p bookset.`,
        metadata: { stoppedAfterWicket: true, anchorWickets, currentWickets },
      };
    }

    if (teamInControl !== 'BATTING') {
      return {
        id: `${matchId}-${signalType}-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds: effectiveDecimal,
          currentPaise: paise,
        },
        ruleEvaluated,
        status: 'FAIL',
        explanation: `FIRST_EXIT_BELOW_55 waiting: Control is ${teamInControl} (requires BATTING <= ${maxBattingPaiseInclusive}p).`,
      };
    }

    if (paise === null || isNaN(paise)) {
      return {
        id: `${matchId}-${signalType}-${Date.now()}`,
        signalType,
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          teamInControl,
          decimalOdds: null,
          currentPaise: null,
        },
        ruleEvaluated,
        status: 'DATA UNAVAILABLE',
        explanation: 'Batting control odds unavailable for FIRST_EXIT_BELOW_55 evaluation.',
      };
    }

    const qualifies = paise <= maxBattingPaiseInclusive;
    const status: SignalStatus = qualifies ? 'PASS' : 'FAIL';
    const baseExplanation = qualifies
      ? `FIRST_EXIT_BELOW_55 triggered: No wicket since 1st entry and BATTING control_team_odds dropped to ${paise} paise (<= ${maxBattingPaiseInclusive}p). Closing 1st entry.`
      : `FIRST_EXIT_BELOW_55 holding: BATTING control_team_odds at ${paise} paise (> ${maxBattingPaiseInclusive}p).`;
    const explanation =
      qualifies && auditTelemetry
        ? `${baseExplanation}${formatAuditTelemetrySuffix(auditTelemetry)}`
        : baseExplanation;

    const signal: StrategySignal = {
      id: `${matchId}-${signalType}-${Date.now()}`,
      signalType,
      matchId,
      timestamp,
      currentInnings,
      currentOver,
      ballNumber,
      relevantOdds: {
        measuredTeam,
        teamInControl,
        decimalOdds: effectiveDecimal,
        currentPaise: paise,
        rawF: auditTelemetry?.rawF,
        controlTeamKey: auditTelemetry?.controlTeamKey ?? undefined,
        oddsFetchedAt: auditTelemetry?.odds_fetched_at,
        scoreFetchedAt: auditTelemetry?.score_fetched_at,
      },
      ruleEvaluated,
      status,
      explanation,
      metadata: auditTelemetry
        ? buildAuditMetadata(auditTelemetry, {
            controlTeamOdds: paise,
            maxBattingPaiseInclusive,
            anchorWickets,
            currentWickets,
            qualifies,
          })
        : {
            controlTeamOdds: paise,
            maxBattingPaiseInclusive,
            anchorWickets,
            currentWickets,
            qualifies,
          },
    };

    if (qualifies && state.firstEntryPosition.status === 'RECORDED_ENTRY') {
      state.firstEntryPosition.status = 'EXIT_CANDIDATE_DETECTED';
      state.firstEntryPosition.booksetSignalId = signal.id;
    }

    const exitDedupeKey = `${matchId}-${signalType}-${status}-${currentInnings}-${currentOver}-${ballNumber}-${paise}`;
    if (!state.processedEventKeys.has(exitDedupeKey)) {
      state.processedEventKeys.add(exitDedupeKey);
      state.signalsHistory.unshift(signal);
      if (state.signalsHistory.length > 200) {
        state.signalsHistory.pop();
      }
    }

    state.lastUpdated = new Date();
    return signal;
  }

  /**
   * Main 1-second strategy loop: Evaluates live match state, pre-ball boundary shifts,
   * immediate & deferred 1st entries, FIRST_EXIT_BELOW_55, 2nd entry triggers, and unified bookset exits.
   */
  public evaluateMatch(
    match: ParsedCricketMatch,
    oddsState: MatchOddsState,
    boundaryEvent?: { type: 'FOUR' | 'SIX'; oddsMovement: number },
    options?: {
      isStale?: boolean;
      now?: Date | number;
      scoreFetchedAt?: Date | string | null;
      scoreChangedAt?: Date | string | null;
      oddsFetchedAt?: Date | string | null;
      oddsSource?: 'getSV3' | 'flb' | 'none';
      sameGetSV3ScorePacket?: boolean;
    }
  ): StrategySignal[] {
    const eligibility = this.checkFormatEligibility(match);
    if (!eligibility.allowed) {
      return [];
    }

    const signals: StrategySignal[] = [];
    const matchId = match.id;
    const state = this.getState(matchId);

    const toMs = (val: Date | string | number | null | undefined): number | null => {
      if (val === null || val === undefined) return null;
      if (typeof val === 'number') return isFinite(val) ? val : null;
      if (val instanceof Date) return isNaN(val.getTime()) ? null : val.getTime();
      const parsed = new Date(val).getTime();
      return isNaN(parsed) ? null : parsed;
    };

    const nowMs = toMs(options?.now) ?? Date.now();
    const nowDate = new Date(nowMs);
    const currScoreFetchedAtMs = toMs(options?.scoreFetchedAt);
    const currScoreChangedAtMs = toMs(options?.scoreChangedAt) ?? currScoreFetchedAtMs;
    const currOddsFetchedAtMs = toMs(
      options?.oddsFetchedAt !== undefined
        ? options.oddsFetchedAt
        : oddsState?.oddsFetchedAt ?? oddsState?.odds?.timestamp
    );
    const effectiveOddsSource: 'getSV3' | 'flb' | 'none' =
      options?.oddsSource ?? oddsState?.oddsSource ?? (oddsState?.odds ? 'getSV3' : 'none');
    const isFromGetSV3 = effectiveOddsSource === 'getSV3' && Boolean(oddsState?.odds);

    const activeScore = match.team2Score || match.team1Score;
    const currentInnings = match.team2Score ? 2 : 1;
    const currentOver = activeScore ? activeScore.overs : 0;
    const currentBalls = activeScore ? activeScore.ballsInOver : 0;
    const currentLegalBalls = getLegalBallCount(activeScore);
    const currentRuns = activeScore ? activeScore.runs : 0;
    const currentWickets = activeScore ? activeScore.wickets : 0;

    // Detect active control and Crex raw control_team_odds strictly from getSV3 (never flb / winProbability / substring)
    const rawControlInfo = detectTeamInControl(match, isFromGetSV3 ? oddsState : null);
    const currControl: TeamControlState = isFromGetSV3 ? rawControlInfo.teamInControl : 'UNKNOWN';
    const currentPaise: number | null = isFromGetSV3 ? rawControlInfo.currentPaise : null;
    const decimalOdds: number | null = isFromGetSV3
      ? rawControlInfo.decimalOdds ??
        (currentPaise !== null ? Number((1 + currentPaise / 100).toFixed(2)) : null)
      : null;
    const controlInfo = {
      ...rawControlInfo,
      teamInControl: currControl,
      currentPaise,
      decimalOdds,
    };
    const measuredTeam =
      controlInfo.controlTeamName ||
      (currControl === 'BATTING' ? controlInfo.battingTeamName : controlInfo.bowlingTeamName);

    const scoreFetchedAtIso =
      currScoreFetchedAtMs !== null
        ? new Date(currScoreFetchedAtMs).toISOString()
        : state.lastScoreUpdatedAtMs
        ? new Date(state.lastScoreUpdatedAtMs).toISOString()
        : null;
    const oddsFetchedAtIso =
      isFromGetSV3 && currOddsFetchedAtMs !== null
        ? new Date(currOddsFetchedAtMs).toISOString()
        : null;

    const buildStepTelemetry = (overrides?: Partial<SignalAuditTelemetry>): SignalAuditTelemetry => {
      const controlBefore = overrides?.control_before ?? state.preBallControl ?? state.lastEvaluatedControl ?? 'UNKNOWN';
      const oddsBefore = overrides?.odds_before ?? state.preBallPaise ?? state.lastEvaluatedPaise ?? null;
      return {
        innings: overrides?.innings ?? currentInnings,
        over: overrides?.over ?? currentOver,
        legal_ball_count: overrides?.legal_ball_count ?? currentLegalBalls,
        battingTeamKey: overrides?.battingTeamKey ?? controlInfo.battingTeamKey,
        bowlingTeamKey: overrides?.bowlingTeamKey ?? controlInfo.bowlingTeamKey,
        'raw.F': overrides?.['raw.F'] !== undefined ? overrides['raw.F'] : controlInfo.rawF,
        rawF: overrides?.rawF !== undefined ? overrides.rawF : controlInfo.rawF,
        controlTeamKey:
          overrides?.controlTeamKey !== undefined
            ? overrides.controlTeamKey
            : controlInfo.controlTeamKey ?? null,
        control_before: controlBefore,
        control_after: overrides?.control_after ?? currControl,
        odds_before: oddsBefore,
        odds_after: overrides?.odds_after !== undefined ? overrides.odds_after : currentPaise,
        move: overrides?.move !== undefined ? overrides.move : null,
        odds_fetched_at:
          overrides?.odds_fetched_at !== undefined ? overrides.odds_fetched_at : oddsFetchedAtIso,
        score_fetched_at:
          overrides?.score_fetched_at !== undefined ? overrides.score_fetched_at : scoreFetchedAtIso,
      };
    };

    state.teamInControl = currControl;
    state.battingTeamKey = controlInfo.battingTeamKey;
    state.bowlingTeamKey = controlInfo.bowlingTeamKey;

    const matchTitle = match.matchTitlePrefix
      ? `${match.team1.shortName} vs ${match.team2.shortName}`
      : `${match.team1.name || match.team1.shortName} vs ${match.team2.name || match.team2.shortName}`;

    const hasAnyEntry =
      state.stage === 'ACTIVE_FIRST_ENTRY' ||
      state.stage === 'ACTIVE_SECOND_ENTRY' ||
      state.stage === 'FIRST_BOOKSET_COMPLETED' ||
      state.stage === 'FULL_BOOKSET_COMPLETED' ||
      state.firstEntryPosition.status === 'RECORDED_ENTRY' ||
      state.firstEntryPosition.status === 'RECORDED_EXIT' ||
      state.firstEntryTrade !== null;

    const isFirstTick = (state.lastEvaluatedInnings ?? 0) === 0;
    const inningsChanged = !isFirstTick && state.lastEvaluatedInnings !== currentInnings;
    const sameInnings = !isFirstTick && state.lastEvaluatedInnings === currentInnings;

    // 0. Handle 1st -> 2nd innings transition: NEVER carry preBall* / lastEvaluated* / pendingBoundaryBall across innings
    if (inningsChanged) {
      state.pendingBoundaryBall = null;
      state.preBallControl = 'UNKNOWN';
      state.preBallPaise = null;
      state.lastEvaluatedOver = 0;
      state.lastEvaluatedWickets = 0;
      state.lastEvaluatedRuns = 0;
      state.lastEvaluatedBalls = 0;
      state.lastEvaluatedLegalBalls = 0;
      state.lastEvaluatedOdds = null;
      state.lastEvaluatedPaise = null;
      state.lastEvaluatedControl = 'UNKNOWN';
      state.lastScoreUpdatedAtMs = null;
      state.lastOddsFetchedAtMs = null;
      if (!hasAnyEntry) {
        state.stage = 'WAITING_FOR_CONFIRMATION';
        state.bookingTeamName = null;
        state.bookingTeamKey = null;
        state.bookingConfirmedBoundary = null;
        state.entryConfirmedBoundary = null;
        state.pending85 = false;
      }
    }

    // Helper to persist tick anchors safely (never overwrite valid odds/control with UNKNOWN/null)
    const updateTickAnchors = () => {
      state.lastEvaluatedInnings = currentInnings;
      state.lastEvaluatedWickets = currentWickets;
      state.lastEvaluatedOver = currentOver;
      state.lastEvaluatedRuns = currentRuns;
      state.lastEvaluatedBalls = currentBalls;
      state.lastEvaluatedLegalBalls = currentLegalBalls;
      if (isFromGetSV3 && currControl !== 'UNKNOWN' && currentPaise !== null) {
        state.lastEvaluatedOdds = decimalOdds;
        state.lastEvaluatedPaise = currentPaise;
        state.lastEvaluatedControl = currControl;
        if (currOddsFetchedAtMs !== null) {
          state.lastOddsFetchedAtMs = currOddsFetchedAtMs;
        }
      }
      state.lastUpdated = nowDate;
    };

    // 0A. Pre-entry Wicket Safety Filter (>= 3 wickets before entry in either innings skips the match)
    if (!hasAnyEntry && currentWickets >= this.config.wicketFilter.maxAllowedWicketsBeforeEntry) {
      state.pending85 = false;
      state.pendingBoundaryBall = null;
      if (state.stage !== 'DISQUALIFIED_3_WICKETS') {
        state.stage = 'DISQUALIFIED_3_WICKETS';
        const skipSignal: StrategySignal = {
          id: `${matchId}-DISQUALIFIED_WICKET_LIMIT-${nowMs}`,
          signalType: 'DISQUALIFIED_WICKET_LIMIT',
          matchId,
          timestamp: nowDate,
          currentInnings,
          currentOver,
          ballNumber: currentBalls,
          relevantOdds: {
            measuredTeam,
            decimalOdds,
            currentPaise,
            teamInControl: currControl,
          },
          ruleEvaluated: `Wicket Safety: Skip match if >= ${this.config.wicketFilter.maxAllowedWicketsBeforeEntry} wickets before entry`,
          status: 'FAIL',
          explanation: `MATCH SKIPPED: ${currentWickets} wickets have fallen before any entry.`,
        };
        state.signalsHistory.unshift(skipSignal);
        signals.push(skipSignal);
      }
      updateTickAnchors();
      return signals;
    }

    // 0B. Pre-entry Over Window Filter (1st Inn < 10.0 ov, 2nd Inn < 6.0 ov)
    if (!hasAnyEntry && !isWithinEntryWindow(currentInnings, currentOver, this.config)) {
      state.pending85 = false;
      state.pendingBoundaryBall = null;
      if (state.stage !== 'WINDOW_EXPIRED' && state.stage !== 'DISQUALIFIED_3_WICKETS') {
        state.stage = 'WINDOW_EXPIRED';
        const expiredKey = `${matchId}-WINDOW_EXPIRED-Inn${currentInnings}`;
        if (!state.processedEventKeys.has(expiredKey)) {
          state.processedEventKeys.add(expiredKey);
          const expiredSignal: StrategySignal = {
            id: `${matchId}-WINDOW_EXPIRED-${nowMs}`,
            signalType: 'FIRST_ENTRY_CANDIDATE',
            matchId,
            timestamp: nowDate,
            currentInnings,
            currentOver,
            ballNumber: currentBalls,
            relevantOdds: {
              measuredTeam,
              decimalOdds,
              currentPaise,
              teamInControl: currControl,
            },
            ruleEvaluated: `Over Limit: Inn 1 < ${this.config.entryWindows.firstInningsMaxOver} ov, Inn 2 < ${this.config.entryWindows.secondInningsMaxOver} ov`,
            status: 'FAIL',
            explanation: `MATCH SKIPPED (OVER LIMIT): Innings ${currentInnings} reached ${currentOver} ov without entry.`,
          };
          state.signalsHistory.unshift(expiredSignal);
          signals.push(expiredSignal);
        }
      }
      updateTickAnchors();
      return signals;
    }

    // 1. Wicket Tracking Event (tracks 0->1, 1->2, etc.; NEVER exits on a wicket)
    if (sameInnings && currentWickets > state.lastEvaluatedWickets) {
      const prevWickets = state.lastEvaluatedWickets;
      const wicketKey = `${matchId}-WICKET_EVENT-${currentInnings}-${currentOver}.${currentBalls}-${currentWickets}`;
      if (!state.processedEventKeys.has(wicketKey)) {
        state.processedEventKeys.add(wicketKey);
        const wicketSignal: StrategySignal = {
          id: `${matchId}-WICKET_EVENT-${nowMs}`,
          signalType: 'WICKET_EVENT',
          matchId,
          timestamp: nowDate,
          currentInnings,
          currentOver,
          ballNumber: currentBalls,
          relevantOdds: {
            measuredTeam,
            decimalOdds,
            currentPaise,
            teamInControl: currControl,
            isStale: options?.isStale,
          },
          ruleEvaluated: 'Confirmed Wicket Event (Do NOT exit at wicket)',
          status: 'PASS',
          explanation: `Confirmed wicket: Wickets increased from ${prevWickets} to ${currentWickets} at over ${currentOver}. Holding any open entry.`,
          metadata: { previousWickets: prevWickets, currentWickets },
        };
        state.signalsHistory.unshift(wicketSignal);
        signals.push(wicketSignal);
      }
    }

    // 2. Boundary Detection, Pre-Ball Snapshot Preservation & Strict Fresh getSV3 Pairing
    let activeBoundaryType: 'FOUR' | 'SIX' | null = boundaryEvent ? boundaryEvent.type : null;
    let boundaryMoveDeltaOverride: number | undefined = boundaryEvent?.oddsMovement;

    if (sameInnings) {
      const prevLegalBalls = state.lastEvaluatedLegalBalls ?? 0;
      const ballProgressed = currentLegalBalls !== prevLegalBalls || currentRuns > state.lastEvaluatedRuns;

      // Helper to determine whether current getSV3 odds snapshot is strictly fresh relative to the boundary ball
      const checkFreshGetSV3ForBoundary = (
        boundaryScoreTickMs: number,
        preBallOddsFetchedMs: number | null | undefined,
        isInitialScoreTick: boolean
      ): boolean => {
        if (!isFromGetSV3 || currControl === 'UNKNOWN' || currentPaise === null) {
          return false;
        }
        const timestampsTracked =
          currScoreChangedAtMs !== null ||
          currOddsFetchedAtMs !== null ||
          (preBallOddsFetchedMs !== null && preBallOddsFetchedMs !== undefined);

        if (timestampsTracked) {
          if (currOddsFetchedAtMs === null) return false;
          if (currOddsFetchedAtMs > boundaryScoreTickMs) {
            return true;
          }
          // Special case: server getSV3 endpoint delivered BOTH the boundary score and new odds in the exact same HTTP packet
          if (
            isInitialScoreTick &&
            options?.sameGetSV3ScorePacket === true &&
            currOddsFetchedAtMs >= boundaryScoreTickMs &&
            (preBallOddsFetchedMs === null ||
              preBallOddsFetchedMs === undefined ||
              currOddsFetchedAtMs > preBallOddsFetchedMs)
          ) {
            return true;
          }
          return false;
        }

        // Fallback for synchronous unit tests without explicit timestamps:
        // Wait only if odds remained identical to pre-ball snapshot on the score-update tick
        const unchangedFromPreBall =
          state.preBallPaise !== null &&
          state.preBallPaise !== undefined &&
          state.preBallControl !== undefined &&
          state.preBallControl !== 'UNKNOWN' &&
          currControl === state.preBallControl &&
          currentPaise === state.preBallPaise;
        return !unchangedFromPreBall;
      };

      // Check 5-second expiration on any existing pendingBoundaryBall BEFORE evaluating or replacing it
      if (state.pendingBoundaryBall) {
        const p = state.pendingBoundaryBall;
        const elapsedMs = nowMs - (p.detectedAtMs ?? nowMs);
        const canResolveThisTick =
          !ballProgressed &&
          p.innings === currentInnings &&
          p.legalBalls === currentLegalBalls &&
          checkFreshGetSV3ForBoundary(p.scoreUpdatedAtMs ?? p.detectedAtMs ?? nowMs, p.preBallOddsFetchedAtMs, false);

        if (!canResolveThisTick && elapsedMs > 5000) {
          const skipTelemetry = buildStepTelemetry({
            rawF: controlInfo.rawF ?? p.rawF ?? null,
            'raw.F': controlInfo.rawF ?? p.rawF ?? null,
            odds_fetched_at: oddsFetchedAtIso,
            score_fetched_at: p.scoreUpdatedAtMs
              ? new Date(p.scoreUpdatedAtMs).toISOString()
              : scoreFetchedAtIso,
          });
          const skipKey = `${matchId}-BOUNDARY_SKIPPED_NO_FRESH_ODDS-${p.innings}-${p.legalBalls}`;
          if (!state.processedEventKeys.has(skipKey)) {
            state.processedEventKeys.add(skipKey);
            const skippedSignal: StrategySignal = {
              id: `${matchId}-BOUNDARY_SKIPPED_NO_FRESH_ODDS-${nowMs}`,
              signalType: 'BOUNDARY_SKIPPED_NO_FRESH_ODDS',
              matchId,
              timestamp: nowDate,
              currentInnings,
              currentOver,
              ballNumber: currentBalls,
              relevantOdds: {
                measuredTeam,
                teamInControl: currControl,
                decimalOdds,
                currentPaise,
                rawF: skipTelemetry.rawF,
                controlTeamKey: skipTelemetry.controlTeamKey ?? undefined,
                oddsFetchedAt: skipTelemetry.odds_fetched_at,
                scoreFetchedAt: skipTelemetry.score_fetched_at,
              },
              ruleEvaluated: `Fresh getSV3 Odds Pairing: Requires getSV3 control+odds fetched after boundary score update within 5s`,
              status: 'FAIL',
              explanation:
                `BOUNDARY DROPPED (NO FRESH GETSV3 ODDS IN 5s): ${p.type} at Inn ${currentInnings}, over ${currentOver} (legal_ball_count=${p.legalBalls}) timed out after ${elapsedMs}ms without a fresh post-score getSV3 snapshot.` +
                formatAuditTelemetrySuffix(skipTelemetry),
              metadata: buildAuditMetadata(skipTelemetry, {
                boundaryType: p.type,
                boundaryLegalBalls: p.legalBalls,
                detectedAt: p.detectedAtMs ? new Date(p.detectedAtMs).toISOString() : null,
                expiredAt: nowDate.toISOString(),
                elapsedMs,
                reason: 'NO_FRESH_GETSV3_SNAPSHOT_WITHIN_5S',
              }),
            };
            state.signalsHistory.unshift(skippedSignal);
            signals.push(skippedSignal);
          }
          state.pendingBoundaryBall = null;
        }
      }

      if (ballProgressed) {
        // Snapshot the last valid tick BEFORE this new ball started
        state.preBallControl = state.lastEvaluatedControl;
        state.preBallPaise = state.lastEvaluatedPaise;
        const preBallOddsFetchedMs = state.lastOddsFetchedAtMs ?? null;
        const scoreUpdateMs = currScoreChangedAtMs ?? nowMs;
        state.lastScoreUpdatedAtMs = scoreUpdateMs;
        state.pendingBoundaryBall = null;

        if (!activeBoundaryType) {
          const runsDelta = currentRuns - state.lastEvaluatedRuns;
          if (runsDelta === 4) activeBoundaryType = 'FOUR';
          else if (runsDelta === 6) activeBoundaryType = 'SIX';
        }

        if (activeBoundaryType && !boundaryEvent) {
          const isFresh = checkFreshGetSV3ForBoundary(scoreUpdateMs, preBallOddsFetchedMs, true);
          if (!isFresh) {
            // Keep boundary pending up to 5 seconds until a fresh post-score getSV3 snapshot arrives
            state.pendingBoundaryBall = {
              innings: currentInnings,
              legalBalls: currentLegalBalls,
              type: activeBoundaryType,
              detectedAtMs: nowMs,
              scoreUpdatedAtMs: scoreUpdateMs,
              preBallOddsFetchedAtMs: preBallOddsFetchedMs,
              rawF: controlInfo.rawF,
            };
            activeBoundaryType = null;
          }
        }
      } else if (
        !activeBoundaryType &&
        state.pendingBoundaryBall &&
        state.pendingBoundaryBall.innings === currentInnings &&
        state.pendingBoundaryBall.legalBalls === currentLegalBalls
      ) {
        const pending = state.pendingBoundaryBall;
        const isFresh = checkFreshGetSV3ForBoundary(
          pending.scoreUpdatedAtMs ?? pending.detectedAtMs ?? nowMs,
          pending.preBallOddsFetchedAtMs,
          false
        );

        if (isFresh) {
          // Fresh getSV3 snapshot arrived within <= 5s after the score update on this boundary ball!
          activeBoundaryType = pending.type;
          state.pendingBoundaryBall = null;
        }
      }
    }

    const minPaiseInclusive = this.config.firstEntry.minPaiseInclusive; // 85 (>= 85 required)
    const withinWindow = isWithinEntryWindow(currentInnings, currentOver, this.config);
    const controlKeyMatchesBatting =
      currControl === 'BATTING' &&
      Boolean(controlInfo.controlTeamKey) &&
      Boolean(controlInfo.battingTeamKey) &&
      normalizeTeamKey(controlInfo.controlTeamKey) === normalizeTeamKey(controlInfo.battingTeamKey);

    // 3. Evaluate Boundary Rules: Booking Team Confirmation & Entry Confirmation / Immediate First Entry
    if (activeBoundaryType && isFromGetSV3 && currentPaise !== null && currControl !== 'UNKNOWN') {
      state.pendingBoundaryBall = null;

      const prevControl =
        state.preBallControl && state.preBallControl !== 'UNKNOWN'
          ? state.preBallControl
          : state.lastEvaluatedControl;
      const prevPaise = state.preBallPaise ?? state.lastEvaluatedPaise;

      const paiseCalc =
        prevPaise !== null && prevControl !== 'UNKNOWN'
          ? calculatePaiseChange(prevControl, prevPaise, currControl, currentPaise)
          : boundaryMoveDeltaOverride !== undefined
          ? {
              delta: currControl === 'BATTING' && controlKeyMatchesBatting ? boundaryMoveDeltaOverride : 0,
              formula:
                currControl === 'BATTING' && controlKeyMatchesBatting
                  ? `Boundary move: ${boundaryMoveDeltaOverride} paise`
                  : 'Batting team is not in control after the ball',
              qualifiesBattingControl:
                currControl === 'BATTING' && controlKeyMatchesBatting && boundaryMoveDeltaOverride > 0,
            }
          : {
              delta: 0,
              formula: 'No prior tick odds before boundary ball',
              qualifiesBattingControl: currControl === 'BATTING' && controlKeyMatchesBatting,
            };

      const boundaryTelemetry = buildStepTelemetry({
        control_before: prevControl,
        control_after: currControl,
        odds_before: prevPaise,
        odds_after: currentPaise,
        move: paiseCalc.delta,
      });

      const abnormalSignal = this.evaluateAbnormalActivity({
        matchId,
        boundaryType: activeBoundaryType,
        oddsMovement: paiseCalc.delta,
        currentInnings,
        currentOver,
        ballNumber: currentBalls,
        measuredTeam,
        decimalOdds,
        previousDecimalOdds: oddsState?.previousOdds?.bookmaker?.decimalBack ?? null,
        teamInControl: controlKeyMatchesBatting ? currControl : 'UNKNOWN',
        customFormulaExplanation: paiseCalc.formula,
        timestamp: nowDate,
      });
      signals.push(abnormalSignal);

      const battingAtOrAbove85 = controlKeyMatchesBatting && currentPaise >= minPaiseInclusive;

      // 3A. Booking Team Confirmation: control = BATTING, controlTeamKey === battingTeamKey, control_team_odds >= 85, move >= 11 (4) / >= 18 (6)
      if (
        state.stage === 'WAITING_FOR_CONFIRMATION' &&
        abnormalSignal.status === 'PASS' &&
        battingAtOrAbove85 &&
        withinWindow
      ) {
        state.stage = 'CONFIRMED_BOOKING_TEAM';
        state.bookingTeamName = controlInfo.battingTeamName;
        state.bookingTeamKey = controlInfo.battingTeamKey;
        state.bookingConfirmedBoundary = {
          type: activeBoundaryType,
          over: currentOver,
          ball: currentBalls,
          paiseDelta: paiseCalc.delta,
          timestamp: nowDate,
        };

        const confirmKey = `${matchId}-BOOKING_TEAM_CONFIRMED-${currentInnings}-${currentOver}.${currentBalls}`;
        if (!state.processedEventKeys.has(confirmKey)) {
          state.processedEventKeys.add(confirmKey);
          const confirmSignal: StrategySignal = {
            id: `${matchId}-BOOKING_TEAM_CONFIRMED-${nowMs}`,
            signalType: 'BOOKING_TEAM_CONFIRMED',
            matchId,
            timestamp: nowDate,
            currentInnings,
            currentOver,
            ballNumber: currentBalls,
            relevantOdds: {
              measuredTeam: controlInfo.battingTeamName,
              teamInControl: 'BATTING',
              decimalOdds,
              currentPaise,
              calculatedDelta: paiseCalc.delta,
              rawF: boundaryTelemetry.rawF,
              controlTeamKey: boundaryTelemetry.controlTeamKey ?? undefined,
              oddsFetchedAt: boundaryTelemetry.odds_fetched_at,
              scoreFetchedAt: boundaryTelemetry.score_fetched_at,
            },
            ruleEvaluated: `Booking Team Confirmation: BATTING control (controlTeamKey === battingTeamKey), odds >= ${minPaiseInclusive}p, 4 (>= 11p) / 6 (>= 18p)`,
            status: 'PASS',
            explanation:
              `CONFIRMED BOOKING TEAM: ${controlInfo.battingTeamName} (${controlInfo.battingTeamKey}) confirmed via ${activeBoundaryType} (${paiseCalc.delta}p move, odds ${currentPaise}p >= ${minPaiseInclusive}p). Waiting for next 4 or 6 for entry confirmation.` +
              formatAuditTelemetrySuffix(boundaryTelemetry),
            metadata: buildAuditMetadata(boundaryTelemetry, {
              formula: paiseCalc.formula,
              boundaryType: activeBoundaryType,
              bookingTeam: controlInfo.battingTeamName,
              bookingTeamKey: controlInfo.battingTeamKey,
              currentPaise,
            }),
          };
          state.signalsHistory.unshift(confirmSignal);
          signals.push(confirmSignal);
        }
      }
      // 3B. Entry Confirmation: After booking team confirmed, next 4 (>= 11p) or 6 (>= 18p) leaving BATTING in control.
      // Requires BOTH controlTeamKey === battingTeamKey AND stored state.bookingTeamKey === battingTeamKey.
      else if (
        state.stage === 'CONFIRMED_BOOKING_TEAM' &&
        abnormalSignal.status === 'PASS' &&
        withinWindow
      ) {
        const bookingKeyMatchesBatting =
          Boolean(state.bookingTeamKey) &&
          Boolean(controlInfo.battingTeamKey) &&
          normalizeTeamKey(state.bookingTeamKey) === normalizeTeamKey(controlInfo.battingTeamKey);

        if (!controlKeyMatchesBatting || !bookingKeyMatchesBatting) {
          const mismatchReason = !controlKeyMatchesBatting
            ? `Key mismatch: controlTeamKey (${controlInfo.controlTeamKey || 'none'}) !== battingTeamKey (${controlInfo.battingTeamKey})`
            : `Key mismatch: stored bookingTeamKey (${state.bookingTeamKey || 'none'}) !== current battingTeamKey (${controlInfo.battingTeamKey})`;
          const failConfirmKey = `${matchId}-ENTRY_CONFIRMATION_BOUNDARY-FAIL-${currentInnings}-${currentOver}.${currentBalls}`;
          if (!state.processedEventKeys.has(failConfirmKey)) {
            state.processedEventKeys.add(failConfirmKey);
            const failSignal: StrategySignal = {
              id: `${matchId}-ENTRY_CONFIRMATION_BOUNDARY-FAIL-${nowMs}`,
              signalType: 'ENTRY_CONFIRMATION_BOUNDARY',
              matchId,
              timestamp: nowDate,
              currentInnings,
              currentOver,
              ballNumber: currentBalls,
              relevantOdds: {
                measuredTeam: controlInfo.battingTeamName,
                teamInControl: currControl,
                decimalOdds,
                currentPaise,
                calculatedDelta: paiseCalc.delta,
                rawF: boundaryTelemetry.rawF,
                controlTeamKey: boundaryTelemetry.controlTeamKey ?? undefined,
                oddsFetchedAt: boundaryTelemetry.odds_fetched_at,
                scoreFetchedAt: boundaryTelemetry.score_fetched_at,
              },
              ruleEvaluated: `Entry Confirmation Boundary: Requires controlTeamKey === battingTeamKey AND bookingTeamKey === battingTeamKey`,
              status: 'FAIL',
              explanation:
                `ENTRY CONFIRMATION REJECTED: ${mismatchReason}. No entry recorded.` +
                formatAuditTelemetrySuffix(boundaryTelemetry),
              metadata: buildAuditMetadata(boundaryTelemetry, {
                bookingTeamKey: state.bookingTeamKey || null,
                mismatchReason,
              }),
            };
            state.signalsHistory.unshift(failSignal);
            signals.push(failSignal);
          }
        } else {
          state.entryConfirmedBoundary = {
            type: activeBoundaryType,
            innings: currentInnings,
            legalBalls: currentLegalBalls,
            over: currentOver,
            ball: currentBalls,
            paiseDelta: paiseCalc.delta,
            timestamp: nowDate,
          };

          const entryConfirmKey = `${matchId}-ENTRY_CONFIRMATION_BOUNDARY-${currentInnings}-${currentOver}.${currentBalls}`;
          if (!state.processedEventKeys.has(entryConfirmKey)) {
            state.processedEventKeys.add(entryConfirmKey);
            const boundary2Signal: StrategySignal = {
              id: `${matchId}-ENTRY_CONFIRMATION_BOUNDARY-${nowMs}`,
              signalType: 'ENTRY_CONFIRMATION_BOUNDARY',
              matchId,
              timestamp: nowDate,
              currentInnings,
              currentOver,
              ballNumber: currentBalls,
              relevantOdds: {
                measuredTeam: controlInfo.battingTeamName,
                teamInControl: 'BATTING',
                decimalOdds,
                currentPaise,
                calculatedDelta: paiseCalc.delta,
                rawF: boundaryTelemetry.rawF,
                controlTeamKey: boundaryTelemetry.controlTeamKey ?? undefined,
                oddsFetchedAt: boundaryTelemetry.odds_fetched_at,
                scoreFetchedAt: boundaryTelemetry.score_fetched_at,
              },
              ruleEvaluated: `Entry Confirmation Boundary: BATTING control (controlTeamKey === battingTeamKey === bookingTeamKey) + 4 (>= 11p) / 6 (>= 18p)`,
              status: 'PASS',
              explanation:
                `ENTRY CONFIRMATION BOUNDARY QUALIFIED: ${activeBoundaryType} with ${paiseCalc.delta}p shift and BATTING odds ${currentPaise}p.` +
                formatAuditTelemetrySuffix(boundaryTelemetry),
              metadata: buildAuditMetadata(boundaryTelemetry, {
                formula: paiseCalc.formula,
                boundaryType: activeBoundaryType,
                bookingTeamKey: state.bookingTeamKey || null,
              }),
            };
            state.signalsHistory.unshift(boundary2Signal);
            signals.push(boundary2Signal);
          }

          if (battingAtOrAbove85) {
            // Enter IMMEDIATELY on this boundary ball
            state.stage = 'ACTIVE_FIRST_ENTRY';
            state.pending85 = false;
            this.recordEntry(
              matchId,
              'FIRST_ENTRY',
              decimalOdds ?? Number((1 + currentPaise / 100).toFixed(2)),
              currentInnings,
              currentOver,
              currentWickets,
              nowDate,
              state.bookingTeamName || controlInfo.battingTeamName,
              controlInfo.battingTeamName,
              controlInfo.bowlingTeamName,
              matchTitle,
              match.seriesName,
              false
            );

            const triggerSignal: StrategySignal = {
              id: `${matchId}-FIRST_ENTRY_TRIGGER-${nowMs}`,
              signalType: 'FIRST_ENTRY_TRIGGER',
              matchId,
              timestamp: nowDate,
              currentInnings,
              currentOver,
              ballNumber: currentBalls,
              relevantOdds: {
                measuredTeam: controlInfo.battingTeamName,
                decimalOdds,
                currentPaise,
                teamInControl: 'BATTING',
                calculatedDelta: paiseCalc.delta,
                rawF: boundaryTelemetry.rawF,
                controlTeamKey: boundaryTelemetry.controlTeamKey ?? undefined,
                oddsFetchedAt: boundaryTelemetry.odds_fetched_at,
                scoreFetchedAt: boundaryTelemetry.score_fetched_at,
              },
              ruleEvaluated: `First Entry: Booking confirmed + 4/6 move + BATTING odds >= ${minPaiseInclusive} paise`,
              status: 'PASS',
              explanation:
                `FIRST ENTRY TRIGGERED! ${controlInfo.battingTeamName} entered immediately at ${currentPaise} paise (>= ${minPaiseInclusive}p / ${decimalOdds?.toFixed(2)} decimal).` +
                formatAuditTelemetrySuffix(boundaryTelemetry),
              metadata: buildAuditMetadata(boundaryTelemetry, {
                deferredEntry: false,
                bookingTeamKey: state.bookingTeamKey || null,
              }),
            };
            state.signalsHistory.unshift(triggerSignal);
            signals.push(triggerSignal);
          } else {
            // Enter CONFIRMED_PENDING_85 and wait for first later ball with BATTING >= 85
            state.stage = 'CONFIRMED_PENDING_85';
            state.pending85 = true;
            const waitKey = `${matchId}-ENTRY_CONFIRMED_WAITING_85-${currentInnings}-${currentOver}.${currentBalls}`;
            if (!state.processedEventKeys.has(waitKey)) {
              state.processedEventKeys.add(waitKey);
              const waitingSignal: StrategySignal = {
                id: `${matchId}-ENTRY_CONFIRMED_WAITING_85-${nowMs}`,
                signalType: 'ENTRY_CONFIRMED_WAITING_85',
                matchId,
                timestamp: nowDate,
                currentInnings,
                currentOver,
                ballNumber: currentBalls,
                relevantOdds: {
                  measuredTeam: controlInfo.battingTeamName,
                  teamInControl: 'BATTING',
                  decimalOdds,
                  currentPaise,
                  calculatedDelta: paiseCalc.delta,
                  rawF: boundaryTelemetry.rawF,
                  controlTeamKey: boundaryTelemetry.controlTeamKey ?? undefined,
                  oddsFetchedAt: boundaryTelemetry.odds_fetched_at,
                  scoreFetchedAt: boundaryTelemetry.score_fetched_at,
                },
                ruleEvaluated: `Deferred First Entry: Confirmed at ${currentPaise}p (< ${minPaiseInclusive}p); wait for first later ball >= ${minPaiseInclusive}p`,
                status: 'PASS',
                explanation:
                  `ENTRY CONFIRMED (CONFIRMED_PENDING_85): ${activeBoundaryType} moved ${paiseCalc.delta}p to BATTING ${currentPaise}p (< ${minPaiseInclusive}p). Will enter on first later ball with BATTING >= ${minPaiseInclusive}p inside window (no new 4/6 needed).` +
                  formatAuditTelemetrySuffix(boundaryTelemetry),
                metadata: buildAuditMetadata(boundaryTelemetry, {
                  bookingTeamKey: state.bookingTeamKey || null,
                  boundaryType: activeBoundaryType,
                }),
              };
              state.signalsHistory.unshift(waitingSignal);
              signals.push(waitingSignal);
            }
          }
        }
      }
    }

    // 3C. Deferred First Entry: When in CONFIRMED_PENDING_85, enter on first later ball with BATTING >= 85 inside window
    // Strictly enforces controlTeamKey === battingTeamKey AND stored bookingTeamKey === battingTeamKey.
    if (
      state.stage === 'CONFIRMED_PENDING_85' &&
      !hasAnyEntry &&
      isFromGetSV3 &&
      currControl === 'BATTING' &&
      currentPaise !== null &&
      currentPaise >= minPaiseInclusive &&
      withinWindow &&
      currentWickets < this.config.wicketFilter.maxAllowedWicketsBeforeEntry
    ) {
      const confirmedInnings = state.entryConfirmedBoundary?.innings ?? currentInnings;
      const confirmedLegalBalls =
        state.entryConfirmedBoundary?.legalBalls ??
        (state.entryConfirmedBoundary
          ? Math.floor(state.entryConfirmedBoundary.over) * 6 + state.entryConfirmedBoundary.ball
          : -1);
      const isLaterBall =
        !state.entryConfirmedBoundary ||
        currentInnings !== confirmedInnings ||
        currentLegalBalls > confirmedLegalBalls;

      if (isLaterBall) {
        const deferredTelemetry = buildStepTelemetry({
          control_before: state.lastEvaluatedControl,
          control_after: currControl,
          odds_before: state.lastEvaluatedPaise,
          odds_after: currentPaise,
          move:
            state.lastEvaluatedPaise !== null && state.lastEvaluatedControl === 'BATTING'
              ? currentPaise - state.lastEvaluatedPaise
              : null,
        });
        const bookingKeyMatchesBatting =
          Boolean(state.bookingTeamKey) &&
          Boolean(controlInfo.battingTeamKey) &&
          normalizeTeamKey(state.bookingTeamKey) === normalizeTeamKey(controlInfo.battingTeamKey);

        if (!controlKeyMatchesBatting || !bookingKeyMatchesBatting) {
          const mismatchReason = !controlKeyMatchesBatting
            ? `Key mismatch: controlTeamKey (${controlInfo.controlTeamKey || 'none'}) !== battingTeamKey (${controlInfo.battingTeamKey})`
            : `Key mismatch: stored bookingTeamKey (${state.bookingTeamKey || 'none'}) !== current battingTeamKey (${controlInfo.battingTeamKey})`;
          const failDefKey = `${matchId}-FIRST_ENTRY_TRIGGER-DEFERRED-FAIL-${currentInnings}-${currentOver}.${currentBalls}-${state.bookingTeamKey || 'none'}-${controlInfo.battingTeamKey}`;
          if (!state.processedEventKeys.has(failDefKey)) {
            state.processedEventKeys.add(failDefKey);
            const failSignal: StrategySignal = {
              id: `${matchId}-FIRST_ENTRY_TRIGGER-FAIL-${nowMs}`,
              signalType: 'FIRST_ENTRY_TRIGGER',
              matchId,
              timestamp: nowDate,
              currentInnings,
              currentOver,
              ballNumber: currentBalls,
              relevantOdds: {
                measuredTeam: controlInfo.battingTeamName,
                decimalOdds,
                currentPaise,
                teamInControl: currControl,
                rawF: deferredTelemetry.rawF,
                controlTeamKey: deferredTelemetry.controlTeamKey ?? undefined,
                oddsFetchedAt: deferredTelemetry.odds_fetched_at,
                scoreFetchedAt: deferredTelemetry.score_fetched_at,
              },
              ruleEvaluated: `Deferred First Entry: Requires controlTeamKey === battingTeamKey AND bookingTeamKey === battingTeamKey`,
              status: 'FAIL',
              explanation:
                `DEFERRED FIRST ENTRY BLOCKED: ${mismatchReason}. Entry NOT recorded.` +
                formatAuditTelemetrySuffix(deferredTelemetry),
              metadata: buildAuditMetadata(deferredTelemetry, {
                deferredEntry: true,
                bookingTeamKey: state.bookingTeamKey || null,
                mismatchReason,
              }),
            };
            state.signalsHistory.unshift(failSignal);
            signals.push(failSignal);
          }
        } else {
          state.stage = 'ACTIVE_FIRST_ENTRY';
          state.pending85 = false;
          this.recordEntry(
            matchId,
            'FIRST_ENTRY',
            decimalOdds ?? Number((1 + currentPaise / 100).toFixed(2)),
            currentInnings,
            currentOver,
            currentWickets,
            nowDate,
            state.bookingTeamName || controlInfo.battingTeamName,
            controlInfo.battingTeamName,
            controlInfo.bowlingTeamName,
            matchTitle,
            match.seriesName,
            false
          );

          const deferredTriggerKey = `${matchId}-FIRST_ENTRY_TRIGGER-DEFERRED-${currentInnings}-${currentOver}.${currentBalls}`;
          if (!state.processedEventKeys.has(deferredTriggerKey)) {
            state.processedEventKeys.add(deferredTriggerKey);
            const triggerSignal: StrategySignal = {
              id: `${matchId}-FIRST_ENTRY_TRIGGER-${nowMs}`,
              signalType: 'FIRST_ENTRY_TRIGGER',
              matchId,
              timestamp: nowDate,
              currentInnings,
              currentOver,
              ballNumber: currentBalls,
              relevantOdds: {
                measuredTeam: controlInfo.battingTeamName,
                decimalOdds,
                currentPaise,
                teamInControl: 'BATTING',
                rawF: deferredTelemetry.rawF,
                controlTeamKey: deferredTelemetry.controlTeamKey ?? undefined,
                oddsFetchedAt: deferredTelemetry.odds_fetched_at,
                scoreFetchedAt: deferredTelemetry.score_fetched_at,
              },
              ruleEvaluated: `Deferred First Entry: CONFIRMED_PENDING_85 + BATTING odds >= ${minPaiseInclusive} paise on later ball`,
              status: 'PASS',
              explanation:
                `DEFERRED FIRST ENTRY TRIGGERED! ${controlInfo.battingTeamName} reached ${currentPaise} paise (>= ${minPaiseInclusive}p) on later ball @ ${currentOver} ov.` +
                formatAuditTelemetrySuffix(deferredTelemetry),
              metadata: buildAuditMetadata(deferredTelemetry, {
                deferredEntry: true,
                bookingTeamKey: state.bookingTeamKey || null,
              }),
            };
            state.signalsHistory.unshift(triggerSignal);
            signals.push(triggerSignal);
          }
        }
      }
    }

    // 4. First Entry Candidate Snapshot Signal (audit / UI display)
    const firstEntrySignal = this.evaluateFirstEntry({
      matchId,
      decimalOdds,
      currentPaise,
      teamInControl: currControl,
      currentInnings,
      currentOver,
      currentWickets,
      ballNumber: currentBalls,
      measuredTeam,
      timestamp: nowDate,
    });
    signals.push(firstEntrySignal);

    // 5. Second Entry: ONLY after active First Entry, confirmed wicket, BOWLING control_team_odds < 65 (allowed after over window)
    if (
      (state.stage === 'ACTIVE_FIRST_ENTRY' ||
        (state.firstEntryPosition.status === 'RECORDED_ENTRY' &&
          state.secondEntryPosition.status !== 'RECORDED_ENTRY' &&
          state.secondEntryPosition.status !== 'RECORDED_EXIT')) &&
      state.stage !== 'FIRST_BOOKSET_COMPLETED' &&
      state.stage !== 'FULL_BOOKSET_COMPLETED'
    ) {
      const secondEntrySignal = this.evaluateSecondEntry({
        matchId,
        teamInControl: currControl,
        controlTeamOdds: currentPaise,
        decimalOdds,
        currentWickets,
        currentInnings,
        currentOver,
        ballNumber: currentBalls,
        measuredTeam: controlInfo.bowlingTeamName,
        timestamp: nowDate,
      });
      signals.push(secondEntrySignal);

      if (secondEntrySignal.status === 'PASS') {
        const entryDec =
          decimalOdds ?? (currentPaise !== null ? Number((1 + currentPaise / 100).toFixed(2)) : 1.64);
        this.recordEntry(
          matchId,
          'SECOND_ENTRY',
          entryDec,
          currentInnings,
          currentOver,
          currentWickets,
          nowDate,
          state.bookingTeamName || controlInfo.battingTeamName,
          controlInfo.battingTeamName,
          controlInfo.bowlingTeamName,
          matchTitle,
          match.seriesName,
          false
        );

        const secondTelemetry = buildStepTelemetry({
          control_before: state.lastEvaluatedControl,
          control_after: currControl,
          odds_before: state.lastEvaluatedPaise,
          odds_after: currentPaise,
          move:
            state.lastEvaluatedPaise !== null && currentPaise !== null
              ? currentPaise - state.lastEvaluatedPaise
              : null,
        });

        const secondTriggerKey = `${matchId}-SECOND_ENTRY_TRIGGER-${currentInnings}-${currentOver}.${currentBalls}-${currentWickets}`;
        if (!state.processedEventKeys.has(secondTriggerKey)) {
          state.processedEventKeys.add(secondTriggerKey);
          const secondTrigger: StrategySignal = {
            id: `${matchId}-SECOND_ENTRY_TRIGGER-${nowMs}`,
            signalType: 'SECOND_ENTRY_TRIGGER',
            matchId,
            timestamp: nowDate,
            currentInnings,
            currentOver,
            ballNumber: currentBalls,
            relevantOdds: {
              measuredTeam: controlInfo.bowlingTeamName,
              teamInControl: 'BOWLING',
              decimalOdds: entryDec,
              currentPaise,
              rawF: secondTelemetry.rawF,
              controlTeamKey: secondTelemetry.controlTeamKey ?? undefined,
              oddsFetchedAt: secondTelemetry.odds_fetched_at,
              scoreFetchedAt: secondTelemetry.score_fetched_at,
            },
            ruleEvaluated: `Second Entry: Wicket after 1st entry + BOWLING control_team_odds < ${this.config.secondEntry.maxBowlingPaiseExclusive} paise`,
            status: 'PASS',
            explanation:
              `SECOND ENTRY TRIGGERED! Wicket confirmed and BOWLING control_team_odds dropped to ${currentPaise} paise (< ${this.config.secondEntry.maxBowlingPaiseExclusive}p). Holding both entries until Bookset (BOWLING > ${this.config.bookset.minBowlingPaiseExclusive}p).` +
              formatAuditTelemetrySuffix(secondTelemetry),
            metadata: buildAuditMetadata(secondTelemetry, {
              currentWickets,
              anchorWickets: state.firstEntryTrade?.entryWickets ?? state.firstEntryPosition.entryWickets ?? 0,
            }),
          };
          state.signalsHistory.unshift(secondTrigger);
          signals.push(secondTrigger);
        }
      }
    }

    // 6. Exits:
    //    - If 2nd entry active: BOWLING > 85 closes BOTH entries (Bookset).
    //    - If only 1st entry active:
    //      (a) FIRST_EXIT_BELOW_55: if no wicket since 1st entry AND BATTING <= 55 -> exits 1st entry.
    //      (b) Bookset: BOWLING > 85 -> closes 1st entry.
    const exitTelemetry = buildStepTelemetry({
      control_before: state.lastEvaluatedControl,
      control_after: currControl,
      odds_before: state.lastEvaluatedPaise,
      odds_after: currentPaise,
      move:
        state.lastEvaluatedPaise !== null && currentPaise !== null
          ? currentPaise - state.lastEvaluatedPaise
          : null,
    });

    if (
      state.stage === 'ACTIVE_SECOND_ENTRY' ||
      (state.secondEntryPosition.status === 'RECORDED_ENTRY' &&
        state.stage !== 'FULL_BOOKSET_COMPLETED')
    ) {
      const booksetSignal = this.evaluateBooksetExit({
        matchId,
        teamInControl: currControl,
        controlTeamOdds: currentPaise,
        decimalOdds,
        currentInnings,
        currentOver,
        ballNumber: currentBalls,
        measuredTeam: controlInfo.bowlingTeamName,
        signalType: 'SECOND_BOOKSET_TARGET',
        timestamp: nowDate,
        auditTelemetry: exitTelemetry,
      });
      signals.push(booksetSignal);

      if (booksetSignal.status === 'PASS') {
        const exitDec =
          decimalOdds ?? (currentPaise !== null ? Number((1 + currentPaise / 100).toFixed(2)) : 1.86);
        this.recordExit(
          matchId,
          'SECOND_ENTRY',
          exitDec,
          currentOver,
          nowDate,
          'FULL_BOOKSET_OPPOSING_85',
          false
        );
      }
    } else if (
      state.stage === 'ACTIVE_FIRST_ENTRY' ||
      (state.firstEntryPosition.status === 'RECORDED_ENTRY' &&
        state.stage !== 'FIRST_BOOKSET_COMPLETED' &&
        state.stage !== 'FULL_BOOKSET_COMPLETED')
    ) {
      const exitBelow55Signal = this.evaluateFirstExitBelow55({
        matchId,
        teamInControl: currControl,
        controlTeamOdds: currentPaise,
        decimalOdds,
        currentWickets,
        currentInnings,
        currentOver,
        ballNumber: currentBalls,
        measuredTeam: controlInfo.battingTeamName,
        timestamp: nowDate,
        auditTelemetry: exitTelemetry,
      });
      signals.push(exitBelow55Signal);

      if (exitBelow55Signal.status === 'PASS') {
        const exitDec =
          decimalOdds ?? (currentPaise !== null ? Number((1 + currentPaise / 100).toFixed(2)) : 1.55);
        this.recordExit(
          matchId,
          'FIRST_ENTRY',
          exitDec,
          currentOver,
          nowDate,
          'FIRST_EXIT_BELOW_55',
          false
        );
      } else {
        const booksetSignal = this.evaluateBooksetExit({
          matchId,
          teamInControl: currControl,
          controlTeamOdds: currentPaise,
          decimalOdds,
          currentInnings,
          currentOver,
          ballNumber: currentBalls,
          measuredTeam: controlInfo.bowlingTeamName,
          signalType: 'FIRST_BOOKSET_TARGET',
          timestamp: nowDate,
          auditTelemetry: exitTelemetry,
        });
        signals.push(booksetSignal);

        if (booksetSignal.status === 'PASS') {
          const exitDec =
            decimalOdds ?? (currentPaise !== null ? Number((1 + currentPaise / 100).toFixed(2)) : 1.86);
          this.recordExit(
            matchId,
            'FIRST_ENTRY',
            exitDec,
            currentOver,
            nowDate,
            'FULL_BOOKSET_OPPOSING_85',
            false
          );
        }
      }
    }

    updateTickAnchors();
    return signals;
  }
}

// Global default singleton instance
export const strategyEngine = new CricketStrategyEngine();
