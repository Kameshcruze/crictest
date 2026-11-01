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
});
