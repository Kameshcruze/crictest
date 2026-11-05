/**
 * Unit Tests for Cricket Trading Strategy Engine (Phase 6)
 *
 * Verifies all threshold boundaries, innings-window restrictions,
 * wicket-dependent second entries, duplicate prevention, and position tracking.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CricketStrategyEngine,
  calculateOpposingOdds,
  isWithinEntryWindow,
  calculatePaiseChange,
  detectTeamInControl,
} from '../index';

describe('Cricket Trading Strategy Engine - Boundary & Rules Suite', () => {
  let engine: CricketStrategyEngine;
  const MATCH_ID = 'TEST_MATCH_001';

  beforeEach(() => {
    engine = new CricketStrategyEngine();
  });

  // =========================================================================
  // 1. ABNORMAL ACTIVITY THRESHOLDS (FOUR & SIX)
  // =========================================================================
  describe('Abnormal Activity Threshold Boundaries', () => {
    it('Four: movement of 0.10 does NOT qualify (FAIL)', () => {
      const signal = engine.evaluateAbnormalActivity({
        matchId: MATCH_ID,
        boundaryType: 'FOUR',
        oddsMovement: 0.10,
        currentInnings: 1,
        currentOver: 4.2,
        measuredTeam: 'India',
        decimalOdds: 1.80,
      });

      assert.equal(signal.status, 'FAIL');
      assert.equal(signal.signalType, 'ABNORMAL_ACTIVITY_FOUR');
      assert.match(signal.explanation, /FAILED: FOUR odds movement of 0.10 does not meet threshold >= 0.11/);
    });

    it('Four: movement of 0.11 DOES qualify (PASS)', () => {
      const signal = engine.evaluateAbnormalActivity({
        matchId: MATCH_ID,
        boundaryType: 'FOUR',
        oddsMovement: 0.11,
        currentInnings: 1,
        currentOver: 4.3,
        measuredTeam: 'India',
        decimalOdds: 1.70,
      });

      assert.equal(signal.status, 'PASS');
      assert.equal(signal.signalType, 'ABNORMAL_ACTIVITY_FOUR');
      assert.match(signal.explanation, /QUALIFIED: FOUR odds movement of 0.11 meets threshold >= 0.11/);
    });

    it('Six: movement of 0.17 does NOT qualify (FAIL)', () => {
      const signal = engine.evaluateAbnormalActivity({
        matchId: MATCH_ID,
        boundaryType: 'SIX',
        oddsMovement: 0.17,
        currentInnings: 1,
        currentOver: 7.1,
        measuredTeam: 'India',
        decimalOdds: 1.85,
      });

      assert.equal(signal.status, 'FAIL');
      assert.equal(signal.signalType, 'ABNORMAL_ACTIVITY_SIX');
      assert.match(signal.explanation, /FAILED: SIX odds movement of 0.17 does not meet threshold >= 0.18/);
    });

    it('Six: movement of 0.18 DOES qualify (PASS)', () => {
      const signal = engine.evaluateAbnormalActivity({
        matchId: MATCH_ID,
        boundaryType: 'SIX',
        oddsMovement: 0.18,
        currentInnings: 1,
        currentOver: 7.2,
        measuredTeam: 'India',
        decimalOdds: 1.65,
      });

      assert.equal(signal.status, 'PASS');
      assert.equal(signal.signalType, 'ABNORMAL_ACTIVITY_SIX');
      assert.match(signal.explanation, /QUALIFIED: SIX odds movement of 0.18 meets threshold >= 0.18/);
    });
  });

  // =========================================================================
  // 2. FIRST ENTRY ODDS THRESHOLDS (1.84, 1.85, 2.00, 2.01)
  // =========================================================================
  describe('First Entry Odds Range Boundaries [1.85, 2.00]', () => {
    it('First entry at 1.84 fails (below 1.85 min threshold)', () => {
      const signal = engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 1.84,
        currentInnings: 1,
        currentOver: 3.5,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'FAIL');
      assert.equal(signal.signalType, 'FIRST_ENTRY_CANDIDATE');
      assert.match(signal.explanation, /below the minimum entry threshold of 1.85/);
    });

    it('First entry at 1.85 passes (exact lower boundary)', () => {
      const signal = engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 1.85,
        currentInnings: 1,
        currentOver: 4.0,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'PASS');
      assert.equal(signal.signalType, 'FIRST_ENTRY_CANDIDATE');
      assert.match(signal.explanation, /within the qualifying range \[1.85 - 2.00\]/);
    });

    it('First entry at 2.00 passes (exact upper boundary)', () => {
      const signal = engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 2.00,
        currentInnings: 1,
        currentOver: 5.0,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'PASS');
      assert.equal(signal.signalType, 'FIRST_ENTRY_CANDIDATE');
      assert.match(signal.explanation, /within the qualifying range \[1.85 - 2.00\]/);
    });

    it('First entry at 2.01 fails (above 2.00 max threshold)', () => {
      const signal = engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 2.01,
        currentInnings: 1,
        currentOver: 5.1,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'FAIL');
      assert.equal(signal.signalType, 'FIRST_ENTRY_CANDIDATE');
      assert.match(signal.explanation, /exceed the maximum entry threshold of 2.00/);
    });
  });

  // =========================================================================
  // 3. FIRST BOOKSET TARGET RANGE [1.45, 1.55]
  // =========================================================================
  describe('First Bookset Target Range [1.45, 1.55]', () => {
    it('First bookset at 1.45 passes (lower boundary)', () => {
      const signal = engine.evaluateFirstBookset({
        matchId: MATCH_ID,
        decimalOdds: 1.45,
        currentInnings: 1,
        currentOver: 8.0,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'PASS');
      assert.equal(signal.signalType, 'FIRST_BOOKSET_TARGET');
    });

    it('First bookset at 1.55 passes (upper boundary)', () => {
      const signal = engine.evaluateFirstBookset({
        matchId: MATCH_ID,
        decimalOdds: 1.55,
        currentInnings: 1,
        currentOver: 8.2,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'PASS');
      assert.equal(signal.signalType, 'FIRST_BOOKSET_TARGET');
    });

    it('First bookset at 1.56 fails (outside range)', () => {
      const signal = engine.evaluateFirstBookset({
        matchId: MATCH_ID,
        decimalOdds: 1.56,
        currentInnings: 1,
        currentOver: 8.3,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'FAIL');
    });
  });

  // =========================================================================
  // 4. SECOND ENTRY OPPOSING-ODDS THRESHOLDS (1.64, 1.65, 1.66)
  // =========================================================================
  describe('Second Entry Opposing-Odds Thresholds (< 1.65 strictly)', () => {
    beforeEach(() => {
      // Establish first entry at 1 wicket
      engine.recordEntry(MATCH_ID, 'FIRST_ENTRY', 1.90, 1, 4.0, 1);
    });

    it('Second entry at opposing odds 1.64 passes (< 1.65 with wicket confirmed)', () => {
      const signal = engine.evaluateSecondEntry({
        matchId: MATCH_ID,
        opposingTeamOdds: 1.64,
        currentWickets: 2, // 2 > 1 (wicket confirmed!)
        currentInnings: 1,
        currentOver: 6.0,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'PASS');
      assert.equal(signal.signalType, 'SECOND_ENTRY_CANDIDATE');
      assert.match(signal.explanation, /below 1.65 following confirmed wicket/);
    });

    it('Second entry at opposing odds 1.65 fails (not strictly below 1.65)', () => {
      const signal = engine.evaluateSecondEntry({
        matchId: MATCH_ID,
        opposingTeamOdds: 1.65,
        currentWickets: 2,
        currentInnings: 1,
        currentOver: 6.1,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'FAIL');
      assert.match(signal.explanation, /not below 1.65/);
    });

    it('Second entry at opposing odds 1.66 fails (above 1.65)', () => {
      const signal = engine.evaluateSecondEntry({
        matchId: MATCH_ID,
        opposingTeamOdds: 1.66,
        currentWickets: 2,
        currentInnings: 1,
        currentOver: 6.2,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'FAIL');
      assert.match(signal.explanation, /not below 1.65/);
    });
  });

  // =========================================================================
  // 5. SECOND BOOKSET OPPOSING-ODDS THRESHOLDS (1.84, 1.85, 1.86)
  // =========================================================================
  describe('Second Bookset Opposing-Odds Thresholds (>= 1.85)', () => {
    it('Second bookset at opposing odds 1.84 fails (below 1.85 threshold)', () => {
      const signal = engine.evaluateSecondBookset({
        matchId: MATCH_ID,
        opposingTeamOdds: 1.84,
        currentInnings: 1,
        currentOver: 8.0,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'FAIL');
      assert.equal(signal.signalType, 'SECOND_BOOKSET_TARGET');
      assert.match(signal.explanation, /below 1.85/);
    });

    it('Second bookset at opposing odds 1.85 passes (exact lower boundary)', () => {
      const signal = engine.evaluateSecondBookset({
        matchId: MATCH_ID,
        opposingTeamOdds: 1.85,
        currentInnings: 1,
        currentOver: 8.1,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'PASS');
      assert.equal(signal.signalType, 'SECOND_BOOKSET_TARGET');
      assert.match(signal.explanation, /reached 1.85 or higher/);
    });

    it('Second bookset at opposing odds 1.86 passes (above 1.85)', () => {
      const signal = engine.evaluateSecondBookset({
        matchId: MATCH_ID,
        opposingTeamOdds: 1.86,
        currentInnings: 1,
        currentOver: 8.2,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'PASS');
      assert.equal(signal.signalType, 'SECOND_BOOKSET_TARGET');
      assert.match(signal.explanation, /reached 1.85 or higher/);
    });
  });

  // =========================================================================
  // 6. INNINGS-WINDOW RESTRICTIONS
  // =========================================================================
  describe('Innings-Window Restrictions (1st inn <= 10 ov, 2nd inn <= 6 ov)', () => {
    it('First innings: at 10.0 overs passes entry window', () => {
      assert.equal(isWithinEntryWindow(1, 10.0), true);

      const signal = engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 1.90,
        currentInnings: 1,
        currentOver: 10.0,
        measuredTeam: 'India',
      });
      assert.equal(signal.status, 'PASS');
    });

    it('First innings: at 10.1 overs fails entry window (closed)', () => {
      assert.equal(isWithinEntryWindow(1, 10.1), false);

      const signal = engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 1.90,
        currentInnings: 1,
        currentOver: 10.1,
        measuredTeam: 'India',
      });
      assert.equal(signal.status, 'FAIL');
      assert.match(signal.explanation, /Entry window closed/);
    });

    it('Second innings: at 6.0 overs passes entry window', () => {
      assert.equal(isWithinEntryWindow(2, 6.0), true);

      const signal = engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 1.92,
        currentInnings: 2,
        currentOver: 6.0,
        measuredTeam: 'India',
      });
      assert.equal(signal.status, 'PASS');
    });

    it('Second innings: at 6.1 overs fails entry window (closed)', () => {
      assert.equal(isWithinEntryWindow(2, 6.1), false);

      const signal = engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 1.92,
        currentInnings: 2,
        currentOver: 6.1,
        measuredTeam: 'India',
      });
      assert.equal(signal.status, 'FAIL');
      assert.match(signal.explanation, /Entry window closed/);
    });

    it('Existing positions continue monitoring exit/bookset after window closed', () => {
      // First bookset evaluated at 14.2 overs (well past the 10.0 ov entry window)
      const exitSignal = engine.evaluateFirstBookset({
        matchId: MATCH_ID,
        decimalOdds: 1.50,
        currentInnings: 1,
        currentOver: 14.2,
        measuredTeam: 'India',
      });

      assert.equal(exitSignal.status, 'PASS');
      assert.equal(exitSignal.signalType, 'FIRST_BOOKSET_TARGET');
    });
  });

  // =========================================================================
  // 7. WICKET-DEPENDENT SECOND ENTRIES
  // =========================================================================
  describe('Wicket-Dependent Second Entries', () => {
    it('Rejects second entry when no first entry exists', () => {
      const signal = engine.evaluateSecondEntry({
        matchId: MATCH_ID,
        opposingTeamOdds: 1.60,
        currentWickets: 3,
        currentInnings: 1,
        currentOver: 5.0,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'FAIL');
      assert.match(signal.explanation, /requires a prior first entry/);
    });

    it('Rejects second entry when wickets have NOT increased since first entry', () => {
      // Recorded at 2 wickets
      engine.recordEntry(MATCH_ID, 'FIRST_ENTRY', 1.90, 1, 3.0, 2);

      // Now evaluating at 2 wickets (0 wickets fallen since first entry)
      const signal = engine.evaluateSecondEntry({
        matchId: MATCH_ID,
        opposingTeamOdds: 1.60,
        currentWickets: 2,
        currentInnings: 1,
        currentOver: 4.0,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'FAIL');
      assert.match(signal.explanation, /Requires confirmed wicket after first entry/);
    });

    it('Accepts second entry when 1+ wickets have fallen after first entry', () => {
      // Recorded at 2 wickets
      engine.recordEntry(MATCH_ID, 'FIRST_ENTRY', 1.90, 1, 3.0, 2);

      // Evaluating at 3 wickets (1 wicket fell!)
      const signal = engine.evaluateSecondEntry({
        matchId: MATCH_ID,
        opposingTeamOdds: 1.62,
        currentWickets: 3,
        currentInnings: 1,
        currentOver: 5.0,
        measuredTeam: 'India',
      });

      assert.equal(signal.status, 'PASS');
      assert.match(signal.explanation, /following confirmed wicket \(3 > 2\)/);
    });
  });

  // =========================================================================
  // 8. CANDIDATE VS RECORDED TRADE DISTINCTION & MULTI-MATCH ISOLATION
  // =========================================================================
  describe('Candidate vs Recorded Trade & Multi-Match State Isolation', () => {
    it('Emitting a candidate does NOT mark position as RECORDED_ENTRY', () => {
      engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 1.95,
        currentInnings: 1,
        currentOver: 3.0,
        measuredTeam: 'India',
      });

      const state = engine.getState(MATCH_ID);
      assert.equal(state.firstEntryPosition.status, 'CANDIDATE_DETECTED');
      assert.notEqual(state.firstEntryPosition.status, 'RECORDED_ENTRY');
      assert.equal(state.candidates.length, 1);
    });

    it('Explicit recordEntry changes status to RECORDED_ENTRY with anchor data', () => {
      const pos = engine.recordEntry(MATCH_ID, 'FIRST_ENTRY', 1.95, 1, 3.0, 1);
      assert.equal(pos.status, 'RECORDED_ENTRY');
      assert.equal(pos.entryOdds, 1.95);
      assert.equal(pos.entryWickets, 1);

      const state = engine.getState(MATCH_ID);
      assert.equal(state.firstEntryPosition.status, 'RECORDED_ENTRY');
    });

    it('Different matches maintain completely isolated strategy states', () => {
      const MATCH_A = 'MATCH_AAA';
      const MATCH_B = 'MATCH_BBB';

      engine.recordEntry(MATCH_A, 'FIRST_ENTRY', 1.92, 1, 4.0, 2);

      const stateA = engine.getState(MATCH_A);
      const stateB = engine.getState(MATCH_B);

      assert.equal(stateA.firstEntryPosition.status, 'RECORDED_ENTRY');
      assert.equal(stateB.firstEntryPosition.status, 'NONE');
    });

    it('Duplicate prevention prevents multiple candidates for identical event', () => {
      engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 1.95,
        currentInnings: 1,
        currentOver: 3.0,
        measuredTeam: 'India',
      });

      // Same event evaluated again
      engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 1.95,
        currentInnings: 1,
        currentOver: 3.0,
        measuredTeam: 'India',
      });

      const state = engine.getState(MATCH_ID);
      assert.equal(state.candidates.length, 1);
    });
  });

  // =========================================================================
  // 9. OPPOSING ODDS CALCULATION UTILITY
  // =========================================================================
  describe('Opposing Odds Complementary Derivation', () => {
    it('Calculates complementary opposing odds correctly', () => {
      // Favorite at 2.60: probA = 1/2.60 = 0.3846. probB = 0.6154. opposing = 1/0.6154 = 1.63
      const opp1 = calculateOpposingOdds(2.60);
      assert.equal(opp1, 1.63);

      // Favorite at 2.00: probA = 0.50. probB = 0.50. opposing = 2.00
      const opp2 = calculateOpposingOdds(2.00);
      assert.equal(opp2, 2.00);

      // Invalid or null odds
      assert.equal(calculateOpposingOdds(null), null);
      assert.equal(calculateOpposingOdds(0), null);
    });
  });

  // =========================================================================
  // 10. PHASE 7 REAL-TIME STREAMING, WICKET TRACKING & REJECTED CONDITIONS
  // =========================================================================
  describe('Phase 7 Streaming, Wicket Tracking & Duplicate Prevention', () => {
    const mockMatch = (wickets: number, overs: number): any => ({
      id: 'MATCH_P7_01',
      status: 'live',
      seriesName: 'IPL 2026',
      venueName: 'Wankhede',
      format: 'T20',
      team1: { key: 'MI', name: 'Mumbai Indians', shortName: 'MI' },
      team2: { key: 'CSK', name: 'Chennai Super Kings', shortName: 'CSK' },
      team1Score: { runs: 120, wickets, overs, ballsInOver: 0, scoreString: `120/${wickets}` },
    });

    const mockOdds = (decimalBack: number): any => ({
      matchId: 'MATCH_P7_01',
      oddsKey: 'MATCH_P7_01',
      maskedKey: 'MAT***01',
      status: 'success',
      recordsCount: 1,
      lastUpdated: new Date(),
      odds: {
        matchKey: 'MATCH_P7_01',
        bookmaker: {
          rawRateString: `${Math.round((decimalBack - 1) * 100)}+1`,
          backRate: Math.round((decimalBack - 1) * 100),
          layRate: Math.round((decimalBack - 1) * 100) + 1,
          decimalBack,
          decimalLay: Number((decimalBack + 0.01).toFixed(2)),
          spread: 1,
          isSuspended: false,
        },
      },
    });

    it('Records confirmed wicket when wickets increase during match updates', () => {
      // First tick at 1 wicket
      engine.evaluateMatch(mockMatch(1, 4.0), mockOdds(1.90));
      const state1 = engine.getState('MATCH_P7_01');
      assert.equal(state1.lastEvaluatedWickets, 1);

      // Second tick: wicket falls (1 -> 2 wickets)
      const tick2Signals = engine.evaluateMatch(mockMatch(2, 4.2), mockOdds(1.92));
      const wicketSignal = tick2Signals.find((s) => s.signalType === 'WICKET_EVENT');

      assert.ok(wicketSignal, 'Wicket event signal should be emitted');
      assert.equal(wicketSignal.status, 'PASS');
      assert.match(wicketSignal.explanation, /Confirmed wicket: Wickets increased from 1 to 2/);
    });

    it('Prevents duplicate signal spam when identical data is evaluated multiple times', () => {
      // First evaluation tick
      engine.evaluateMatch(mockMatch(2, 5.0), mockOdds(1.92));
      const state = engine.getState('MATCH_P7_01');
      const countAfterFirst = state.signalsHistory.length;

      // Repeat identical tick (same score, same odds)
      engine.evaluateMatch(mockMatch(2, 5.0), mockOdds(1.92));
      assert.equal(
        state.signalsHistory.length,
        countAfterFirst,
        'Signal history length must not increase on identical data tick'
      );
    });

    it('Records rejected conditions with clear reasons in signal history', () => {
      // Odds 2.20 exceeds max 2.00
      engine.evaluateFirstEntry({
        matchId: 'MATCH_P7_REJECT',
        decimalOdds: 2.20,
        currentInnings: 1,
        currentOver: 3.0,
        measuredTeam: 'India',
      });

      const state = engine.getState('MATCH_P7_REJECT');
      const rejectSignal = state.signalsHistory.find(
        (s) => s.signalType === 'FIRST_ENTRY_CANDIDATE' && s.status === 'FAIL'
      );

      assert.ok(rejectSignal, 'Rejected signal should be preserved in signals history');
      assert.match(rejectSignal.explanation, /exceed the maximum entry threshold of 2.00/);
    });
  });

  // =========================================================================
  // 11. REFINED ABNORMAL ACTIVITY FORMULA & BOOKING TEAM STRATEGY SUITE
  // =========================================================================
  describe('Refined Abnormal Activity Formula & Booking Team Suite', () => {
    it('Flip formula: Bowling at 80 paise -> Batting at 95 paise calculates to 25 paise', () => {
      // User specified example:
      // "before the 4 ball if the bowling team was in control with 80 paisa, after hitting 4
      // the point changes to 95 with batting team in control then the diference should be calculated as
      // (100-80)+(100-95) so the value will be 25 which is confirmation."
      const result = calculatePaiseChange('BOWLING', 80, 'BATTING', 95);
      assert.equal(result.delta, 25);
      assert.equal(result.qualifiesBattingControl, true);
      assert.match(result.formula, /\(100 - 80\) \+ \(100 - 95\) = 20 \+ 5 = 25 paise/);

      // 25 paise >= 11 on Four -> qualifies!
      const fourSignal = engine.evaluateAbnormalActivity({
        matchId: 'MATCH_FLIP_01',
        boundaryType: 'FOUR',
        oddsMovement: result.delta,
        currentInnings: 1,
        currentOver: 2.4,
        measuredTeam: 'Adelaide Strikers Women',
        decimalOdds: 1.95,
        customFormulaExplanation: result.formula,
      });
      assert.equal(fourSignal.status, 'PASS');
      assert.match(fourSignal.explanation, /QUALIFIED: FOUR change of 25 paise/);
    });

    it('Same control: Batting at 90 paise to Batting at 78 paise calculates absolute difference of 12 paise', () => {
      const result = calculatePaiseChange('BATTING', 90, 'BATTING', 78);
      assert.equal(result.delta, 12);
      assert.equal(result.qualifiesBattingControl, true);

      // 12 paise >= 11 on Four -> passes
      const fourSignal = engine.evaluateAbnormalActivity({
        matchId: 'MATCH_SAME_01',
        boundaryType: 'FOUR',
        oddsMovement: result.delta,
        currentInnings: 1,
        currentOver: 3.1,
        measuredTeam: 'Adelaide Strikers Women',
        decimalOdds: 1.78,
      });
      assert.equal(fourSignal.status, 'PASS');

      // 12 paise < 18 on Six -> fails
      const sixSignal = engine.evaluateAbnormalActivity({
        matchId: 'MATCH_SAME_01',
        boundaryType: 'SIX',
        oddsMovement: result.delta,
        currentInnings: 1,
        currentOver: 3.2,
        measuredTeam: 'Adelaide Strikers Women',
        decimalOdds: 1.78,
      });
      assert.equal(sixSignal.status, 'FAIL');
    });

    it('Wicket safety filter: skips match if >= 3 wickets before entry', () => {
      const signal = engine.evaluateFirstEntry({
        matchId: 'MATCH_3WKT_01',
        decimalOdds: 1.90,
        currentInnings: 1,
        currentOver: 4.0,
        currentWickets: 3, // 3 wickets
        measuredTeam: 'Adelaide Strikers Women',
      });

      assert.equal(signal.status, 'FAIL');
      assert.equal(signal.signalType, 'DISQUALIFIED_WICKET_LIMIT');
      assert.match(signal.explanation, /SKIPPED MATCH: 3 wickets have fallen before entry/);

      const state = engine.getState('MATCH_3WKT_01');
      assert.equal(state.stage, 'DISQUALIFIED_3_WICKETS');
    });

    it('Hold State: First entry is held and duplicate signals are not emitted', () => {
      const matchId = 'MATCH_HOLD_01';
      // Record entry
      engine.recordEntry(matchId, 'FIRST_ENTRY', 1.88, 1, 4.2, 1, new Date());
      const state = engine.getState(matchId);

      assert.equal(state.stage, 'ACTIVE_FIRST_ENTRY');
      assert.equal(state.firstEntryPosition.status, 'RECORDED_ENTRY');
      assert.ok(state.firstEntryTrade, 'Trade record should be created');
      assert.equal(state.firstEntryTrade?.status, 'ACTIVE');
      assert.equal(state.firstEntryTrade?.entryDecimal, 1.88);

      // First bookset triggers at 1.50 (in [1.45, 1.55] / 45-55 paise)
      const booksetSignal = engine.evaluateFirstBookset({
        matchId,
        decimalOdds: 1.50,
        currentInnings: 1,
        currentOver: 7.0,
        measuredTeam: 'Adelaide Strikers Women',
      });
      assert.equal(booksetSignal.status, 'PASS');

      // Record exit closes trade
      engine.recordExit(matchId, 'FIRST_ENTRY', 1.50, 7.0, new Date(), 'FIRST_BOOKSET_45_55');
      assert.equal(state.stage, 'FIRST_BOOKSET_COMPLETED');
      assert.equal(state.firstEntryTrade?.status, 'BOOKSET_COMPLETED');
      assert.equal(state.firstEntryTrade?.exitReason, 'FIRST_BOOKSET_45_55');
    });

    it('Full cycle with second entry and full bookset at >= 85 paise', () => {
      const matchId = 'MATCH_SECOND_CYCLE_01';
      // 1. Establish First Entry at 1 wicket
      engine.recordEntry(matchId, 'FIRST_ENTRY', 1.90, 1, 3.5, 1, new Date());

      // 2. Wicket falls (1 -> 2 wickets), opposite team drops < 1.65 (e.g. 1.60)
      const secondSignal = engine.evaluateSecondEntry({
        matchId,
        opposingTeamOdds: 1.60,
        currentWickets: 2,
        currentInnings: 1,
        currentOver: 4.1,
        measuredTeam: 'Adelaide Strikers Women',
      });
      assert.equal(secondSignal.status, 'PASS');

      // Record second entry
      engine.recordEntry(matchId, 'SECOND_ENTRY', 1.60, 1, 4.1, 2, new Date());
      const state = engine.getState(matchId);
      assert.equal(state.stage, 'ACTIVE_SECOND_ENTRY');
      assert.equal(state.secondEntryTrade?.status, 'ACTIVE');

      // 3. Opposite team odds reach >= 1.85 (e.g. 1.88) -> Full Bookset
      const fullBooksetSignal = engine.evaluateSecondBookset({
        matchId,
        opposingTeamOdds: 1.88,
        currentInnings: 1,
        currentOver: 8.0,
        measuredTeam: 'Adelaide Strikers Women',
      });
      assert.equal(fullBooksetSignal.status, 'PASS');

      // Record full exit
      engine.recordExit(matchId, 'SECOND_ENTRY', 1.88, 8.0, new Date(), 'FULL_BOOKSET_OPPOSING_85');
      assert.equal(state.stage, 'FULL_BOOKSET_COMPLETED');
      assert.equal(state.secondEntryTrade?.status, 'BOOKSET_COMPLETED');
      assert.equal(state.firstEntryTrade?.status, 'BOOKSET_COMPLETED');
    });

    it('Exact User Sequence: 1st boundary confirms booking team, 2nd boundary confirms entry at 79 paise, waits until crossing 85 with batting in control', () => {
      const matchId = 'MATCH_USER_FLOW_79_85';

      const mockMatch = (overs: number, runs: number): any => ({
        id: matchId,
        format: 'T20',
        status: 'live',
        team1: { key: 'ADS-W', name: 'Adelaide Strikers Women', shortName: 'ADS-W' },
        team2: { key: 'BH-W', name: 'Brisbane Heat Women', shortName: 'BH-W' },
        team1Score: { runs, wickets: 0, overs, completedOvers: Math.floor(overs), ballsInOver: 1 },
      });

      const mockOdds = (favoriteKey: string, favoriteName: string, backRate: number): any => ({
        matchId,
        oddsKey: matchId,
        status: 'success',
        recordsCount: 1,
        odds: {
          matchKey: matchId,
          favoriteTeamKey: favoriteKey,
          favoriteTeamName: favoriteName,
          bookmaker: {
            rawRateString: `${backRate}+1`,
            backRate,
            layRate: backRate + 1,
            decimalBack: Number((1 + backRate / 100).toFixed(2)),
            decimalLay: Number((1 + (backRate + 1) / 100).toFixed(2)),
            spread: 1,
            isSuspended: false,
          },
          raw: {
            F: `^${favoriteKey}`,
            R: `${backRate}+1`,
          },
        },
      });

      // 1. Initial State: Bowling (BH-W) in control at 80 paise
      engine.evaluateMatch(mockMatch(1.0, 10), mockOdds('BH-W', 'Brisbane Heat Women', 80));
      let state = engine.getState(matchId);
      assert.equal(state.stage, 'WAITING_FOR_CONFIRMATION');

      // 2. Boundary 1: Hits 4, odds flip to Batting (ADS-W) at 95 paise (Delta: (100-80)+(100-95) = 25 >= 11)
      const tick1Signals = engine.evaluateMatch(
        mockMatch(1.1, 14),
        mockOdds('ADS-W', 'Adelaide Strikers Women', 95),
        { type: 'FOUR', oddsMovement: 25 }
      );
      state = engine.getState(matchId);
      assert.equal(state.stage, 'CONFIRMED_BOOKING_TEAM');
      assert.equal(state.bookingTeamName, 'Adelaide Strikers Women');
      assert.ok(
        tick1Signals.some((s) => s.signalType === 'BOOKING_TEAM_CONFIRMED'),
        'Booking team confirmed signal emitted'
      );
      // Verify NO entry trade has been recorded yet
      assert.notEqual(state.firstEntryPosition.status, 'RECORDED_ENTRY');
      assert.equal(state.firstEntryTrade, null);

      // 3. Boundary 2: Hits another 4 with 12 paise change, but current odds are 79 paise (< 85)
      const tick2Signals = engine.evaluateMatch(
        mockMatch(1.5, 20),
        mockOdds('ADS-W', 'Adelaide Strikers Women', 79),
        { type: 'FOUR', oddsMovement: 12 }
      );
      state = engine.getState(matchId);
      // Stage must transition to CONFIRMED_PENDING_85!
      assert.equal(state.stage, 'CONFIRMED_PENDING_85');
      assert.equal(state.pending85, true);
      assert.ok(
        tick2Signals.some((s) => s.signalType === 'ENTRY_CONFIRMED_WAITING_85'),
        'Entry confirmed waiting 85 signal emitted'
      );
      // Still NO entry until 85 is crossed
      assert.notEqual(state.firstEntryPosition.status, 'RECORDED_ENTRY');
      assert.equal(state.firstEntryTrade, null);

      // 4. Live odds still below 85 (e.g. 82 paise) -> still waiting
      engine.evaluateMatch(mockMatch(2.0, 24), mockOdds('ADS-W', 'Adelaide Strikers Women', 82));
      state = engine.getState(matchId);
      assert.equal(state.stage, 'CONFIRMED_PENDING_85');
      assert.notEqual(state.firstEntryPosition.status, 'RECORDED_ENTRY');
      assert.equal(state.firstEntryTrade, null);

      // 5. Live odds cross 85 paise with Batting (ADS-W) in control -> ENTRY TRIGGERS!
      const tick4Signals = engine.evaluateMatch(
        mockMatch(2.3, 27),
        mockOdds('ADS-W', 'Adelaide Strikers Women', 86)
      );
      state = engine.getState(matchId);
      assert.equal(state.stage, 'ACTIVE_FIRST_ENTRY');
      assert.equal(state.firstEntryPosition.status, 'RECORDED_ENTRY');
      assert.equal(state.firstEntryTrade?.status, 'ACTIVE');
      assert.equal(state.firstEntryTrade?.entryPaise, 86);
      assert.ok(
        tick4Signals.some((s) => s.signalType === 'FIRST_ENTRY_TRIGGER'),
        'First entry trigger signal emitted when crossing 85'
      );
    });
  });
});

