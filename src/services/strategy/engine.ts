/**
 * Cricket Trading Strategy Engine (Abnormal Boundary & Booking Team Strategy)
 *
 * Rules:
 * 1. Booking Team Confirmation: Batting team must be in control and hit a 4 (>= 11 paise) or 6 (>= 18 paise).
 *    Flip formula: (100 - Pprev) + (100 - Pcurr) when bowling was previously in control.
 * 2. Pre-check Wicket Safety: If >= 3 wickets fall before entry, the match is skipped.
 * 3. Over Limits: 1st Innings <= 10.0 ov; 2nd Innings <= 6.0 ov.
 * 4. First Entry: Batting team confirmed + boundary 4 (>= 11) / 6 (>= 18) + paise >= 85.
 *    Deferred Entry: If paise < 85, holds as CONFIRMED_PENDING_85 until live odds cross >= 85.
 * 5. Hold State / Anti-Duplication: Once an entry is provided, it is held in state. Zero duplicate signals.
 * 6. First Bookset: Batting team odds between 45 and 55 paise (decimal 1.45 - 1.55).
 * 7. Second Entry: Confirmed wicket before first bookset + opposing team odds < 65 paise (decimal < 1.65).
 * 8. Combined Bookset: Opposing team odds >= 85 paise (decimal >= 1.85) closes both 1st and 2nd entries.
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
} from './types';
import { StrategyConfig, DEFAULT_STRATEGY_CONFIG } from './config';

/**
 * Derives opposing team decimal odds in a 2-way cricket market.
 * Uses complementary implied probability: 1 / (1 - 1 / favoriteOdds).
 */
export function calculateOpposingOdds(favoriteDecimalOdds: number | null | undefined): number | null {
  if (!favoriteDecimalOdds || favoriteDecimalOdds <= 1.0) return null;
  const probA = 1 / favoriteDecimalOdds;
  const probB = 1 - probA;
  if (probB <= 0.005) return null; // near 0 probability
  const rawOpposing = 1 / probB;
  return Number(rawOpposing.toFixed(2));
}

/**
 * Converts decimal odds to integer paise rate (e.g. 1.85 -> 85 paise).
 */
export function decimalOddsToPaise(decimalOdds: number | null | undefined): number | null {
  if (decimalOdds === null || decimalOdds === undefined || isNaN(decimalOdds) || decimalOdds <= 1.0) {
    return null;
  }
  return Math.round((decimalOdds - 1) * 100);
}

/**
 * Checks whether the current over falls within the allowed entry window.
 * - 1st Innings: <= 10.0 overs
 * - 2nd Innings: <= 6.0 overs
 */
export function isWithinEntryWindow(
  innings: number,
  over: number,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): boolean {
  if (innings <= 1) {
    return over <= config.entryWindows.firstInningsMaxOver;
  }
  return over <= config.entryWindows.secondInningsMaxOver;
}

