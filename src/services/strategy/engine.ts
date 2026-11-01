/**
 * Cricket Trading Strategy Engine (Phase 6)
 *
 * Reusable, pure strategy engine that evaluates:
 * 1. Abnormal Activity on Four (movement >= 0.11) and Six (movement >= 0.18)
 * 2. First Entry (odds 1.85 - 2.00) & First Bookset Target (1.45 - 1.55)
 * 3. Second Entry (confirmed wicket after 1st entry, opposing odds < 1.65) & Second Bookset (opposing odds >= 1.85)
 * 4. Entry Windows (1st inn <= 10 ov, 2nd inn <= 6 ov; exits monitored continuously)
 *
 * Maintains independent state per match and prevents duplicate entries.
 */

import { ParsedCricketMatch } from '../../types/cricket';
import { MatchOddsState } from '../../types/odds';
import {
  SignalType,
  SignalStatus,
  StrategySignal,
  TradePosition,
  PositionType,
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

export class CricketStrategyEngine {
  private config: StrategyConfig;
  private matchStates: Map<string, MatchStrategyState> = new Map();

  constructor(config: Partial<StrategyConfig> = {}) {
    this.config = {
      ...DEFAULT_STRATEGY_CONFIG,
      ...config,
      abnormalActivity: {
        ...DEFAULT_STRATEGY_CONFIG.abnormalActivity,
        ...config.abnormalActivity,
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
      firstEntryPosition: initialFirstPosition,
      secondEntryPosition: initialSecondPosition,
      signalsHistory: [],
      candidates: [],
      lastEvaluatedOver: 0,
      lastEvaluatedWickets: 0,
      lastEvaluatedOdds: null,
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
   * Records an explicit trade entry (distinguishing candidates from actual recorded trades).
   */
  public recordEntry(
    matchId: string,
    positionType: PositionType,
    entryOdds: number,
    innings: number,
    over: number,
    wickets: number,
    timestamp: Date = new Date()
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

    state.lastUpdated = new Date();
    return { ...targetPos };
  }

  /**
   * Records an explicit trade exit / bookset.
   */
  public recordExit(
    matchId: string,
    positionType: PositionType,
    exitOdds: number,
    over: number,
    timestamp: Date = new Date()
  ): TradePosition {
    const state = this.getState(matchId);
    const targetPos =
      positionType === 'FIRST_ENTRY' ? state.firstEntryPosition : state.secondEntryPosition;

    targetPos.status = 'RECORDED_EXIT';
    targetPos.exitOdds = exitOdds;
    targetPos.exitTimestamp = timestamp;
    targetPos.exitOver = over;

    state.lastUpdated = new Date();
    return { ...targetPos };
  }

  /**
   * Evaluates Abnormal Activity rule on a boundary (Four or Six).
   * - Four: Odds movement must be at least 0.11. Movement of 0.10 or less does NOT qualify.
   * - Six: Odds movement must be at least 0.18. Movement of 0.17 or less does NOT qualify.
   */
  public evaluateAbnormalActivity(params: {
    matchId: string;
    boundaryType: 'FOUR' | 'SIX';
    oddsMovement: number;
    currentInnings: number;
    currentOver: number;
    ballNumber?: number;
    measuredTeam: string;
    decimalOdds: number | null;
    previousDecimalOdds?: number | null;
    timestamp?: Date;
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
    } = params;

    const state = this.getState(matchId);
    const signalType: SignalType =
      boundaryType === 'FOUR' ? 'ABNORMAL_ACTIVITY_FOUR' : 'ABNORMAL_ACTIVITY_SIX';
    const minThreshold =
      boundaryType === 'FOUR'
        ? this.config.abnormalActivity.fourMinMovement
        : this.config.abnormalActivity.sixMinMovement;

    const ruleEvaluated =
      boundaryType === 'FOUR'
        ? `Abnormal Activity Four: Odds movement must be at least ${minThreshold.toFixed(2)} (<= 0.10 fails)`
        : `Abnormal Activity Six: Odds movement must be at least ${minThreshold.toFixed(2)} (<= 0.17 fails)`;

    // Check for missing data
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
          decimalOdds,
          previousDecimalOdds,
          oddsDelta: null,
        },
        ruleEvaluated,
        status: 'DATA UNAVAILABLE',
        explanation: `Odds movement data is not available for ${boundaryType} boundary.`,
      };
    }

    // Using precision rounding to avoid floating point anomalies (e.g. 0.10000000000000009)
    const normalizedMovement = Number(Math.abs(oddsMovement).toFixed(4));
    const qualifies = normalizedMovement >= minThreshold;
    const status: SignalStatus = qualifies ? 'PASS' : 'FAIL';

    const explanation = qualifies
      ? `QUALIFIED: ${boundaryType} odds movement of ${normalizedMovement.toFixed(2)} meets threshold >= ${minThreshold.toFixed(2)}.`
      : `FAILED: ${boundaryType} odds movement of ${normalizedMovement.toFixed(2)} does not meet threshold >= ${minThreshold.toFixed(2)}.`;

    const signal: StrategySignal = {
      id: `${matchId}-${signalType}-${currentInnings}-${currentOver}-${ballNumber}-${normalizedMovement}`,
      signalType,
      matchId,
      timestamp,
      currentInnings,
      currentOver,
      ballNumber,
      relevantOdds: {
        measuredTeam,
        decimalOdds,
        previousDecimalOdds,
        oddsDelta: normalizedMovement,
      },
      ruleEvaluated,
      status,
      explanation,
      metadata: {
        boundaryType,
        minThreshold,
        observedMovement: normalizedMovement,
      },
    };

    const abnormalDedupeKey = `${matchId}-${signalType}-${status}-${currentInnings}-${currentOver}-${ballNumber}-${normalizedMovement}`;
    if (!state.processedEventKeys.has(abnormalDedupeKey)) {
      state.processedEventKeys.add(abnormalDedupeKey);
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
   * - Entry odds range: 1.85 to 2.00 (inclusive).
   * - Entry window: 1st innings <= 10.0 overs; 2nd innings <= 6.0 overs.
   */
  public evaluateFirstEntry(params: {
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
    const signalType: SignalType = 'FIRST_ENTRY_CANDIDATE';
    const { minOdds, maxOdds } = this.config.firstEntry;
    const ruleEvaluated = `First Entry: Odds must be within ${minOdds.toFixed(2)} to ${maxOdds.toFixed(2)} during entry window (Inn 1 <= ${this.config.entryWindows.firstInningsMaxOver} ov, Inn 2 <= ${this.config.entryWindows.secondInningsMaxOver} ov)`;

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

    // Prevent duplicate recording of the exact same event
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
   * - Target range: 1.45 to 1.55 (inclusive).
   * - Monitors existing positions even after entry window closes.
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
    const { booksetTargetMin, booksetTargetMax } = this.config.firstEntry;
    const ruleEvaluated = `First Bookset Target: Odds reach target range ${booksetTargetMin.toFixed(2)} to ${booksetTargetMax.toFixed(2)}`;

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
   * - Requires a confirmed wicket strictly after the first entry.
   * - Second-entry candidate when opposing-team odds are below 1.65 (< 1.65).
   * - Window: 1st innings <= 10.0 ov; 2nd innings <= 6.0 ov.
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

    // Condition 1: Must have a first entry position established to establish anchor wickets
    const firstPos = state.firstEntryPosition;
    const hasFirstEntry =
      firstPos.status === 'RECORDED_ENTRY' || firstPos.status === 'CANDIDATE_DETECTED';

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
    const anchorWickets = firstPos.entryWickets ?? 0;
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

    // Condition 5: Opposing odds must be below 1.65 (< 1.65)
    // 1.64 PASS, 1.65 FAIL, 1.66 FAIL
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
   * Evaluates Second Bookset Target:
   * - Second-entry bookset when opposing-team odds reach 1.85 or higher (>= 1.85).
   * - 1.84 FAIL, 1.85 PASS, 1.86 PASS.
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
   * High-level coordinator method to evaluate all relevant rules for a live match tick.
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

    const bookmaker = oddsState?.odds?.bookmaker;
    const decimalOdds = bookmaker?.decimalBack ?? null;
    const measuredTeam =
      oddsState?.odds?.favoriteTeamName ||
      match.winProbability?.favoriteTeamKey ||
      match.team1.shortName;

    // Derived opposing odds
    const opposingTeamOdds = calculateOpposingOdds(decimalOdds);

    // Wicket Tracking Event (Requirement 8: Record confirmed wickets)
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
            isStale: options?.isStale,
          },
          ruleEvaluated: 'Confirmed Wicket Event',
          status: 'PASS',
          explanation: `Confirmed wicket: Wickets increased from ${prevWickets} to ${currentWickets} at over ${currentOver}.${currentBalls}. Opposing-entry wicket condition is now unlocked.`,
          metadata: {
            previousWickets: prevWickets,
            currentWickets,
          },
        };
        state.signalsHistory.unshift(wicketSignal);
        signals.push(wicketSignal);
      }
    } else if (state.lastEvaluatedWickets === 0 && currentWickets > 0) {
      // Initialize on first tick without firing false past wicket event
      state.lastEvaluatedWickets = currentWickets;
    }

    state.lastEvaluatedWickets = currentWickets;
    state.lastEvaluatedOver = currentOver;
    state.lastEvaluatedOdds = decimalOdds;
    state.lastUpdated = new Date();

    // 1. Boundary Abnormal Activity (if triggered by event)
    if (boundaryEvent) {
      const abnormalSignal = this.evaluateAbnormalActivity({
        matchId,
        boundaryType: boundaryEvent.type,
        oddsMovement: boundaryEvent.oddsMovement,
        currentInnings,
        currentOver,
        ballNumber: currentBalls,
        measuredTeam,
        decimalOdds,
        previousDecimalOdds: oddsState?.previousOdds?.bookmaker?.decimalBack ?? null,
      });
      signals.push(abnormalSignal);
    }

    // 2. First Entry Candidate
    const firstEntrySignal = this.evaluateFirstEntry({
      matchId,
      decimalOdds,
      currentInnings,
      currentOver,
      ballNumber: currentBalls,
      measuredTeam,
    });
    signals.push(firstEntrySignal);

    // 3. First Bookset Target (Exit)
    const firstBooksetSignal = this.evaluateFirstBookset({
      matchId,
      decimalOdds,
      currentInnings,
      currentOver,
      ballNumber: currentBalls,
      measuredTeam,
    });
    signals.push(firstBooksetSignal);

    // 4. Second Entry Candidate
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

    // 5. Second Bookset Target (Exit)
    const secondBooksetSignal = this.evaluateSecondBookset({
      matchId,
      opposingTeamOdds,
      currentInnings,
      currentOver,
      ballNumber: currentBalls,
      measuredTeam,
    });
    signals.push(secondBooksetSignal);

    return signals;
  }
}

// Global default singleton instance
export const strategyEngine = new CricketStrategyEngine();
