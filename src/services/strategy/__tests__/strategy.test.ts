/**
 * Comprehensive Phase 3 & Phase 4 Test Suite for Cricket Trading Strategy Engine
 *
 * Covers every Phase 3 rule & Phase 4 test scenario:
 * - Same-control positive (current - previous: +20, +13, +11 vs +10, downward fails) and control-switch (15, 22, 12) formulas
 * - Booking confirmation & First Entry thresholds (>= 85 passes, 84 fails)
 * - Entry confirmation below 85 (e.g. 60->80) moves to CONFIRMED_PENDING_85 without entering
 * - Immediate entry when entry-confirmation 4/6 ends at BATTING >= 85
 * - Deferred first entry on the first later ball at BATTING >= 85, even overs later, no new 4/6
 * - Window expiry at 10.0 (Inn 1) and 6.0 (Inn 2), including CONFIRMED_PENDING_85 expiry
 * - 3-wicket safety filter before entry in both Innings 1 & Innings 2; open entry unaffected on 3rd wicket
 * - FIRST_EXIT_BELOW_55: 55 exits, 56 holds, disabled permanently after any wicket (50 after wicket does not exit)
 * - Second entry: 64 passes, 65 fails, works after the over window, and requires wicket AFTER 1st entry (e.g. 1 -> 2)
 * - Bookset exit at BOWLING > 85 (85 holds, 86 exits single or both entries)
 * - First ball of innings (0.0 -> 0.1) & over rollover (1.5 -> 2.0)
 * - Score updating on one tick while odds jump arrives 1-5s later (both suspended 0+0 and unchanged pre-ball ticks)
 * - Phase 2 server persistence, restart rehydration, offline outbox & STRATEGY_ALERTS_ENABLED=false
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CricketStrategyEngine,
  isWithinEntryWindow,
  calculatePaiseChange,
  detectTeamInControl,
  getLegalBallCount,
  StrategyPersistenceCoordinator,
  StrategyStorageAdapter,
  SerializedMatchStrategyState,
  StrategyTradeRecord,
  TradePosition,
  StrategySignal,
  buildSignalDedupeHash,
} from '../index';

function makeMockMatch(
  matchId: string,
  params: {
    innings?: 1 | 2;
    runs?: number;
    wickets?: number;
    overs?: number;
    totalBalls?: number;
    inn1Runs?: number;
    inn1Wickets?: number;
    inn1Overs?: number;
  }
): any {
  const inn = params.innings ?? 1;
  const runs = params.runs ?? 0;
  const wickets = params.wickets ?? 0;
  const overs = params.overs ?? 0;
  const completedOvers = Math.floor(overs);
  const ballsInOver = Math.round((overs - completedOvers) * 10);

  const activeScore = {
    runs,
    wickets,
    overs,
    completedOvers,
    ballsInOver,
    totalBalls: params.totalBalls,
    scoreString: `${runs}/${wickets}`,
  };

  if (inn === 2) {
    return {
      id: matchId,
      format: 'T20',
      seriesName: 'WBBL 2026',
      status: 'live',
      battingTeamKey: 'BH-W',
      team1: { key: 'ADS-W', name: 'Adelaide Strikers Women', shortName: 'ADS-W' },
      team2: { key: 'BH-W', name: 'Brisbane Heat Women', shortName: 'BH-W' },
      team1Score: {
        runs: params.inn1Runs ?? 150,
        wickets: params.inn1Wickets ?? 6,
        overs: params.inn1Overs ?? 20.0,
        completedOvers: Math.floor(params.inn1Overs ?? 20.0),
        ballsInOver: 0,
      },
      team2Score: activeScore,
    };
  }

  return {
    id: matchId,
    format: 'T20',
    seriesName: 'WBBL 2026',
    status: 'live',
    battingTeamKey: 'ADS-W',
    team1: { key: 'ADS-W', name: 'Adelaide Strikers Women', shortName: 'ADS-W' },
    team2: { key: 'BH-W', name: 'Brisbane Heat Women', shortName: 'BH-W' },
    team1Score: activeScore,
  };
}

function makeMockOdds(
  matchId: string,
  favoriteKey: string | null,
  favoriteName: string | null,
  backRate: number | null
): any {
  const suspended = backRate === null || favoriteKey === null;
  return {
    matchId,
    oddsKey: matchId,
    status: suspended ? 'unavailable' : 'success',
    recordsCount: 1,
    odds: {
      matchKey: matchId,
      favoriteTeamKey: favoriteKey || '',
      favoriteTeamName: favoriteName || '',
      bookmaker: {
        rawRateString: suspended ? '0+0' : `${backRate}+1`,
        backRate: suspended ? null : backRate,
        layRate: suspended ? null : (backRate as number) + 1,
        decimalBack: suspended ? null : Number((1 + (backRate as number) / 100).toFixed(2)),
        decimalLay: suspended ? null : Number((1 + ((backRate as number) + 1) / 100).toFixed(2)),
        spread: suspended ? null : 1,
        isSuspended: suspended,
      },
      raw: {
        F: favoriteKey ? `^${favoriteKey}` : '',
        R: suspended ? '0+0' : `${backRate}+1`,
      },
    },
  };
}

describe('Phase 3 & 4 Cricket Trading Strategy Engine Suite', () => {
  let engine: CricketStrategyEngine;
  const MATCH_ID = 'TEST_MATCH_001';

  beforeEach(() => {
    engine = new CricketStrategyEngine();
  });

  // =========================================================================
  // 1. ABNORMAL ACTIVITY THRESHOLDS (FOUR & SIX)
  // =========================================================================
  describe('Abnormal Activity Threshold Boundaries', () => {
    it('Four: movement of 10 paise fails, 11 paise passes', () => {
      const failSig = engine.evaluateAbnormalActivity({
        matchId: MATCH_ID,
        boundaryType: 'FOUR',
        oddsMovement: 10,
        currentInnings: 1,
        currentOver: 4.2,
        measuredTeam: 'Adelaide Strikers Women',
        decimalOdds: 1.88,
        teamInControl: 'BATTING',
      });
      assert.equal(failSig.status, 'FAIL');
      assert.equal(failSig.signalType, 'ABNORMAL_ACTIVITY_FOUR');

      const passSig = engine.evaluateAbnormalActivity({
        matchId: MATCH_ID,
        boundaryType: 'FOUR',
        oddsMovement: 11,
        currentInnings: 1,
        currentOver: 4.3,
        measuredTeam: 'Adelaide Strikers Women',
        decimalOdds: 1.88,
        teamInControl: 'BATTING',
      });
      assert.equal(passSig.status, 'PASS');
      assert.equal(passSig.signalType, 'ABNORMAL_ACTIVITY_FOUR');
    });

    it('Six: movement of 17 paise fails, 18 paise passes', () => {
      const failSig = engine.evaluateAbnormalActivity({
        matchId: MATCH_ID,
        boundaryType: 'SIX',
        oddsMovement: 17,
        currentInnings: 1,
        currentOver: 7.1,
        measuredTeam: 'Adelaide Strikers Women',
        decimalOdds: 1.88,
        teamInControl: 'BATTING',
      });
      assert.equal(failSig.status, 'FAIL');

      const passSig = engine.evaluateAbnormalActivity({
        matchId: MATCH_ID,
        boundaryType: 'SIX',
        oddsMovement: 18,
        currentInnings: 1,
        currentOver: 7.2,
        measuredTeam: 'Adelaide Strikers Women',
        decimalOdds: 1.88,
        teamInControl: 'BATTING',
      });
      assert.equal(passSig.status, 'PASS');
    });

    it('Boundary fails when BATTING is not in control after the ball', () => {
      const sig = engine.evaluateAbnormalActivity({
        matchId: MATCH_ID,
        boundaryType: 'SIX',
        oddsMovement: 25,
        currentInnings: 1,
        currentOver: 3.1,
        measuredTeam: 'Brisbane Heat Women',
        decimalOdds: 1.75,
        teamInControl: 'BOWLING',
      });
      assert.equal(sig.status, 'FAIL');
      assert.match(sig.explanation, /did not leave BATTING team in control/);
    });
  });

  // =========================================================================
  // 2. SAME-CONTROL (current - previous, NO downward pass) & SWITCH (15, 22, 12)
  // =========================================================================
  describe('Same-Control & Control-Switch Movement Formulas', () => {
    it('Same-control current - previous: 70->90 on 6 (+20) passes, 84->97 on 4 (+13) passes, 78->88 (+10) fails, 78->89 (+11) passes', () => {
      // 70 -> 90 on a 6 = +20 passes (>= 18)
      const up20 = calculatePaiseChange('BATTING', 70, 'BATTING', 90);
      assert.equal(up20.delta, 20);
      assert.equal(up20.qualifiesBattingControl, true);
      assert.equal(
        engine.evaluateAbnormalActivity({
          matchId: MATCH_ID,
          boundaryType: 'SIX',
          oddsMovement: up20.delta,
          currentInnings: 1,
          currentOver: 2.1,
          measuredTeam: 'ADS-W',
          decimalOdds: 1.90,
          teamInControl: 'BATTING',
        }).status,
        'PASS'
      );

      // 84 -> 97 on a 4 = +13 passes (>= 11)
      const up13 = calculatePaiseChange('BATTING', 84, 'BATTING', 97);
      assert.equal(up13.delta, 13);
      assert.equal(up13.qualifiesBattingControl, true);
      assert.equal(
        engine.evaluateAbnormalActivity({
          matchId: MATCH_ID,
          boundaryType: 'FOUR',
          oddsMovement: up13.delta,
          currentInnings: 1,
          currentOver: 2.2,
          measuredTeam: 'ADS-W',
          decimalOdds: 1.97,
          teamInControl: 'BATTING',
        }).status,
        'PASS'
      );

      // 78 -> 88 on a 4 = +10 fails (< 11)
      const up10 = calculatePaiseChange('BATTING', 78, 'BATTING', 88);
      assert.equal(up10.delta, 10);
      assert.equal(up10.qualifiesBattingControl, true);
      assert.equal(
        engine.evaluateAbnormalActivity({
          matchId: MATCH_ID,
          boundaryType: 'FOUR',
          oddsMovement: up10.delta,
          currentInnings: 1,
          currentOver: 2.3,
          measuredTeam: 'ADS-W',
          decimalOdds: 1.88,
          teamInControl: 'BATTING',
        }).status,
        'FAIL'
      );

      // 78 -> 89 on a 4 = +11 passes (>= 11)
      const up11 = calculatePaiseChange('BATTING', 78, 'BATTING', 89);
      assert.equal(up11.delta, 11);
      assert.equal(up11.qualifiesBattingControl, true);
      assert.equal(
        engine.evaluateAbnormalActivity({
          matchId: MATCH_ID,
          boundaryType: 'FOUR',
          oddsMovement: up11.delta,
          currentInnings: 1,
          currentOver: 2.4,
          measuredTeam: 'ADS-W',
          decimalOdds: 1.89,
          teamInControl: 'BATTING',
        }).status,
        'PASS'
      );
    });

    it('Same-control downward moves fail: 98->87 on 4 and 90->80 on 6 never pass (including end-to-end)', () => {
      // 98 -> 87 on a 4 = -11 -> fails
      const downFour = calculatePaiseChange('BATTING', 98, 'BATTING', 87);
      assert.equal(downFour.delta, -11);
      assert.equal(downFour.qualifiesBattingControl, false);
      assert.equal(
        engine.evaluateAbnormalActivity({
          matchId: MATCH_ID,
          boundaryType: 'FOUR',
          oddsMovement: downFour.delta,
          currentInnings: 1,
          currentOver: 2.5,
          measuredTeam: 'ADS-W',
          decimalOdds: 1.87,
          teamInControl: 'BATTING',
        }).status,
        'FAIL'
      );

      // 90 -> 80 on a 6 = -10 -> fails
      const downSix = calculatePaiseChange('BATTING', 90, 'BATTING', 80);
      assert.equal(downSix.delta, -10);
      assert.equal(downSix.qualifiesBattingControl, false);
      assert.equal(
        engine.evaluateAbnormalActivity({
          matchId: MATCH_ID,
          boundaryType: 'SIX',
          oddsMovement: downSix.delta,
          currentInnings: 1,
          currentOver: 2.6,
          measuredTeam: 'ADS-W',
          decimalOdds: 1.80,
          teamInControl: 'BATTING',
        }).status,
        'FAIL'
      );

      // End-to-end evaluateMatch: BATTING 98 -> FOUR -> BATTING 87 must NOT confirm booking team
      const id = 'MATCH_DOWNWARD_MOVE_FAIL';
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 10, overs: 1.0 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 98)
      );
      const sigs = engine.evaluateMatch(
        makeMockMatch(id, { runs: 14, overs: 1.1 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 87)
      );
      assert.equal(engine.getState(id).stage, 'WAITING_FOR_CONFIRMATION');
      assert.equal(engine.getState(id).bookingTeamName, null);
      assert.ok(sigs.some((s) => s.signalType === 'ABNORMAL_ACTIVITY_FOUR' && s.status === 'FAIL'));
    });

    it('Switch formula computes 15, 22, and 12 paise across BOWLING -> BATTING transitions', () => {
      // Switch 15: BOWLING 95 -> BATTING 90 = (100-95) + (100-90) = 5 + 10 = 15 (passes FOUR, fails SIX)
      const sw15 = calculatePaiseChange('BOWLING', 95, 'BATTING', 90);
      assert.equal(sw15.delta, 15);
      assert.equal(sw15.qualifiesBattingControl, true);
      assert.equal(
        engine.evaluateAbnormalActivity({
          matchId: MATCH_ID,
          boundaryType: 'FOUR',
          oddsMovement: sw15.delta,
          currentInnings: 1,
          currentOver: 1.1,
          measuredTeam: 'ADS-W',
          decimalOdds: 1.90,
          teamInControl: 'BATTING',
        }).status,
        'PASS'
      );
      assert.equal(
        engine.evaluateAbnormalActivity({
          matchId: MATCH_ID,
          boundaryType: 'SIX',
          oddsMovement: sw15.delta,
          currentInnings: 1,
          currentOver: 1.2,
          measuredTeam: 'ADS-W',
          decimalOdds: 1.90,
          teamInControl: 'BATTING',
        }).status,
        'FAIL'
      );

      // Switch 22: BOWLING 88 -> BATTING 90 = (100-88) + (100-90) = 12 + 10 = 22 (passes SIX & FOUR)
      const sw22 = calculatePaiseChange('BOWLING', 88, 'BATTING', 90);
      assert.equal(sw22.delta, 22);
      assert.equal(
        engine.evaluateAbnormalActivity({
          matchId: MATCH_ID,
          boundaryType: 'SIX',
          oddsMovement: sw22.delta,
          currentInnings: 1,
          currentOver: 1.3,
          measuredTeam: 'ADS-W',
          decimalOdds: 1.90,
          teamInControl: 'BATTING',
        }).status,
        'PASS'
      );

      // Switch 12 (User example): BOWLING 98 -> BATTING 90 = (100-98) + (100-90) = 12 (passes FOUR, fails SIX)
      const sw12 = calculatePaiseChange('BOWLING', 98, 'BATTING', 90);
      assert.equal(sw12.delta, 12);
      assert.match(sw12.formula, /\(100 - 98\) \+ \(100 - 90\) = 2 \+ 10 = 12 paise/);
      assert.equal(
        engine.evaluateAbnormalActivity({
          matchId: MATCH_ID,
          boundaryType: 'FOUR',
          oddsMovement: sw12.delta,
          currentInnings: 1,
          currentOver: 1.4,
          measuredTeam: 'ADS-W',
          decimalOdds: 1.90,
          teamInControl: 'BATTING',
        }).status,
        'PASS'
      );
    });
  });

  // =========================================================================
  // 3. BOOKING & FIRST ENTRY THRESHOLDS (>= 85 PASSES, 84 FAILS)
  // =========================================================================
  describe('Booking Confirmation & First Entry Thresholds (>= 85 passes, 84 fails)', () => {
    it('evaluateFirstEntry rejects 84 paise, accepts 85+ paise (even > 2.00 decimal), requires BATTING control', () => {
      const sig84 = engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 1.84,
        currentPaise: 84,
        teamInControl: 'BATTING',
        currentInnings: 1,
        currentOver: 3.5,
        measuredTeam: 'ADS-W',
      });
      assert.equal(sig84.status, 'FAIL');
      assert.match(sig84.explanation, /below 85 paise/);

      const sig85 = engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 1.85,
        currentPaise: 85,
        teamInControl: 'BATTING',
        currentInnings: 1,
        currentOver: 4.0,
        measuredTeam: 'ADS-W',
      });
      assert.equal(sig85.status, 'PASS');

      // Above 2.00 decimal also passes as long as BATTING is in control and >= 85 paise
      const sig115 = engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 2.15,
        currentPaise: 115,
        teamInControl: 'BATTING',
        currentInnings: 1,
        currentOver: 4.1,
        measuredTeam: 'ADS-W',
      });
      assert.equal(sig115.status, 'PASS');

      // BOWLING in control at 90p must FAIL batting rule
      const sigBowl = engine.evaluateFirstEntry({
        matchId: MATCH_ID,
        decimalOdds: 1.90,
        currentPaise: 90,
        teamInControl: 'BOWLING',
        currentInnings: 1,
        currentOver: 4.2,
        measuredTeam: 'BH-W',
      });
      assert.equal(sigBowl.status, 'FAIL');
      assert.match(sigBowl.explanation, /Waiting for BATTING control/);
    });

    it('Booking confirmation passes at 85 and fails at 84; immediate entry when next 4/6 is >= 85', () => {
      const id = 'MATCH_BOOKING_84_85';
      // Tick 1: BOWLING at 95p
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 10, overs: 1.0 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 95)
      );
      // Boundary 1 at 84p: switch move = (100-95)+(100-84) = 21p >= 11p, BUT 84 < 85 -> must NOT confirm!
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 14, overs: 1.1 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 84)
      );
      assert.equal(engine.getState(id).stage, 'WAITING_FOR_CONFIRMATION');

      // Reset to BOWLING 95p, then hit FOUR to BATTING exactly 85p (move = 20p >= 11p, 85 >= 85) -> Confirms Booking Team!
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 14, overs: 1.2 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 95)
      );
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 18, overs: 1.3 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 85)
      );
      assert.equal(engine.getState(id).stage, 'CONFIRMED_BOOKING_TEAM');
      assert.equal(engine.getState(id).firstEntryTrade, null);

      // Single at 88p must NOT trigger 1st entry yet without an entry-confirmation 4 or 6
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 19, overs: 1.4 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 88)
      );
      assert.equal(engine.getState(id).stage, 'CONFIRMED_BOOKING_TEAM');

      // Dot ball brings BATTING to 74p, then FOUR jumps to exact 85p (85 - 74 = +11p >= 11p, 85 >= 85) -> enters IMMEDIATELY!
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 19, overs: 1.5 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 74)
      );
      const entrySigs = engine.evaluateMatch(
        makeMockMatch(id, { runs: 23, overs: 2.0 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 85)
      );
      const state = engine.getState(id);
      assert.equal(state.stage, 'ACTIVE_FIRST_ENTRY');
      assert.equal(state.firstEntryTrade?.entryPaise, 85);
      assert.equal(state.firstEntryTrade?.status, 'ACTIVE');
      assert.ok(entrySigs.some((s) => s.signalType === 'FIRST_ENTRY_TRIGGER'));
    });
  });

  // =========================================================================
  // 4. DEFERRED FIRST ENTRY (CONFIRMED_PENDING_85)
  // =========================================================================
  describe('Deferred First Entry (CONFIRMED_PENDING_85)', () => {
    it('Entry confirmation at 80 does not enter; moves to CONFIRMED_PENDING_85 and enters on first later ball at 85+ even overs later', () => {
      const id = 'MATCH_DEFERRED_85';
      // 1. Booking team confirmed at 1.1 (BOWLING 98 -> FOUR -> BATTING 90, 12p >= 11p, 90 >= 85)
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 10, overs: 1.0 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 98)
      );
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 14, overs: 1.1 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 90)
      );
      assert.equal(engine.getState(id).stage, 'CONFIRMED_BOOKING_TEAM');

      // 2. BATTING drifts to 60p on 1.2, then on 1.3 hits FOUR -> BATTING 80p (+20p >= 11p!)
      // Since 80 < 85: MUST NOT enter yet; must become CONFIRMED_PENDING_85!
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 15, overs: 1.2 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 60)
      );
      const confirmSigs = engine.evaluateMatch(
        makeMockMatch(id, { runs: 19, overs: 1.3 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 80)
      );
      assert.equal(engine.getState(id).stage, 'CONFIRMED_PENDING_85');
      assert.equal(engine.getState(id).pending85, true);
      assert.equal(engine.getState(id).firstEntryTrade, null);
      assert.ok(confirmSigs.some((s) => s.signalType === 'ENTRY_CONFIRMED_WAITING_85'));

      // Extra tick on the SAME ball 1.3 even if odds briefly touch 86 must NOT fire until a LATER ball
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 19, overs: 1.3 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 86)
      );
      assert.equal(engine.getState(id).stage, 'CONFIRMED_PENDING_85');

      // Later ball (overs later, at 4.2) BATTING is 84p (< 85) -> STILL stays CONFIRMED_PENDING_85
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 32, overs: 4.2 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 84)
      );
      assert.equal(engine.getState(id).stage, 'CONFIRMED_PENDING_85');
      assert.equal(engine.getState(id).firstEntryTrade, null);

      // Later ball (5.1) BOWLING is 90p (wrong control!) -> STILL stays CONFIRMED_PENDING_85
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 35, overs: 5.1 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 90)
      );
      assert.equal(engine.getState(id).stage, 'CONFIRMED_PENDING_85');

      // First later ball (6.3, 1 run - NO new 4/6!) where BATTING reaches 85p -> enters IMMEDIATELY!
      const deferredSigs = engine.evaluateMatch(
        makeMockMatch(id, { runs: 41, overs: 6.3 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 85)
      );
      const state = engine.getState(id);
      assert.equal(state.stage, 'ACTIVE_FIRST_ENTRY');
      assert.equal(state.pending85, false);
      assert.equal(state.firstEntryTrade?.entryPaise, 85);
      assert.equal(state.firstEntryTrade?.entryOver, 6.3);
      assert.ok(
        deferredSigs.some(
          (s) => s.signalType === 'FIRST_ENTRY_TRIGGER' && s.metadata?.deferredEntry === true
        )
      );
    });

    it('Supports confirmation 6 moving 45 -> 65 (below 85) then entering on later ball at 88', () => {
      const id = 'MATCH_DEFERRED_45_TO_65';
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 8, overs: 0.4 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 95)
      );
      // Booking confirm
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 12, overs: 0.5 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 89)
      );
      assert.equal(engine.getState(id).stage, 'CONFIRMED_BOOKING_TEAM');

      // Drifts to 45, then SIX moves 45 -> 65 (+20p >= 18p)
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 13, overs: 1.0 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 45)
      );
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 19, overs: 1.1 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 65)
      );
      assert.equal(engine.getState(id).stage, 'CONFIRMED_PENDING_85');
      assert.equal(engine.getState(id).firstEntryTrade, null);

      // Later ball (3.4) hits BATTING 88 -> enters!
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 30, overs: 3.4 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 88)
      );
      assert.equal(engine.getState(id).stage, 'ACTIVE_FIRST_ENTRY');
      assert.equal(engine.getState(id).firstEntryTrade?.entryPaise, 88);
    });
  });

  // =========================================================================
  // 5. FIRST BALL OF INNINGS (0.0 -> 0.1) & OVER ROLLOVER (1.5 -> 2.0)
  // =========================================================================
  describe('First Ball of Innings & Over Rollover (1.5 -> 2.0)', () => {
    it('Detects boundary on first ball of innings (0.0 -> 0.1) and 6th-ball over rollover (1.5 -> 2.0)', () => {
      const id = 'MATCH_FIRST_BALL_AND_ROLLOVER';
      assert.equal(getLegalBallCount({ overs: 0.5 }), 5);
      assert.equal(getLegalBallCount({ overs: 1.0 }), 6);
      assert.equal(getLegalBallCount({ overs: 1.5 }), 11);
      assert.equal(getLegalBallCount({ overs: 2.0 }), 12);

      // First ball of innings: 0.0 (0 runs, BOWLING 98p) -> 0.1 (4 runs, BATTING 90p, switch = 12 >= 11)
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 0, overs: 0.0 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 98)
      );
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 4, overs: 0.1 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 90)
      );
      assert.equal(engine.getState(id).stage, 'CONFIRMED_BOOKING_TEAM');

      // Advance to 1.5 with BATTING at 74p
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 15, overs: 1.5 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 74)
      );
      // Over rollover 1.5 -> 2.0: FOUR (15 -> 19) jumps to BATTING 87p (87 - 74 = +13p >= 11p, 87 >= 85) -> FIRST_ENTRY!
      const sigs = engine.evaluateMatch(
        makeMockMatch(id, { runs: 19, overs: 2.0 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 87)
      );
      assert.equal(engine.getState(id).stage, 'ACTIVE_FIRST_ENTRY');
      assert.equal(engine.getState(id).firstEntryTrade?.entryOver, 2.0);
      assert.ok(sigs.some((s) => s.signalType === 'FIRST_ENTRY_TRIGGER'));
    });
  });

  // =========================================================================
  // 6. OVER WINDOW EXPIRY (10.0 INN 1 & 6.0 INN 2)
  // =========================================================================
  describe('Window Expiry at 10.0 (Inn 1) and 6.0 (Inn 2)', () => {
    it('isWithinEntryWindow: Inn 1 9.5 passes, 10.0 fails; Inn 2 5.5 passes, 6.0 fails', () => {
      assert.equal(isWithinEntryWindow(1, 9.5), true);
      assert.equal(isWithinEntryWindow(1, 10.0), false);
      assert.equal(isWithinEntryWindow(2, 5.5), true);
      assert.equal(isWithinEntryWindow(2, 6.0), false);
    });

    it('Expires WAITING/CONFIRMED/CONFIRMED_PENDING_85 at 10.0 in Inn 1 and 6.0 in Inn 2', () => {
      const id = 'MATCH_OVER_EXPIRY_PENDING';
      engine.evaluateMatch(
        makeMockMatch(id, { innings: 1, runs: 60, overs: 9.4 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 92)
      );
      assert.equal(engine.getState(id).stage, 'WAITING_FOR_CONFIRMATION');

      // Hits 10.0 ov -> expires
      engine.evaluateMatch(
        makeMockMatch(id, { innings: 1, runs: 64, overs: 10.0 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 85)
      );
      assert.equal(engine.getState(id).stage, 'WINDOW_EXPIRED');

      // 2nd innings resets cleanly; confirms booking at 5.2, confirms entry < 85 at 5.4 -> CONFIRMED_PENDING_85
      engine.evaluateMatch(
        makeMockMatch(id, { innings: 2, runs: 0, overs: 0.0 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 98)
      );
      assert.equal(engine.getState(id).stage, 'WAITING_FOR_CONFIRMATION');

      engine.evaluateMatch(
        makeMockMatch(id, { innings: 2, runs: 4, overs: 5.2 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 90)
      );
      assert.equal(engine.getState(id).stage, 'CONFIRMED_BOOKING_TEAM');

      engine.evaluateMatch(
        makeMockMatch(id, { innings: 2, runs: 5, overs: 5.3 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 60)
      );
      engine.evaluateMatch(
        makeMockMatch(id, { innings: 2, runs: 9, overs: 5.4 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 80)
      );
      assert.equal(engine.getState(id).stage, 'CONFIRMED_PENDING_85');

      // Hits 6.0 ov before reaching 85 -> expires even with BATTING at 88p at 6.0!
      engine.evaluateMatch(
        makeMockMatch(id, { innings: 2, runs: 10, overs: 6.0 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 88)
      );
      assert.equal(engine.getState(id).stage, 'WINDOW_EXPIRED');
      assert.equal(engine.getState(id).pending85, false);
      assert.equal(engine.getState(id).firstEntryTrade, null);
    });
  });

  // =========================================================================
  // 7. 3-WICKET SAFETY RULE IN BOTH INNINGS + OPEN ENTRY IMMUNITY
  // =========================================================================
  describe('3-Wicket Filter in Both Innings & Open Entry Immunity', () => {
    it('Skips match when 3 wickets fall before entry in Innings 1 and in Innings 2', () => {
      // Innings 1: 3 wickets before entry
      const m1 = 'MATCH_3WKT_INN1';
      engine.evaluateMatch(
        makeMockMatch(m1, { innings: 1, runs: 20, wickets: 2, overs: 3.1 }),
        makeMockOdds(m1, 'ADS-W', 'Adelaide Strikers Women', 90)
      );
      assert.equal(engine.getState(m1).stage, 'WAITING_FOR_CONFIRMATION');

      engine.evaluateMatch(
        makeMockMatch(m1, { innings: 1, runs: 20, wickets: 3, overs: 3.2 }),
        makeMockOdds(m1, 'ADS-W', 'Adelaide Strikers Women', 86)
      );
      assert.equal(engine.getState(m1).stage, 'DISQUALIFIED_3_WICKETS');

      // Innings 2: Team 1 finished Inn 1 without entry, now Team 2 loses 3 wickets before entry in Inn 2
      engine.evaluateMatch(
        makeMockMatch(m1, { innings: 2, runs: 10, wickets: 2, overs: 2.1 }),
        makeMockOdds(m1, 'BH-W', 'Brisbane Heat Women', 90)
      );
      assert.equal(engine.getState(m1).stage, 'WAITING_FOR_CONFIRMATION');

      engine.evaluateMatch(
        makeMockMatch(m1, { innings: 2, runs: 10, wickets: 3, overs: 2.2 }),
        makeMockOdds(m1, 'BH-W', 'Brisbane Heat Women', 88)
      );
      assert.equal(engine.getState(m1).stage, 'DISQUALIFIED_3_WICKETS');
    });

    it('An already-open FIRST_ENTRY is NOT affected when wicket 3 falls', () => {
      const id = 'MATCH_OPEN_IMMUNE_3WKT';
      engine.recordEntry(id, 'FIRST_ENTRY', 1.90, 1, 3.0, 2);
      assert.equal(engine.getState(id).stage, 'ACTIVE_FIRST_ENTRY');

      // 3rd wicket falls while BOWLING 70p -> still ACTIVE_FIRST_ENTRY (never disqualified!)
      engine.evaluateMatch(
        makeMockMatch(id, { innings: 1, runs: 40, wickets: 3, overs: 4.5 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 70)
      );
      assert.equal(engine.getState(id).stage, 'ACTIVE_FIRST_ENTRY');
      assert.equal(engine.getState(id).firstEntryTrade?.status, 'ACTIVE');
    });
  });

  // =========================================================================
  // 8. FIRST_EXIT_BELOW_55 (55 EXITS, 56 HOLDS, 50 AFTER WICKET DOES NOT EXIT)
  // =========================================================================
  describe('FIRST_EXIT_BELOW_55 (No Wicket Since First Entry)', () => {
    it('Exits at 55 passes, 56 does not, and 50 after a wicket does not exit', () => {
      // Part A: No wicket since 1st entry -> 56 holds, 55 exits!
      const idNoWkt = 'MATCH_EXIT_55_56';
      engine.recordEntry(idNoWkt, 'FIRST_ENTRY', 1.88, 1, 3.0, 0);

      // BATTING at 56p -> must NOT exit!
      engine.evaluateMatch(
        makeMockMatch(idNoWkt, { runs: 45, wickets: 0, overs: 4.1 }),
        makeMockOdds(idNoWkt, 'ADS-W', 'Adelaide Strikers Women', 56)
      );
      assert.equal(engine.getState(idNoWkt).stage, 'ACTIVE_FIRST_ENTRY');
      assert.equal(engine.getState(idNoWkt).firstEntryTrade?.status, 'ACTIVE');

      // BATTING at 55p -> MUST exit via FIRST_EXIT_BELOW_55!
      const exitSigs = engine.evaluateMatch(
        makeMockMatch(idNoWkt, { runs: 46, wickets: 0, overs: 4.2 }),
        makeMockOdds(idNoWkt, 'ADS-W', 'Adelaide Strikers Women', 55)
      );
      const stateA = engine.getState(idNoWkt);
      assert.equal(stateA.stage, 'FIRST_BOOKSET_COMPLETED');
      assert.equal(stateA.firstEntryTrade?.status, 'BOOKSET_COMPLETED');
      assert.equal(stateA.firstEntryTrade?.exitPaise, 55);
      assert.equal(stateA.firstEntryTrade?.exitReason, 'FIRST_EXIT_BELOW_55');
      assert.equal(stateA.firstEntryPosition.status, 'RECORDED_EXIT');
      assert.ok(exitSigs.some((s) => s.signalType === 'FIRST_EXIT_BELOW_55' && s.status === 'PASS'));

      // Part B: Wicket falls after 1st entry -> rule disabled permanently; 50 does NOT exit!
      const idWithWkt = 'MATCH_EXIT_50_AFTER_WICKET';
      engine.recordEntry(idWithWkt, 'FIRST_ENTRY', 1.88, 1, 3.0, 0);

      // Wicket falls (0 -> 1), BATTING drops to 50p -> MUST NOT exit!
      const afterWktSigs = engine.evaluateMatch(
        makeMockMatch(idWithWkt, { runs: 48, wickets: 1, overs: 5.1 }),
        makeMockOdds(idWithWkt, 'ADS-W', 'Adelaide Strikers Women', 50)
      );
      const stateB = engine.getState(idWithWkt);
      assert.equal(stateB.stage, 'ACTIVE_FIRST_ENTRY');
      assert.equal(stateB.firstEntryTrade?.status, 'ACTIVE');
      assert.ok(afterWktSigs.some((s) => s.signalType === 'FIRST_EXIT_BELOW_55' && s.status === 'FAIL'));
    });
  });

  // =========================================================================
  // 9. SECOND ENTRY (64 PASSES, 65 FAILS, WORKS AFTER WINDOW, WICKET > ENTRY_WICKETS)
  // =========================================================================
  describe('Second Entry Rules (BOWLING < 65p, Post-Window, Strict Wicket After Entry)', () => {
    it('Second entry 64 passes, 65 fails, works after the window, and no exit at wicket', () => {
      const id = 'MATCH_SECOND_ENTRY_AFTER_WINDOW';

      // Open FIRST_ENTRY cleanly inside window
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 8, wickets: 0, overs: 1.0 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 98)
      );
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 12, wickets: 0, overs: 1.1 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 90)
      );
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 12, wickets: 0, overs: 1.3 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 85)
      );
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 18, wickets: 0, overs: 1.4 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 90)
      );
      assert.equal(engine.getState(id).stage, 'ACTIVE_FIRST_ENTRY');

      // Advance past 10.0 over window (11.1 ov): wicket falls (0 -> 1), BATTING 60p -> NO exit, NO 2nd entry
      const wktSigs = engine.evaluateMatch(
        makeMockMatch(id, { runs: 80, wickets: 1, overs: 11.1 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 60)
      );
      assert.ok(wktSigs.some((s) => s.signalType === 'WICKET_EVENT'));
      assert.equal(engine.getState(id).stage, 'ACTIVE_FIRST_ENTRY');
      assert.equal(engine.getState(id).secondEntryTrade, null);

      // Control BOWLING at 65p (after window, 11.2 ov) -> 65 is NOT < 65 -> FAILS!
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 80, wickets: 1, overs: 11.2 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 65)
      );
      assert.equal(engine.getState(id).secondEntryTrade, null);

      // Control BOWLING at 64p (after window, 11.3 ov) -> < 65 PASSES even after over 10.0!
      const secondSigs = engine.evaluateMatch(
        makeMockMatch(id, { runs: 80, wickets: 1, overs: 11.3 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 64)
      );
      const state = engine.getState(id);
      assert.equal(state.stage, 'ACTIVE_SECOND_ENTRY');
      assert.equal(state.secondEntryTrade?.entryPaise, 64);
      assert.equal(state.secondEntryTrade?.entryOver, 11.3);
      assert.ok(secondSigs.some((s) => s.signalType === 'SECOND_ENTRY_TRIGGER'));
    });

    it('Second entry with first entry at 1 wicket requires the second wicket falling (not just wickets > 0)', () => {
      const id = 'MATCH_SECOND_AT_1_WKT';
      // First entry recorded when already 1 wicket down
      engine.recordEntry(id, 'FIRST_ENTRY', 1.88, 1, 2.5, 1);

      // BOWLING drops to 55p while wickets is STILL 1 -> must NOT trigger 2nd entry!
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 25, wickets: 1, overs: 3.1 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 55)
      );
      assert.equal(engine.getState(id).stage, 'ACTIVE_FIRST_ENTRY');
      assert.equal(engine.getState(id).secondEntryTrade, null);

      // 2nd wicket falls (1 -> 2) with BOWLING at 62p -> NOW triggers 2nd entry!
      const sigs = engine.evaluateMatch(
        makeMockMatch(id, { runs: 25, wickets: 2, overs: 3.2 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 62)
      );
      assert.equal(engine.getState(id).stage, 'ACTIVE_SECOND_ENTRY');
      assert.equal(engine.getState(id).secondEntryTrade?.entryWickets, 2);
      assert.ok(sigs.some((s) => s.signalType === 'SECOND_ENTRY_TRIGGER'));
    });

    it('Rejects second entry if prior first entry never occurred', () => {
      const sigNoFirst = engine.evaluateSecondEntry({
        matchId: 'NO_FIRST',
        teamInControl: 'BOWLING',
        controlTeamOdds: 55,
        currentWickets: 2,
        currentInnings: 1,
        currentOver: 4.0,
        measuredTeam: 'BH-W',
      });
      assert.equal(sigNoFirst.status, 'FAIL');
      assert.match(sigNoFirst.explanation, /requires an active prior first entry/);
    });
  });

  // =========================================================================
  // 10. BOOKSET EXIT AT 86 (BOWLING > 85) FOR SINGLE OR BOTH ENTRIES
  // =========================================================================
  describe('Unified Bookset Exit (BOWLING > 85 paise)', () => {
    it('Bookset at 86: BOWLING 85 fails, 86 passes for single FIRST_ENTRY even after window', () => {
      const id = 'MATCH_BOOKSET_86';
      engine.recordEntry(id, 'FIRST_ENTRY', 1.90, 1, 4.0, 0);

      // BOWLING 85p -> still ACTIVE_FIRST_ENTRY
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 101, wickets: 1, overs: 12.1 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 85)
      );
      assert.equal(engine.getState(id).stage, 'ACTIVE_FIRST_ENTRY');

      // BOWLING 86p -> closes FIRST_ENTRY!
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 102, wickets: 1, overs: 12.2 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 86)
      );
      const state = engine.getState(id);
      assert.equal(state.stage, 'FIRST_BOOKSET_COMPLETED');
      assert.equal(state.firstEntryTrade?.status, 'BOOKSET_COMPLETED');
      assert.equal(state.firstEntryTrade?.exitPaise, 86);
      assert.equal(state.firstEntryTrade?.exitReason, 'FULL_BOOKSET_OPPOSING_85');
      assert.equal(state.firstEntryPosition.status, 'RECORDED_EXIT');
    });

    it('Bookset at 86 closes BOTH FIRST_ENTRY and SECOND_ENTRY together', () => {
      const id = 'MATCH_BOOKSET_BOTH_86';
      engine.recordEntry(id, 'FIRST_ENTRY', 1.90, 1, 3.0, 0);
      engine.recordEntry(id, 'SECOND_ENTRY', 1.60, 1, 5.0, 1);

      engine.evaluateMatch(
        makeMockMatch(id, { runs: 110, wickets: 1, overs: 14.0 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 85)
      );
      assert.equal(engine.getState(id).stage, 'ACTIVE_SECOND_ENTRY');

      engine.evaluateMatch(
        makeMockMatch(id, { runs: 120, wickets: 1, overs: 14.2 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 86)
      );
      const state = engine.getState(id);
      assert.equal(state.stage, 'FULL_BOOKSET_COMPLETED');
      assert.equal(state.firstEntryTrade?.status, 'BOOKSET_COMPLETED');
      assert.equal(state.secondEntryTrade?.status, 'BOOKSET_COMPLETED');
      assert.equal(state.firstEntryTrade?.exitPaise, 86);
      assert.equal(state.secondEntryTrade?.exitPaise, 86);
      assert.equal(state.firstEntryPosition.status, 'RECORDED_EXIT');
      assert.equal(state.secondEntryPosition.status, 'RECORDED_EXIT');
    });
  });

  // =========================================================================
  // 11. ODDS ARRIVING 5 SECONDS AFTER SCORE OVER SEVERAL TICKS
  // =========================================================================
  describe('Delayed Odds Arrival Across Multiple 1-Second Ticks', () => {
    it('Preserves pre-ball BOWLING snapshot across 5 seconds of null/0+0 ticks before odds arrive on boundary ball', () => {
      const id = 'MATCH_ODDS_5S_LATE';
      // t=0: Ball 1.0, BOWLING at 98p
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 10, wickets: 0, overs: 1.0 }),
        makeMockOdds(id, 'BH-W', 'Brisbane Heat Women', 98)
      );

      // t=1..5 (5 seconds): Score updates to 1.1 (FOUR, runs 10 -> 14), but odds arrive suspended/null on every 1s tick
      for (let sec = 1; sec <= 5; sec++) {
        engine.evaluateMatch(
          makeMockMatch(id, { runs: 14, wickets: 0, overs: 1.1 }),
          makeMockOdds(id, null, null, null)
        );
        assert.equal(engine.getState(id).stage, 'WAITING_FOR_CONFIRMATION');
      }

      // t=6 (5 seconds after score tick): Odds finally arrive for ball 1.1 as BATTING 90p!
      // Switch move = (100 - 98) + (100 - 90) = 12p >= 11p AND 90 >= 85 -> Booking confirmed!
      const sigs = engine.evaluateMatch(
        makeMockMatch(id, { runs: 14, wickets: 0, overs: 1.1 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 90)
      );
      const state = engine.getState(id);
      assert.equal(state.stage, 'CONFIRMED_BOOKING_TEAM');
      assert.equal(state.bookingConfirmedBoundary?.paiseDelta, 12);
      assert.ok(sigs.some((s) => s.signalType === 'BOOKING_TEAM_CONFIRMED'));
    });

    it('Detects boundary using pre-ball odds vs post-jump odds when score updates on one tick and odds jump arrives 4 seconds later', () => {
      const id = 'MATCH_SCORE_FIRST_ODDS_JUMP_4S';
      // t=0: Ball 1.0, runs=10, BATTING at 78p (pre-ball odds)
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 10, wickets: 0, overs: 1.0 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 78)
      );

      // t=1: Score updates to 1.1 (runs 10 -> 14, FOUR), while odds feed is still unchanged at 78p
      engine.evaluateMatch(
        makeMockMatch(id, { runs: 14, wickets: 0, overs: 1.1 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 78)
      );
      assert.equal(engine.getState(id).stage, 'WAITING_FOR_CONFIRMATION');
      assert.equal(engine.getState(id).pendingBoundaryBall?.type, 'FOUR');

      // t=2..4: Several 1-second ticks pass with score already at 1.1/14 and odds still unchanged at 78p
      for (let sec = 2; sec <= 4; sec++) {
        engine.evaluateMatch(
          makeMockMatch(id, { runs: 14, wickets: 0, overs: 1.1 }),
          makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 78)
        );
        assert.equal(engine.getState(id).stage, 'WAITING_FOR_CONFIRMATION');
      }

      // t=5 (4 seconds after score update): Odds jump arrives (BATTING 91p) on the same ball!
      // Detected using pre-ball 78p vs post-jump 91p = 91 - 78 = +13p >= 11p, and 91 >= 85 -> Booking confirmed!
      const sigs = engine.evaluateMatch(
        makeMockMatch(id, { runs: 14, wickets: 0, overs: 1.1 }),
        makeMockOdds(id, 'ADS-W', 'Adelaide Strikers Women', 91)
      );
      const state = engine.getState(id);
      assert.equal(state.stage, 'CONFIRMED_BOOKING_TEAM');
      assert.equal(state.pendingBoundaryBall, null);
      assert.equal(state.bookingConfirmedBoundary?.paiseDelta, 13);
      assert.ok(sigs.some((s) => s.signalType === 'ABNORMAL_ACTIVITY_FOUR' && s.status === 'PASS'));
      assert.ok(sigs.some((s) => s.signalType === 'BOOKING_TEAM_CONFIRMED'));
    });

    it('detectTeamInControl strips ^ prefix and identifies BATTING/BOWLING accurately', () => {
      const m = makeMockMatch('CTRL_TEST', { runs: 10, overs: 1.0 });
      const batRes = detectTeamInControl(m, makeMockOdds('CTRL_TEST', 'ADS-W', 'Adelaide Strikers Women', 85));
      assert.equal(batRes.teamInControl, 'BATTING');
      assert.equal(batRes.currentPaise, 85);

      const bowlRes = detectTeamInControl(m, makeMockOdds('CTRL_TEST', 'BH-W', 'Brisbane Heat Women', 62));
      assert.equal(bowlRes.teamInControl, 'BOWLING');
      assert.equal(bowlRes.currentPaise, 62);
    });
  });

  // =========================================================================
  // 12. PHASE 2 PERSISTENCE, RESTART REHYDRATION & OUTBOX RESILIENCE
  // =========================================================================
  describe('Server Persistence, Restart Rehydration & Offline Outbox Suite', () => {
    function createInMemoryStorage(): StrategyStorageAdapter & {
      snapshots: Map<string, SerializedMatchStrategyState>;
      trades: Map<string, StrategyTradeRecord>;
      positions: Map<string, TradePosition>;
      signals: Map<string, StrategySignal>;
      tradeWriteCalls: number;
      exitWriteCalls: number;
      failWrites: boolean;
    } {
      const store = {
        snapshots: new Map<string, SerializedMatchStrategyState>(),
        trades: new Map<string, StrategyTradeRecord>(),
        positions: new Map<string, TradePosition>(),
        signals: new Map<string, StrategySignal>(),
        tradeWriteCalls: 0,
        exitWriteCalls: 0,
        failWrites: false,

        async loadAllSnapshots() {
          return Array.from(store.snapshots.values());
        },
        async loadAllTrades() {
          return Array.from(store.trades.values());
        },
        async loadAllPositions() {
          return Array.from(store.positions.values());
        },
        async loadRecentSignals() {
          return Array.from(store.signals.values());
        },
        async upsertTrade(trade: StrategyTradeRecord) {
          if (store.failWrites) throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
          store.tradeWriteCalls += 1;
          const key = `${trade.matchId}:${trade.entryType}`;
          const existing = store.trades.get(key);
          if (existing?.status === 'BOOKSET_COMPLETED') return;
          if (trade.status === 'BOOKSET_COMPLETED') {
            store.exitWriteCalls += 1;
          }
          store.trades.set(key, { ...trade });
        },
        async upsertPosition(position: TradePosition) {
          if (store.failWrites) throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
          const key = `${position.matchId}:${position.positionType}`;
          const existing = store.positions.get(key);
          if (existing?.status === 'RECORDED_EXIT') return;
          store.positions.set(key, { ...position });
        },
        async insertSignal(signal: StrategySignal, dedupeHash: string) {
          if (store.failWrites) throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
          if (!store.signals.has(dedupeHash)) {
            store.signals.set(dedupeHash, { ...signal });
          }
        },
        async upsertSnapshot(snapshot: SerializedMatchStrategyState) {
          if (store.failWrites) throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
          store.snapshots.set(snapshot.matchId, JSON.parse(JSON.stringify(snapshot)));
        },
        async deleteMatchStrategy(matchId: string) {
          store.snapshots.delete(matchId);
          for (const k of Array.from(store.trades.keys())) {
            if (k.startsWith(`${matchId}:`)) store.trades.delete(k);
          }
          for (const k of Array.from(store.positions.keys())) {
            if (k.startsWith(`${matchId}:`)) store.positions.delete(k);
          }
          for (const [h, s] of Array.from(store.signals.entries())) {
            if (s.matchId === matchId) store.signals.delete(h);
          }
        },
      };
      return store;
    }

    it('Full Phase 3 lifecycle + server restart rehydration causes zero duplicate trades or exits', async () => {
      const storage = createInMemoryStorage();
      const matchId = 'RESTART_PHASE3_NO_DUP';
      const coord1 = new StrategyPersistenceCoordinator({ storage });

      // 1. Pre-ball BOWLING 98p
      await coord1.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 10, wickets: 0, overs: 1.0 }),
        makeMockOdds(matchId, 'BH-W', 'Brisbane Heat Women', 98)
      );
      // 2. Boundary 1: FOUR (BOWLING 98 -> BATTING 85 = 17p >= 11p, 85 >= 85) -> Confirm Booking
      await coord1.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 14, wickets: 0, overs: 1.1 }),
        makeMockOdds(matchId, 'ADS-W', 'Adelaide Strikers Women', 85)
      );
      // 3. Before next boundary: BATTING 60p, then FOUR -> BATTING 80p (+20p) -> CONFIRMED_PENDING_85
      await coord1.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 14, wickets: 0, overs: 1.2 }),
        makeMockOdds(matchId, 'ADS-W', 'Adelaide Strikers Women', 60)
      );
      await coord1.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 18, wickets: 0, overs: 1.3 }),
        makeMockOdds(matchId, 'ADS-W', 'Adelaide Strikers Women', 80)
      );
      // 4. Later ball reaches 85p -> Deferred FIRST_ENTRY triggered
      await coord1.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 19, wickets: 0, overs: 2.1 }),
        makeMockOdds(matchId, 'ADS-W', 'Adelaide Strikers Women', 85)
      );
      // 5. Wicket falls + BOWLING 64p (< 65) after window (10.2) -> SECOND_ENTRY
      await coord1.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 75, wickets: 1, overs: 10.2 }),
        makeMockOdds(matchId, 'BH-W', 'Brisbane Heat Women', 64)
      );
      // 6. BOWLING 86p (> 85) -> Bookset closes BOTH entries
      await coord1.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 92, wickets: 1, overs: 13.4 }),
        makeMockOdds(matchId, 'BH-W', 'Brisbane Heat Women', 86)
      );

      assert.equal(storage.trades.size, 2);
      assert.equal(storage.trades.get(`${matchId}:FIRST_ENTRY`)?.status, 'BOOKSET_COMPLETED');
      assert.equal(storage.trades.get(`${matchId}:SECOND_ENTRY`)?.status, 'BOOKSET_COMPLETED');
      const writesBeforeRestart = storage.tradeWriteCalls;
      const exitsBeforeRestart = storage.exitWriteCalls;
      assert.equal(exitsBeforeRestart, 2);

      // Restart coordinator & engine
      const coord2 = new StrategyPersistenceCoordinator({ storage });
      const rehydrateSummary = await coord2.rehydrateFromDatabase();
      assert.equal(rehydrateSummary.tradesRestored, 2);

      // Replay post-restart ticks
      await coord2.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 92, wickets: 1, overs: 13.4 }),
        makeMockOdds(matchId, 'BH-W', 'Brisbane Heat Women', 86)
      );
      await coord2.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 96, wickets: 1, overs: 13.5 }),
        makeMockOdds(matchId, 'ADS-W', 'Adelaide Strikers Women', 91)
      );

      assert.equal(storage.trades.size, 2);
      assert.equal(storage.tradeWriteCalls, writesBeforeRestart);
      assert.equal(storage.exitWriteCalls, exitsBeforeRestart);
    });

    it('Rehydrates full state cleanly on boot without firing any alerts', async () => {
      const storage = createInMemoryStorage();
      const matchId = 'REHYDRATE_ZERO_ALERTS';
      const entryTime = new Date('2026-11-17T06:15:00Z');

      const savedTrade1: StrategyTradeRecord = {
        id: 't1',
        matchId,
        matchName: 'ADS-W vs BH-W',
        seriesName: 'WBBL 2026',
        bookingTeam: 'Adelaide Strikers Women',
        battingTeam: 'Adelaide Strikers Women',
        bowlingTeam: 'Brisbane Heat Women',
        entryType: 'FIRST_ENTRY',
        innings: 1,
        entryOver: 2.3,
        entryPaise: 85,
        entryDecimal: 1.85,
        entryWickets: 0,
        entryTime,
        status: 'ACTIVE',
        createdAt: entryTime,
        updatedAt: entryTime,
      };
      const savedTrade2: StrategyTradeRecord = {
        id: 't2',
        matchId,
        matchName: 'ADS-W vs BH-W',
        seriesName: 'WBBL 2026',
        bookingTeam: 'Adelaide Strikers Women',
        battingTeam: 'Adelaide Strikers Women',
        bowlingTeam: 'Brisbane Heat Women',
        entryType: 'SECOND_ENTRY',
        innings: 1,
        entryOver: 4.1,
        entryPaise: 61,
        entryDecimal: 1.61,
        entryWickets: 1,
        entryTime: new Date('2026-11-17T06:22:00Z'),
        status: 'ACTIVE',
        createdAt: new Date('2026-11-17T06:22:00Z'),
        updatedAt: new Date('2026-11-17T06:22:00Z'),
      };

      storage.trades.set(`${matchId}:FIRST_ENTRY`, savedTrade1);
      storage.trades.set(`${matchId}:SECOND_ENTRY`, savedTrade2);
      storage.snapshots.set(matchId, {
        matchId,
        stage: 'ACTIVE_SECOND_ENTRY',
        bookingTeamName: 'Adelaide Strikers Women',
        bookingTeamKey: 'ADS-W',
        pending85: false,
        firstEntryPosition: {
          id: 'pos1',
          matchId,
          positionType: 'FIRST_ENTRY',
          status: 'RECORDED_ENTRY',
          entryOdds: 1.85,
          entryOver: 2.3,
          entryInnings: 1,
          entryWickets: 0,
          entryTimestamp: entryTime,
        },
        secondEntryPosition: {
          id: 'pos2',
          matchId,
          positionType: 'SECOND_ENTRY',
          status: 'RECORDED_ENTRY',
          entryOdds: 1.61,
          entryOver: 4.1,
          entryInnings: 1,
          entryWickets: 1,
          entryTimestamp: savedTrade2.entryTime,
        },
        firstEntryTrade: savedTrade1,
        secondEntryTrade: savedTrade2,
        lastEvaluatedInnings: 1,
        lastEvaluatedOver: 4.2,
        lastEvaluatedWickets: 1,
        lastEvaluatedRuns: 34,
        lastEvaluatedBalls: 2,
        lastEvaluatedLegalBalls: 26,
        lastEvaluatedOdds: 1.61,
        lastEvaluatedPaise: 61,
        lastEvaluatedControl: 'BOWLING',
        preBallControl: 'BOWLING',
        preBallPaise: 61,
        teamInControl: 'BOWLING',
        abnormalActivityCount: 2,
        signalsHistory: [],
        candidates: [],
        processedEventKeys: [],
        lastUpdated: new Date('2026-11-17T06:22:00Z'),
      });

      const sampleSig: StrategySignal = {
        id: 'sig-1',
        signalType: 'FIRST_ENTRY_TRIGGER',
        matchId,
        timestamp: entryTime,
        currentInnings: 1,
        currentOver: 2.3,
        ballNumber: 3,
        relevantOdds: {
          measuredTeam: 'Adelaide Strikers Women',
          teamInControl: 'BATTING',
          currentPaise: 85,
          decimalOdds: 1.85,
        },
        ruleEvaluated: 'FIRST_ENTRY',
        status: 'PASS',
        explanation: 'Restored signal',
      };
      storage.signals.set(buildSignalDedupeHash(sampleSig), sampleSig);

      const alertSpy: any[] = [];
      const coord = new StrategyPersistenceCoordinator({
        storage,
        strategyAlertsEnabled: true,
        onStrategyAlert: async (evt) => {
          alertSpy.push(evt);
        },
      });

      const res = await coord.rehydrateFromDatabase();
      assert.equal(res.matchesRestored, 1);
      assert.equal(res.tradesRestored, 2);
      assert.equal(res.signalsRestored, 1);
      assert.equal(alertSpy.length, 0);

      const restored = coord.engine.getState(matchId);
      assert.equal(restored.stage, 'ACTIVE_SECOND_ENTRY');
      assert.equal(restored.firstEntryTrade?.entryPaise, 85);
      assert.equal(restored.secondEntryTrade?.entryPaise, 61);
      assert.equal(restored.lastEvaluatedLegalBalls, 26);
    });

    it('Unreachable DB queues trades/exits in offline outbox and flushes on recovery', async () => {
      const storage = createInMemoryStorage();
      const matchId = 'OFFLINE_DB_RECOVERY_02';
      const coord = new StrategyPersistenceCoordinator({ storage });

      storage.failWrites = true;

      await coord.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 10, wickets: 0, overs: 1.0 }),
        makeMockOdds(matchId, 'BH-W', 'Brisbane Heat Women', 80),
        { dbAvailable: false }
      );
      await coord.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 14, wickets: 0, overs: 1.1 }),
        makeMockOdds(matchId, 'ADS-W', 'Adelaide Strikers Women', 90),
        { dbAvailable: false }
      );
      await coord.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 14, wickets: 0, overs: 1.3 }),
        makeMockOdds(matchId, 'ADS-W', 'Adelaide Strikers Women', 74),
        { dbAvailable: false }
      );
      await coord.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 18, wickets: 0, overs: 1.5 }),
        makeMockOdds(matchId, 'ADS-W', 'Adelaide Strikers Women', 85),
        { dbAvailable: true }
      );
      await coord.evaluateMatchSnapshot(
        makeMockMatch(matchId, { runs: 36, wickets: 0, overs: 3.3 }),
        makeMockOdds(matchId, 'BH-W', 'Brisbane Heat Women', 89),
        { dbAvailable: false }
      );

      assert.equal(storage.trades.size, 0);
      assert.equal(coord.engine.getState(matchId).stage, 'FIRST_BOOKSET_COMPLETED');
      assert.ok(coord.getPendingCounts().trades >= 1);

      storage.failWrites = false;
      const flushResult = await coord.flushPendingSaves();
      assert.equal(flushResult.remaining, 0);
      assert.ok(flushResult.flushed > 0);
      const saved = storage.trades.get(`${matchId}:FIRST_ENTRY`);
      assert.equal(saved?.entryPaise, 85);
      assert.equal(saved?.exitPaise, 89);
      assert.equal(saved?.status, 'BOOKSET_COMPLETED');
    });

    it('STRATEGY_ALERTS_ENABLED defaults to false and suppresses strategy alerts', async () => {
      const storage = createInMemoryStorage();
      const alertSpy: any[] = [];
      const coord = new StrategyPersistenceCoordinator({
        storage,
        onStrategyAlert: async (evt) => {
          alertSpy.push(evt);
        },
      });

      assert.equal(coord.isStrategyAlertsEnabled(), false);

      const matchId = 'ALERTS_OFF_DEFAULT';
      await coord.recordManualEntry({
        matchId,
        positionType: 'FIRST_ENTRY',
        entryOdds: 1.85,
        innings: 1,
        over: 3.1,
        wickets: 0,
        bookingTeam: 'ADS-W',
        battingTeam: 'ADS-W',
        bowlingTeam: 'BH-W',
      });
      await coord.recordManualExit({
        matchId,
        positionType: 'FIRST_ENTRY',
        exitOdds: 1.86,
        over: 5.2,
      });

      assert.equal(storage.trades.get(`${matchId}:FIRST_ENTRY`)?.status, 'BOOKSET_COMPLETED');
      assert.equal(alertSpy.length, 0);
    });
  });
});