/**
 * Calculates the exact paise difference / change on a boundary ball according to user formula:
 * - If control was with Bowling team at Pprev and flips to Batting team at Pcurr:
 *     Difference = (100 - Pprev) + (100 - Pcurr)
 *     e.g., Bowling at 80 paise -> Batting at 95 paise = (100 - 80) + (100 - 95) = 20 + 5 = 25 paise.
 * - If Batting team was already in control:
 *     Difference = |Pcurr - Pprev|
 * - If Batting is NOT in control after the ball:
 *     Cannot qualify batting team.
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

  if (prevControl === 'BATTING') {
    const delta = Math.abs(currPaise - prevPaise);
    return {
      delta,
      formula: `|${currPaise} - ${prevPaise}| = ${delta} paise`,
      qualifiesBattingControl: true,
    };
  }

  // Fallback for initial or unknown previous state
  const delta = Math.abs(currPaise - prevPaise);
  return {
    delta,
    formula: `|${currPaise} - ${prevPaise}| = ${delta} paise`,
    qualifiesBattingControl: true,
  };
}

/**
 * Resolves which team is currently in control (favorite) from Crex getSV3 API (field F),
 * comparing against the batting team and bowling team of the match.
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
} {
  const is2ndInnings = !!match.team2Score;
  const battingTeam = is2ndInnings ? match.team2 : match.team1;
  const bowlingTeam = is2ndInnings ? match.team1 : match.team2;

  const battingTeamKey = battingTeam.key || (is2ndInnings ? match.raw?.c : match.raw?.b) || 'BAT';
  const battingTeamName = battingTeam.name || battingTeam.shortName || 'Batting Team';
  const bowlingTeamKey = bowlingTeam.key || (is2ndInnings ? match.raw?.b : match.raw?.c) || 'BOWL';
  const bowlingTeamName = bowlingTeam.name || bowlingTeam.shortName || 'Bowling Team';

  const bookmaker = oddsState?.odds?.bookmaker;
  const decimalOdds = bookmaker?.decimalBack ?? bookmaker?.decimalLay ?? null;
  const currentPaise =
    bookmaker?.backRate ??
    (decimalOdds ? Math.round((decimalOdds - 1) * 100) : null);

  // Extract raw F field from SV3 e.g. "^80" or "^O"
  const rawF = oddsState?.odds?.raw?.F;
  const favoriteKey =
    typeof rawF === 'string'
      ? rawF.replace(/^\^/, '').trim()
      : oddsState?.odds?.favoriteTeamKey || '';
  const favoriteName = oddsState?.odds?.favoriteTeamName || '';

  let teamInControl: TeamControlState = 'UNKNOWN';

  if (favoriteKey || favoriteName) {
    const batKeyNorm = battingTeamKey.toLowerCase();
    const bowlKeyNorm = bowlingTeamKey.toLowerCase();
    const favKeyNorm = favoriteKey.toLowerCase();
    const batNameNorm = battingTeamName.toLowerCase();
    const batShortNorm = (battingTeam.shortName || '').toLowerCase();
    const bowlNameNorm = bowlingTeamName.toLowerCase();
    const bowlShortNorm = (bowlingTeam.shortName || '').toLowerCase();
    const favNameNorm = favoriteName.toLowerCase();

    // 1. Direct key match
    if (favKeyNorm && favKeyNorm === batKeyNorm) {
      teamInControl = 'BATTING';
    } else if (favKeyNorm && favKeyNorm === bowlKeyNorm) {
      teamInControl = 'BOWLING';
    }
    // 2. Name / shortName match
    else if (
      (favNameNorm && (favNameNorm.includes(batShortNorm) || batNameNorm.includes(favNameNorm))) ||
      (favKeyNorm && (favKeyNorm === batShortNorm || batNameNorm.includes(favKeyNorm)))
    ) {
      teamInControl = 'BATTING';
    } else if (
      (favNameNorm && (favNameNorm.includes(bowlShortNorm) || bowlNameNorm.includes(favNameNorm))) ||
      (favKeyNorm && (favKeyNorm === bowlShortNorm || bowlNameNorm.includes(favKeyNorm)))
    ) {
      teamInControl = 'BOWLING';
    }
    // 3. Fallback: Check raw.cl list from Crex SV3 response if available
    else if (oddsState?.odds?.raw?.cl && Array.isArray(oddsState.odds.raw.cl)) {
      const matched = oddsState.odds.raw.cl.find((item) => item.code === favoriteKey);
      if (matched?.name) {
        const clName = matched.name.toLowerCase();
        if (clName.includes(batShortNorm) || batNameNorm.includes(clName)) {
          teamInControl = 'BATTING';
        } else if (clName.includes(bowlShortNorm) || bowlNameNorm.includes(clName)) {
          teamInControl = 'BOWLING';
        }
      }
    }
  }

  // If still unknown but we have win probability or odds fallback
  if (teamInControl === 'UNKNOWN' && match.winProbability?.favoriteTeamKey) {
    if (match.winProbability.favoriteTeamKey === battingTeamKey) {
      teamInControl = 'BATTING';
    } else if (match.winProbability.favoriteTeamKey === bowlingTeamKey) {
      teamInControl = 'BOWLING';
    }
  }

  return {
    teamInControl,
    controlTeamKey: favoriteKey || undefined,
    controlTeamName: favoriteName || undefined,
    battingTeamKey,
    battingTeamName,
    bowlingTeamKey,
    bowlingTeamName,
    currentPaise,
    decimalOdds,
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
      secondEntry: {
        ...DEFAULT_STRATEGY_CONFIG.secondEntry,
        ...config.secondEntry,
      },
      entryWindows: {
        ...DEFAULT_STRATEGY_CONFIG.entryWindows,
        ...config.entryWindows,
      },
    };
  }

  /**
   * Registers a callback invoked whenever any trade entry or exit is recorded.
   */
  public onTrade(listener: TradeListener): () => void {
    this.tradeListeners.add(listener);
    return () => this.tradeListeners.delete(listener);
  }

  /**
   * Dispatches trade updates to all registered listeners.
   */
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

  /**
   * Retrieves or initializes independent strategy state for a match.
   */
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
      lastEvaluatedWickets: 0,
      lastEvaluatedRuns: 0,
      lastEvaluatedBalls: 0,
      lastEvaluatedOdds: null,
      lastEvaluatedPaise: null,
      lastEvaluatedControl: 'UNKNOWN',
      bookingConfirmedBoundary: null,
      entryConfirmedBoundary: null,
      processedEventKeys: new Set<string>(),
      abnormalActivityCount: 0,
      lastUpdated: new Date(),
    };

    this.matchStates.set(matchId, newState);
    return newState;
  }

  /**
   * Resets strategy state for a given match.
   */
  public resetState(matchId: string): void {
    this.matchStates.delete(matchId);
  }

  /**
   * Explicitly records an entry position and creates a StrategyTradeRecord.
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
    seriesName?: string
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

    const tradeRecord: StrategyTradeRecord = {
      id: `${matchId}-${positionType}-${Date.now()}`,
      matchId,
      matchName,
      seriesName,
      bookingTeam: state.bookingTeamName || bookingTeam,
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
   * Explicitly records an exit position and updates StrategyTradeRecord.
   */
  public recordExit(
    matchId: string,
    positionType: PositionType,
    exitOdds: number,
    over: number,
    timestamp: Date = new Date(),
    exitReason: 'FIRST_BOOKSET_45_55' | 'FULL_BOOKSET_OPPOSING_85' = 'FIRST_BOOKSET_45_55'
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
      state.secondEntryTrade.updatedAt = timestamp;
      state.stage = 'FULL_BOOKSET_COMPLETED';
      this.notifyTrade(state.secondEntryTrade);

      // Also close first entry trade if still active
      if (state.firstEntryTrade && state.firstEntryTrade.status === 'ACTIVE') {
        state.firstEntryTrade.exitOver = over;
        state.firstEntryTrade.exitPaise = exitPaise;
        state.firstEntryTrade.exitDecimal = exitOdds;
        state.firstEntryTrade.exitTime = timestamp;
        state.firstEntryTrade.exitReason = 'FULL_BOOKSET_OPPOSING_85';
        state.firstEntryTrade.status = 'BOOKSET_COMPLETED';
        state.firstEntryTrade.updatedAt = timestamp;
        this.notifyTrade(state.firstEntryTrade);
      }
    }

    state.lastUpdated = new Date();
    return { ...targetPos };
  }

  /**
   * Evaluates Abnormal Activity rule on a boundary (Four or Six):
   * - Four: Must have at least 11 paise change (>= 0.11 / >= 11 paise).
   * - Six: Must have at least 18 paise change (>= 0.18 / >= 18 paise).
   */
  public evaluateAbnormalActivity(params: {
    matchId: string;
    boundaryType: 'FOUR' | 'SIX';
    oddsMovement: number; // can be in decimal e.g. 0.11 or paise e.g. 11
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

    // Normalize movement to decimal: if user passed >= 1 (e.g. 11, 25), convert to decimal
    const rawVal = Math.abs(oddsMovement);
    const decimalMovement = rawVal >= 1.0 ? rawVal / 100 : rawVal;
    const paiseMovement = rawVal >= 1.0 ? Math.round(rawVal) : Math.round(rawVal * 100);

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
        ? `Abnormal Activity Four: Odds movement must be at least ${minPaise} paise / ${minDecimal.toFixed(2)} (<= 10 paise fails)`
        : `Abnormal Activity Six: Odds movement must be at least ${minPaise} paise / ${minDecimal.toFixed(2)} (<= 17 paise fails)`;

    if (isNaN(oddsMovement) || oddsMovement === null || oddsMovement === undefined) {
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

    const normalizedMovement = Number(decimalMovement.toFixed(4));
    const qualifies = paiseMovement >= minPaise;
    const status: SignalStatus = qualifies ? 'PASS' : 'FAIL';

    let explanation = '';
    if (customFormulaExplanation) {
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
   * Evaluates First Entry rule:
   * - Batting team confirmed as booking team.
   * - Entry odds range: >= 85 paise (decimal >= 1.85, up to 2.00).
   * - Entry window: 1st innings <= 10.0 overs; 2nd innings <= 6.0 overs.
   * - Wicket check: < 3 wickets.
   */
  public evaluateFirstEntry(params: {
    matchId: string;
    decimalOdds: number | null;
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
      currentInnings,
      currentOver,
      currentWickets = 0,
      ballNumber = 0,
      measuredTeam,
      timestamp = new Date(),
    } = params;

    const state = this.getState(matchId);
    const signalType: SignalType = 'FIRST_ENTRY_CANDIDATE';
    const { minOdds, maxOdds, minPaise } = this.config.firstEntry;
    const ruleEvaluated = `First Entry: Odds must be >= ${minPaise} paise (decimal ${minOdds.toFixed(2)} to ${maxOdds.toFixed(2)}) during entry window (Inn 1 <= ${this.config.entryWindows.firstInningsMaxOver} ov, Inn 2 <= ${this.config.entryWindows.secondInningsMaxOver} ov, < 3 wkts)`;

    if (decimalOdds === null || decimalOdds === undefined || isNaN(decimalOdds) || decimalOdds <= 0) {
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
          decimalOdds: null,
        },
        ruleEvaluated,
        status: 'DATA UNAVAILABLE',
        explanation: 'Active odds are currently unavailable or suspended.',
      };
    }

    // 1. If First Entry is already active or recorded, HOLD strictly in PASS status without flickering!
    if (
      state.stage === 'ACTIVE_FIRST_ENTRY' ||
      state.firstEntryPosition.status === 'RECORDED_ENTRY'
    ) {
      const entryPaise =
        state.firstEntryTrade?.entryPaise ??
        (state.firstEntryPosition.entryOdds
          ? Math.round((state.firstEntryPosition.entryOdds - 1) * 100)
          : 85);
      const entryDecimal =
        state.firstEntryTrade?.entryDecimal ?? state.firstEntryPosition.entryOdds ?? 1.85;
      const currentPaiseVal = decimalOdds ? Math.round((decimalOdds - 1) * 100) : null;

      const heldSignal: StrategySignal = {
        id: `${matchId}-FIRST_ENTRY_HELD-${Date.now()}`,
        signalType: 'FIRST_ENTRY_CANDIDATE',
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          decimalOdds,
          currentPaise: currentPaiseVal,
        },
        ruleEvaluated: `First Entry (Held): Entered at ${entryPaise} paise (${entryDecimal.toFixed(2)}). Holding until Bookset Target (45-55 paise) or wicket hedge.`,
        status: 'PASS',
        explanation: `FIRST ENTRY ACTIVE & HELD: Position entered at ${entryPaise} paise (${entryDecimal.toFixed(2)} decimal). Currently holding position (Current: ${currentPaiseVal !== null ? `${currentPaiseVal} paise / ` : ''}${decimalOdds ? decimalOdds.toFixed(2) : '—'}). Monitoring for First Bookset at 45-55 paise. Zero flickering below 85 paise.`,
        metadata: {
          held: true,
          entryPaise,
          entryDecimal,
          currentPaise: currentPaiseVal,
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

    // 2. If First Bookset is completed, hold as PASS (Bookset Secured)
    if (state.stage === 'FIRST_BOOKSET_COMPLETED') {
      const exitPaise = state.firstEntryTrade?.exitPaise ?? 50;
      const exitDecimal = state.firstEntryTrade?.exitDecimal ?? 1.50;
      return {
        id: `${matchId}-FIRST_ENTRY_COMPLETED-${Date.now()}`,
        signalType: 'FIRST_ENTRY_CANDIDATE',
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          decimalOdds,
        },
        ruleEvaluated: `First Entry: Completed via Bookset at ${exitPaise} paise (${exitDecimal.toFixed(2)})`,
        status: 'PASS',
        explanation: `FIRST ENTRY COMPLETED: Bookset reached and secured at ${exitPaise} paise (${exitDecimal.toFixed(2)}). Position safely closed.`,
        metadata: {
          completed: true,
          exitPaise,
          exitDecimal,
        },
      };
    }

    // 3. If Candidate confirmed and waiting for 85 paise, hold as PASS (Candidate Confirmed - Awaiting 85)
    if (state.stage === 'CONFIRMED_PENDING_85') {
      const currentPaiseVal = decimalOdds ? Math.round((decimalOdds - 1) * 100) : null;
      return {
        id: `${matchId}-CONFIRMED_PENDING_85-${Date.now()}`,
        signalType: 'FIRST_ENTRY_CANDIDATE',
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          decimalOdds,
          currentPaise: currentPaiseVal,
        },
        ruleEvaluated: 'First Entry Candidate: Confirmed by 2 boundaries, waiting for live odds >= 85 paise',
        status: 'PASS',
        explanation: `CANDIDATE CONFIRMED (AWAITING 85 PAISE): 2nd boundary confirmed entry. Current odds: ${currentPaiseVal !== null ? `${currentPaiseVal} paise` : `${decimalOdds?.toFixed(2)}`}. Holding candidate state; will enter automatically when odds cross >= 85 paise.`,
        metadata: {
          pending85: true,
          currentPaise: currentPaiseVal,
        },
      };
    }

    // 4. If Booking team confirmed and waiting for 2nd boundary, hold as PASS
    if (state.stage === 'CONFIRMED_BOOKING_TEAM') {
      const currentPaiseVal = decimalOdds ? Math.round((decimalOdds - 1) * 100) : null;
      return {
        id: `${matchId}-CONFIRMED_BOOKING_TEAM-${Date.now()}`,
        signalType: 'FIRST_ENTRY_CANDIDATE',
        matchId,
        timestamp,
        currentInnings,
        currentOver,
        ballNumber,
        relevantOdds: {
          measuredTeam,
          decimalOdds,
          currentPaise: currentPaiseVal,
        },
        ruleEvaluated: 'Booking Team Confirmed: Awaiting 2nd boundary shift to confirm entry',
        status: 'PASS',
        explanation: `BOOKING TEAM CONFIRMED: ${state.bookingTeamName || measuredTeam} confirmed via 1st boundary. Awaiting 2nd boundary with batting in control to qualify entry.`,
        metadata: {
          bookingTeamConfirmed: true,
          currentPaise: currentPaiseVal,
        },
      };
    }

    // Check wicket safety filter
    if (currentWickets >= this.config.wicketFilter.maxAllowedWicketsBeforeEntry) {
      state.stage = 'DISQUALIFIED_3_WICKETS';
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
          decimalOdds,
        },
        ruleEvaluated: `Wicket Safety: < ${this.config.wicketFilter.maxAllowedWicketsBeforeEntry} wickets required before entry`,
        status: 'FAIL',
        explanation: `SKIPPED MATCH: ${currentWickets} wickets have fallen before entry. Strategy rule requires skipping match if >= ${this.config.wicketFilter.maxAllowedWicketsBeforeEntry} wickets occur.`,
      };
    }

    const inWindow = isWithinEntryWindow(currentInnings, currentOver, this.config);
    const inOddsRange = decimalOdds >= minOdds && decimalOdds <= maxOdds;

    let status: SignalStatus = 'FAIL';
    let explanation = '';

    if (!inWindow) {
      status = 'FAIL';
      explanation = `Entry window closed: Over ${currentOver} exceeds maximum allowed over for innings ${currentInnings} (Limit: ${
        currentInnings === 1
          ? this.config.entryWindows.firstInningsMaxOver
          : this.config.entryWindows.secondInningsMaxOver
      } ov).`;
    } else if (!inOddsRange) {
      status = 'FAIL';
      if (decimalOdds < minOdds) {
        explanation = `Odds ${decimalOdds.toFixed(2)} are below the minimum entry threshold of ${minOdds.toFixed(2)}.`;
      } else {
        explanation = `Odds ${decimalOdds.toFixed(2)} exceed the maximum entry threshold of ${maxOdds.toFixed(2)}.`;
      }
    } else {
      status = 'PASS';
      explanation = `First-entry candidate detected: Odds ${decimalOdds.toFixed(2)} are within the qualifying range [${minOdds.toFixed(2)} - ${maxOdds.toFixed(2)}] at over ${currentOver}.`;
    }

    const eventKey = `${matchId}-${signalType}-${currentInnings}-${currentOver}-${decimalOdds.toFixed(2)}`;
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
        decimalOdds,
      },
      ruleEvaluated,
      status,
      explanation,
      metadata: { inWindow, inOddsRange, minOdds, maxOdds },
    };

    const historyDedupeKey = `${matchId}-${signalType}-${status}-${currentInnings}-${currentOver}-${ballNumber}-${decimalOdds.toFixed(2)}`;
    if (status === 'PASS' && !state.processedEventKeys.has(eventKey)) {
      state.processedEventKeys.add(eventKey);
      state.candidates.unshift(signal);
      if (state.firstEntryPosition.status === 'NONE') {
        state.firstEntryPosition.status = 'CANDIDATE_DETECTED';
        state.firstEntryPosition.candidateSignalId = signal.id;
      }
    }

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
   * Evaluates First Bookset Target:
   * - Batting team odds between 45 and 55 paise (decimal 1.45 to 1.55).
   */
  public evaluateFirstBookset(params: {
    matchId: string;
    decimalOdds: number | null;
    currentInnings: number;
    currentOver: number;
    ballNumber?: number;
    measuredTeam: string;
    timestamp?: Date;
  }): StrategySignal {
    const {
      matchId,
      decimalOdds,
      currentInnings,
      currentOver,
      ballNumber = 0,
      measuredTeam,
      timestamp = new Date(),
    } = params;

    const state = this.getState(matchId);
    const signalType: SignalType = 'FIRST_BOOKSET_TARGET';
    const { booksetTargetMin, booksetTargetMax, booksetTargetMinPaise, booksetTargetMaxPaise } =
      this.config.firstEntry;
    const ruleEvaluated = `First Bookset Target: Odds reach target range ${booksetTargetMinPaise} to ${booksetTargetMaxPaise} paise (decimal ${booksetTargetMin.toFixed(2)} to ${booksetTargetMax.toFixed(2)})`;

    if (decimalOdds === null || decimalOdds === undefined || isNaN(decimalOdds) || decimalOdds <= 0) {
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
          decimalOdds: null,
        },
        ruleEvaluated,
        status: 'DATA UNAVAILABLE',
        explanation: 'Active odds are currently unavailable for bookset calculation.',
      };
    }

    const inRange = decimalOdds >= booksetTargetMin && decimalOdds <= booksetTargetMax;
    const status: SignalStatus = inRange ? 'PASS' : 'FAIL';
    const explanation = inRange
      ? `First bookset target met: Odds ${decimalOdds.toFixed(2)} are in the bookset range [${booksetTargetMin.toFixed(2)} - ${booksetTargetMax.toFixed(2)}].`
      : `First bookset target not met: Odds ${decimalOdds.toFixed(2)} outside bookset range [${booksetTargetMin.toFixed(2)} - ${booksetTargetMax.toFixed(2)}].`;

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
        decimalOdds,
      },
      ruleEvaluated,
      status,
      explanation,
      metadata: { booksetTargetMin, booksetTargetMax, inRange },
    };

    const booksetDedupeKey = `${matchId}-${signalType}-${status}-${currentInnings}-${currentOver}-${ballNumber}-${decimalOdds.toFixed(2)}`;
    if (status === 'PASS' && state.firstEntryPosition.status === 'RECORDED_ENTRY') {
      state.firstEntryPosition.status = 'EXIT_CANDIDATE_DETECTED';
      state.firstEntryPosition.booksetSignalId = signal.id;
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

  /**
   * Evaluates Second Entry rule:
   * - Confirmed wicket fell strictly after first entry.
   * - Opposite team odds strictly below 65 paise (decimal < 1.65).
   * - Within entry window (1st inn <= 10.0 ov, 2nd inn <= 6.0 ov).
   */
  public evaluateSecondEntry(params: {
    matchId: string;
    opposingTeamOdds: number | null;
    currentWickets: number;
    currentInnings: number;
    currentOver: number;
    ballNumber?: number;
    measuredTeam: string;
    timestamp?: Date;
  }): StrategySignal {
    const {
      matchId,
      opposingTeamOdds,
      currentWickets,
      currentInnings,
      currentOver,
      ballNumber = 0,
      measuredTeam,
      timestamp = new Date(),
    } = params;

    const state = this.getState(matchId);
    const signalType: SignalType = 'SECOND_ENTRY_CANDIDATE';
    const { maxOpposingOddsExclusive, requiresConfirmedWicket } = this.config.secondEntry;
    const ruleEvaluated = `Second Entry: Requires confirmed wicket after first entry and opposing-team odds strictly below ${maxOpposingOddsExclusive.toFixed(2)}`;

    // Condition 1: Must have a first entry position established to anchor wickets
    const firstPos = state.firstEntryPosition;
    const hasFirstEntry =
      firstPos.status === 'RECORDED_ENTRY' ||
      firstPos.status === 'CANDIDATE_DETECTED' ||
      state.firstEntryTrade !== null ||
      state.stage === 'ACTIVE_FIRST_ENTRY';

    if (!hasFirstEntry) {
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
          decimalOdds: null,
          opposingTeamOdds,
        },
        ruleEvaluated,
        status: 'FAIL',
        explanation: 'Ineligible: Second entry requires a prior first entry to be established.',
        metadata: { hasFirstEntry: false },
      };
    }

    // Condition 2: Wicket condition (must have fallen after first entry)
    const anchorWickets = firstPos.entryWickets ?? state.firstEntryTrade?.entryWickets ?? 0;
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
          decimalOdds: null,
          opposingTeamOdds,
        },
        ruleEvaluated,
        status: 'FAIL',
        explanation: `Wicket requirement not satisfied: Requires confirmed wicket after first entry (Wickets at entry: ${anchorWickets}, Current wickets: ${currentWickets}).`,
        metadata: { anchorWickets, currentWickets, wicketConfirmed: false },
      };
    }

    // Condition 3: Entry window
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
          decimalOdds: null,
          opposingTeamOdds,
        },
        ruleEvaluated,
        status: 'FAIL',
        explanation: `Entry window closed: Over ${currentOver} exceeds maximum allowed over for innings ${currentInnings}.`,
        metadata: { inWindow: false },
      };
    }

    // Condition 4: Opposing odds availability
    if (opposingTeamOdds === null || opposingTeamOdds === undefined || isNaN(opposingTeamOdds)) {
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
          decimalOdds: null,
          opposingTeamOdds: null,
        },
        ruleEvaluated,
        status: 'DATA UNAVAILABLE',
        explanation: 'Opposing-team odds are unavailable or cannot be computed.',
      };
    }

    // Condition 5: Opposing odds must be below 1.65 (< 1.65 / < 65 paise)
    const qualifies = opposingTeamOdds < maxOpposingOddsExclusive;
    const status: SignalStatus = qualifies ? 'PASS' : 'FAIL';
    const explanation = qualifies
      ? `Second-entry candidate detected: Opposing-team odds ${opposingTeamOdds.toFixed(2)} are below ${maxOpposingOddsExclusive.toFixed(2)} following confirmed wicket (${currentWickets} > ${anchorWickets}).`
      : `Opposing-team odds ${opposingTeamOdds.toFixed(2)} are not below ${maxOpposingOddsExclusive.toFixed(2)} (threshold < ${maxOpposingOddsExclusive.toFixed(2)}).`;

    const eventKey = `${matchId}-${signalType}-${currentInnings}-${currentOver}-${opposingTeamOdds.toFixed(2)}`;
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
        decimalOdds: null,
        opposingTeamOdds,
      },
      ruleEvaluated,
      status,
      explanation,
      metadata: {
        opposingTeamOdds,
        maxOpposingOddsExclusive,
        wicketConfirmed,
        currentWickets,
        anchorWickets,
      },
    };

    const secondEntryDedupeKey = `${matchId}-${signalType}-${status}-${currentInnings}-${currentOver}-${ballNumber}-${currentWickets}-${opposingTeamOdds.toFixed(2)}`;
    if (status === 'PASS' && !state.processedEventKeys.has(eventKey)) {
      state.processedEventKeys.add(eventKey);
      state.candidates.unshift(signal);
      if (state.secondEntryPosition.status === 'NONE') {
        state.secondEntryPosition.status = 'CANDIDATE_DETECTED';
        state.secondEntryPosition.candidateSignalId = signal.id;
      }
    }

    if (!state.processedEventKeys.has(secondEntryDedupeKey)) {
      state.processedEventKeys.add(secondEntryDedupeKey);
      state.signalsHistory.unshift(signal);
      if (state.signalsHistory.length > 200) {
        state.signalsHistory.pop();
      }
    }

    state.lastUpdated = new Date();
    return signal;
  }

  /**
   * Evaluates Second Bookset Target (Combined exit for both 1st and 2nd entries):
   * - Opposing team odds reach 85 paise or higher (decimal >= 1.85).
   */
  public evaluateSecondBookset(params: {
    matchId: string;
    opposingTeamOdds: number | null;
    currentInnings: number;
    currentOver: number;
    ballNumber?: number;
    measuredTeam: string;
    timestamp?: Date;
  }): StrategySignal {
    const {
      matchId,
      opposingTeamOdds,
      currentInnings,
      currentOver,
      ballNumber = 0,
      measuredTeam,
      timestamp = new Date(),
    } = params;

    const state = this.getState(matchId);
    const signalType: SignalType = 'SECOND_BOOKSET_TARGET';
    const { minBooksetOpposingOddsInclusive } = this.config.secondEntry;
    const ruleEvaluated = `Second Bookset Target: Opposing-team odds reach ${minBooksetOpposingOddsInclusive.toFixed(2)} or higher`;

    if (opposingTeamOdds === null || opposingTeamOdds === undefined || isNaN(opposingTeamOdds)) {
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
          decimalOdds: null,
          opposingTeamOdds: null,
        },
        ruleEvaluated,
        status: 'DATA UNAVAILABLE',
        explanation: 'Opposing-team odds are unavailable for second bookset evaluation.',
      };
    }

    const qualifies = opposingTeamOdds >= minBooksetOpposingOddsInclusive;
    const status: SignalStatus = qualifies ? 'PASS' : 'FAIL';
    const explanation = qualifies
      ? `Second bookset target reached: Opposing-team odds ${opposingTeamOdds.toFixed(2)} have reached ${minBooksetOpposingOddsInclusive.toFixed(2)} or higher.`
      : `Second bookset not reached: Opposing-team odds ${opposingTeamOdds.toFixed(2)} are below ${minBooksetOpposingOddsInclusive.toFixed(2)}.`;

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
        decimalOdds: null,
        opposingTeamOdds,
      },
      ruleEvaluated,
      status,
      explanation,
      metadata: {
        opposingTeamOdds,
        minBooksetOpposingOddsInclusive,
        qualifies,
      },
    };

    const secondBooksetDedupeKey = `${matchId}-${signalType}-${status}-${currentInnings}-${currentOver}-${ballNumber}-${opposingTeamOdds.toFixed(2)}`;
    if (status === 'PASS' && state.secondEntryPosition.status === 'RECORDED_ENTRY') {
      state.secondEntryPosition.status = 'EXIT_CANDIDATE_DETECTED';
      state.secondEntryPosition.booksetSignalId = signal.id;
    }

    if (!state.processedEventKeys.has(secondBooksetDedupeKey)) {
      state.processedEventKeys.add(secondBooksetDedupeKey);
      state.signalsHistory.unshift(signal);
      if (state.signalsHistory.length > 200) {
        state.signalsHistory.pop();
      }
    }

    state.lastUpdated = new Date();
    return signal;
  }

  /**
   * Main strategy loop: Evaluates live match state, boundary shifts, and trade transitions.
   */
  public evaluateMatch(
    match: ParsedCricketMatch,
    oddsState: MatchOddsState,
    boundaryEvent?: { type: 'FOUR' | 'SIX'; oddsMovement: number },
    options?: { isStale?: boolean }
  ): StrategySignal[] {
    const signals: StrategySignal[] = [];
    const matchId = match.id;
    const state = this.getState(matchId);
    const activeScore = match.team2Score || match.team1Score;
    const currentInnings = match.team2Score ? 2 : 1;
    const currentOver = activeScore ? activeScore.overs : 0;
    const currentBalls = activeScore ? activeScore.ballsInOver : 0;
    const currentWickets = activeScore ? activeScore.wickets : 0;

    // Detect active control and current paise
    const controlInfo = detectTeamInControl(match, oddsState);
    const currControl = controlInfo.teamInControl;
    const currentPaise = controlInfo.currentPaise;
    const decimalOdds = controlInfo.decimalOdds;
    const measuredTeam =
      controlInfo.controlTeamName ||
      (currControl === 'BATTING' ? controlInfo.battingTeamName : controlInfo.bowlingTeamName);

    state.teamInControl = currControl;
    state.battingTeamKey = controlInfo.battingTeamKey;
    state.bowlingTeamKey = controlInfo.bowlingTeamKey;

    // Derived opposing odds
    const opposingTeamOdds = calculateOpposingOdds(decimalOdds);

    // 0. Pre-entry Wicket Safety Filter (>= 3 wickets before entry skips the match)
    const hasAnyEntry =
      state.stage === 'ACTIVE_FIRST_ENTRY' ||
      state.stage === 'ACTIVE_SECOND_ENTRY' ||
      state.stage === 'FIRST_BOOKSET_COMPLETED' ||
      state.stage === 'FULL_BOOKSET_COMPLETED' ||
      state.firstEntryPosition.status === 'RECORDED_ENTRY';

    if (!hasAnyEntry && currentWickets >= this.config.wicketFilter.maxAllowedWicketsBeforeEntry) {
      if (state.stage !== 'DISQUALIFIED_3_WICKETS') {
        state.stage = 'DISQUALIFIED_3_WICKETS';
        const skipSignal: StrategySignal = {
          id: `${matchId}-DISQUALIFIED_WICKET_LIMIT-${Date.now()}`,
          signalType: 'DISQUALIFIED_WICKET_LIMIT',
          matchId,
          timestamp: new Date(),
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
          explanation: `MATCH SKIPPED: ${currentWickets} wickets have fallen before any entry. Strategy skips this match completely.`,
        };
        state.signalsHistory.unshift(skipSignal);
        signals.push(skipSignal);
      }
      return signals;
    }

    // Wicket Tracking Event
    if (state.lastEvaluatedWickets > 0 && currentWickets > state.lastEvaluatedWickets) {
      const prevWickets = state.lastEvaluatedWickets;
      const wicketKey = `${matchId}-WICKET_EVENT-${currentInnings}-${currentOver}.${currentBalls}-${currentWickets}`;
      if (!state.processedEventKeys.has(wicketKey)) {
        state.processedEventKeys.add(wicketKey);
        const wicketSignal: StrategySignal = {
          id: `${matchId}-WICKET_EVENT-${Date.now()}`,
          signalType: 'WICKET_EVENT',
          matchId,
          timestamp: new Date(),
          currentInnings,
          currentOver,
          ballNumber: currentBalls,
          relevantOdds: {
            measuredTeam,
            decimalOdds,
            opposingTeamOdds,
            teamInControl: currControl,
            isStale: options?.isStale,
          },
          ruleEvaluated: 'Confirmed Wicket Event',
          status: 'PASS',
          explanation: `Confirmed wicket: Wickets increased from ${prevWickets} to ${currentWickets} at over ${currentOver}.${currentBalls}.`,
          metadata: { previousWickets: prevWickets, currentWickets },
        };
        state.signalsHistory.unshift(wicketSignal);
        signals.push(wicketSignal);
      }
    } else if (state.lastEvaluatedWickets === 0 && currentWickets > 0) {
      state.lastEvaluatedWickets = currentWickets;
    }

    // Auto-detect boundary from score progression if not explicitly provided
    const currentRuns = activeScore ? activeScore.runs : 0;
    const runsDelta =
      state.lastEvaluatedRuns > 0 && currentOver === state.lastEvaluatedOver && currentBalls !== state.lastEvaluatedBalls
        ? currentRuns - state.lastEvaluatedRuns
        : 0;
    const activeBoundaryType = boundaryEvent
      ? boundaryEvent.type
      : runsDelta === 4
      ? 'FOUR'
      : runsDelta === 6
      ? 'SIX'
      : null;

    // 1. Boundary Abnormal Activity & Booking / Entry Confirmation
    if (activeBoundaryType && currentPaise !== null) {
      const prevControl = state.lastEvaluatedControl;
      const prevPaise = state.lastEvaluatedPaise ?? currentPaise;

      const paiseCalc = calculatePaiseChange(
        prevControl,
        prevPaise,
        currControl,
        currentPaise
      );

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
        teamInControl: currControl,
        customFormulaExplanation: paiseCalc.formula,
      });
      signals.push(abnormalSignal);

      // 1A. BOUNDARY 1: Confirm Booking Team if boundary qualifies, batting is in control, and waiting
      if (
        abnormalSignal.status === 'PASS' &&
        currControl === 'BATTING' &&
        state.stage === 'WAITING_FOR_CONFIRMATION'
      ) {
        state.stage = 'CONFIRMED_BOOKING_TEAM';
        state.bookingTeamName = controlInfo.battingTeamName;
        state.bookingTeamKey = controlInfo.battingTeamKey;
        state.bookingConfirmedBoundary = {
          type: activeBoundaryType,
          over: currentOver,
          ball: currentBalls,
          paiseDelta: paiseCalc.delta,
          timestamp: new Date(),
        };

        const confirmKey = `${matchId}-BOOKING_TEAM_CONFIRMED-${currentInnings}-${currentOver}.${currentBalls}`;
        if (!state.processedEventKeys.has(confirmKey)) {
          state.processedEventKeys.add(confirmKey);
          const confirmSignal: StrategySignal = {
            id: `${matchId}-BOOKING_TEAM_CONFIRMED-${Date.now()}`,
            signalType: 'BOOKING_TEAM_CONFIRMED',
            matchId,
            timestamp: new Date(),
            currentInnings,
            currentOver,
            ballNumber: currentBalls,
            relevantOdds: {
              measuredTeam: controlInfo.battingTeamName,
              teamInControl: 'BATTING',
              decimalOdds,
              currentPaise,
              calculatedDelta: paiseCalc.delta,
            },
            ruleEvaluated: '1st Boundary: Confirm Booking Team with batting in control (4 >= 11p, 6 >= 18p)',
            status: 'PASS',
            explanation: `CONFIRMED BOOKING TEAM: ${controlInfo.battingTeamName} confirmed via 1st ${activeBoundaryType} boundary shift (${paiseCalc.delta} paise >= threshold). Waiting for 2nd boundary to confirm entry.`,
            metadata: {
              formula: paiseCalc.formula,
              bookingTeam: controlInfo.battingTeamName,
            },
          };
          state.signalsHistory.unshift(confirmSignal);
          signals.push(confirmSignal);
        }
      }
      // 1B. BOUNDARY 2: After booking team confirmed, 2nd boundary confirms entry!
      else if (
        abnormalSignal.status === 'PASS' &&
        currControl === 'BATTING' &&
        state.stage === 'CONFIRMED_BOOKING_TEAM' &&
        isWithinEntryWindow(currentInnings, currentOver, this.config)
      ) {
        state.entryConfirmedBoundary = {
          type: activeBoundaryType,
          over: currentOver,
          ball: currentBalls,
          paiseDelta: paiseCalc.delta,
          timestamp: new Date(),
        };

        const entryConfirmKey = `${matchId}-ENTRY_CONFIRMATION_BOUNDARY-${currentInnings}-${currentOver}.${currentBalls}`;
        if (!state.processedEventKeys.has(entryConfirmKey)) {
          state.processedEventKeys.add(entryConfirmKey);
          const boundary2Signal: StrategySignal = {
            id: `${matchId}-ENTRY_CONFIRMATION_BOUNDARY-${Date.now()}`,
            signalType: 'ENTRY_CONFIRMATION_BOUNDARY',
            matchId,
            timestamp: new Date(),
            currentInnings,
            currentOver,
            ballNumber: currentBalls,
            relevantOdds: {
              measuredTeam: controlInfo.battingTeamName,
              teamInControl: 'BATTING',
              decimalOdds,
              currentPaise,
              calculatedDelta: paiseCalc.delta,
            },
            ruleEvaluated: '2nd Boundary: Confirm Entry Eligibility (4 >= 11p, 6 >= 18p with batting in control)',
            status: 'PASS',
            explanation: `2ND BOUNDARY CONFIRMED: ${activeBoundaryType} boundary with ${paiseCalc.delta} paise change confirms entry eligibility! Current odds: ${currentPaise} paise.`,
          };
          state.signalsHistory.unshift(boundary2Signal);
          signals.push(boundary2Signal);
        }

        // Check odds at the time of 2nd boundary
        if (currentPaise >= this.config.firstEntry.minPaise) {
          // If current odds >= 85 paise: Enter immediately!
          state.stage = 'ACTIVE_FIRST_ENTRY';
          state.pending85 = false;
          const matchTitle = match.matchTitlePrefix
            ? `${match.team1.shortName} vs ${match.team2.shortName}`
            : `${match.team1.name || match.team1.shortName} vs ${match.team2.name || match.team2.shortName}`;
          this.recordEntry(
            matchId,
            'FIRST_ENTRY',
            decimalOdds ?? 1 + currentPaise / 100,
            currentInnings,
            currentOver,
            currentWickets,
            new Date(),
            state.bookingTeamName || controlInfo.battingTeamName,
            controlInfo.battingTeamName,
            controlInfo.bowlingTeamName,
            matchTitle,
            match.seriesName
          );

          const triggerSignal: StrategySignal = {
            id: `${matchId}-FIRST_ENTRY_TRIGGER-${Date.now()}`,
            signalType: 'FIRST_ENTRY_TRIGGER',
            matchId,
            timestamp: new Date(),
            currentInnings,
            currentOver,
            ballNumber: currentBalls,
            relevantOdds: {
              measuredTeam: controlInfo.battingTeamName,
              decimalOdds,
              currentPaise,
              teamInControl: 'BATTING',
            },
            ruleEvaluated: 'First Entry: 2nd boundary confirmed and odds >= 85 paise',
            status: 'PASS',
            explanation: `FIRST ENTRY TRIGGERED! 2nd boundary confirmed and batting odds are ${currentPaise} paise (>= 85 paise / ${decimalOdds?.toFixed(2)} decimal). Entry position established and held.`,
          };
          state.signalsHistory.unshift(triggerSignal);
          signals.push(triggerSignal);
        } else {
          // If current odds < 85 paise (e.g. 79 paise): Wait for it to cross 85 with batting in control!
          state.stage = 'CONFIRMED_PENDING_85';
          state.pending85 = true;
          state.firstEntryPosition.status = 'CANDIDATE_DETECTED';
          state.firstEntryPosition.entryOdds = decimalOdds ?? 1 + currentPaise / 100;
          state.firstEntryPosition.entryOver = currentOver;
          state.firstEntryPosition.entryInnings = currentInnings;
          state.firstEntryPosition.entryWickets = currentWickets;
          state.firstEntryPosition.entryTimestamp = new Date();

          const waitingKey = `${matchId}-ENTRY_CONFIRMED_WAITING_85-${currentInnings}-${currentOver}.${currentBalls}`;
          if (!state.processedEventKeys.has(waitingKey)) {
            state.processedEventKeys.add(waitingKey);
            const waitSignal: StrategySignal = {
              id: `${matchId}-ENTRY_CONFIRMED_WAITING_85-${Date.now()}`,
              signalType: 'ENTRY_CONFIRMED_WAITING_85',
              matchId,
              timestamp: new Date(),
              currentInnings,
              currentOver,
              ballNumber: currentBalls,
              relevantOdds: {
                measuredTeam: controlInfo.battingTeamName,
                decimalOdds,
                currentPaise,
                teamInControl: 'BATTING',
              },
              ruleEvaluated: 'Wait for 85 Paise: 2nd boundary confirmed but odds < 85 paise',
              status: 'PASS',
              explanation: `ENTRY CONFIRMED (WAITING FOR 85): 2nd boundary confirmed entry criteria, but current odds are ${currentPaise} paise (< 85). Waiting for odds to cross 85 with ${controlInfo.battingTeamName} in control to enter.`,
            };
            state.signalsHistory.unshift(waitSignal);
            signals.push(waitSignal);
          }
        }
      }
    }

    // 2. Deferred 85-Paise Entry Check: If pending 85, trigger the moment odds cross >= 85 with batting in control
    if (
      state.stage === 'CONFIRMED_PENDING_85' &&
      isWithinEntryWindow(currentInnings, currentOver, this.config) &&
      currentWickets < this.config.wicketFilter.maxAllowedWicketsBeforeEntry &&
      currentPaise !== null &&
      currentPaise >= this.config.firstEntry.minPaise &&
      currControl === 'BATTING'
    ) {
      state.stage = 'ACTIVE_FIRST_ENTRY';
      state.pending85 = false;

      const matchTitle = match.matchTitlePrefix
        ? `${match.team1.shortName} vs ${match.team2.shortName}`
        : `${match.team1.name || match.team1.shortName} vs ${match.team2.name || match.team2.shortName}`;
      this.recordEntry(
        matchId,
        'FIRST_ENTRY',
        decimalOdds ?? 1 + currentPaise / 100,
        currentInnings,
        currentOver,
        currentWickets,
        new Date(),
        state.bookingTeamName || controlInfo.battingTeamName,
        controlInfo.battingTeamName,
        controlInfo.bowlingTeamName,
        matchTitle,
        match.seriesName
      );

      const triggerSignal: StrategySignal = {
        id: `${matchId}-FIRST_ENTRY_TRIGGER-${Date.now()}`,
        signalType: 'FIRST_ENTRY_TRIGGER',
        matchId,
        timestamp: new Date(),
        currentInnings,
        currentOver,
        ballNumber: currentBalls,
        relevantOdds: {
          measuredTeam: controlInfo.battingTeamName,
          decimalOdds,
          currentPaise,
          teamInControl: 'BATTING',
        },
        ruleEvaluated: 'First Entry: Odds crossed >= 85 paise with batting in control after 2nd boundary confirmation',
        status: 'PASS',
        explanation: `FIRST ENTRY TRIGGERED! Batting team crossed ${currentPaise} paise (>= 85 paise / ${decimalOdds?.toFixed(2)} decimal) while in control. Entry position established and held.`,
      };
      state.signalsHistory.unshift(triggerSignal);
      signals.push(triggerSignal);
    }

    // 3. First Entry Candidate Evaluation
    const firstEntrySignal = this.evaluateFirstEntry({
      matchId,
      decimalOdds,
      currentInnings,
      currentOver,
      currentWickets,
      ballNumber: currentBalls,
      measuredTeam,
    });
    signals.push(firstEntrySignal);

    // 4. First Bookset Target (Exit 1: 45 to 55 paise)
    if (state.stage === 'ACTIVE_FIRST_ENTRY' || state.firstEntryPosition.status === 'RECORDED_ENTRY') {
      const firstBooksetSignal = this.evaluateFirstBookset({
        matchId,
        decimalOdds,
        currentInnings,
        currentOver,
        ballNumber: currentBalls,
        measuredTeam,
      });
      signals.push(firstBooksetSignal);

      if (firstBooksetSignal.status === 'PASS') {
        this.recordExit(
          matchId,
          'FIRST_ENTRY',
          decimalOdds ?? 1.5,
          currentOver,
          new Date(),
          'FIRST_BOOKSET_45_55'
        );
      }
    }

    // 5. Second Entry Candidate (Wicket before first bookset + opposing odds < 65)
    if (
      (state.stage === 'ACTIVE_FIRST_ENTRY' ||
        state.firstEntryPosition.status === 'RECORDED_ENTRY') &&
      state.stage !== 'FIRST_BOOKSET_COMPLETED' &&
      state.stage !== 'FULL_BOOKSET_COMPLETED'
    ) {
      const secondEntrySignal = this.evaluateSecondEntry({
        matchId,
        opposingTeamOdds,
        currentWickets,
        currentInnings,
        currentOver,
        ballNumber: currentBalls,
        measuredTeam,
      });
      signals.push(secondEntrySignal);
    }

    // 6. Second / Full Bookset Target (Opposing odds >= 85 paise / 1.85 decimal)
    if (
      state.stage === 'ACTIVE_SECOND_ENTRY' ||
      state.secondEntryPosition.status === 'RECORDED_ENTRY'
    ) {
      const secondBooksetSignal = this.evaluateSecondBookset({
        matchId,
        opposingTeamOdds,
        currentInnings,
        currentOver,
        ballNumber: currentBalls,
        measuredTeam,
      });
      signals.push(secondBooksetSignal);

      if (secondBooksetSignal.status === 'PASS') {
        this.recordExit(
          matchId,
          'SECOND_ENTRY',
          opposingTeamOdds ?? 1.85,
          currentOver,
          new Date(),
          'FULL_BOOKSET_OPPOSING_85'
        );
      }
    }

    state.lastEvaluatedWickets = currentWickets;
    state.lastEvaluatedOver = currentOver;
    state.lastEvaluatedRuns = currentRuns;
    state.lastEvaluatedBalls = currentBalls;
    state.lastEvaluatedOdds = decimalOdds;
    if (currentPaise !== null) {
      state.lastEvaluatedPaise = currentPaise;
    }
    state.lastEvaluatedControl = currControl;
    state.lastUpdated = new Date();

    return signals;
  }
}

// Global default singleton instance
export const strategyEngine = new CricketStrategyEngine();
