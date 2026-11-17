/**
 * Strategy Configuration & Thresholds (Phase 3 Final Specification)
 *
 * Rules:
 * - Always trade the batting team using control & control_team_odds directly (no 100-minus computation).
 * 1. Booking Team Confirmation: control = BATTING, control_team_odds >= 85 (85 passes, 84 fails),
 *    on a 4 (>= 11 paise) or 6 (>= 18 paise).
 *    Control-switch formula: (100 - bowling_odds_before) + (100 - batting_odds_after).
 * 2. Wicket safety filter: If 3 or more wickets fall before entry (in either innings), skip the match.
 * 3. Over limits (First Entry): 1st Innings < 10.0 ov; 2nd Innings < 6.0 ov.
 * 4. First Entry / Deferred Entry: After booking confirmed, next 4 (>= 11p) or 6 (>= 18p)
 *    with control = BATTING confirms entry:
 *    - If batting odds >= 85 on that ball, enter immediately.
 *    - If below 85, enter CONFIRMED_PENDING_85 and enter on first later ball with BATTING >= 85 inside window.
 * 5. FIRST_EXIT_BELOW_55: While no wicket has fallen since first entry, exit first entry when
 *    control = BATTING and control_team_odds <= 55 (55 exits, 56 holds). Disabled permanently after any wicket.
 * 6. Second Entry: Only after 1st entry, when a wicket falls after 1st entry and control = BOWLING
 *    with control_team_odds < 65 (64 passes, 65 fails). Works even after the over window.
 * 7. Bookset (Exit) for BOTH entries: control = BOWLING and control_team_odds > 85 (86 passes, 85 holds).
 */

export interface StrategyConfig {
  /** Abnormal Activity on Boundary Rules */
  abnormalActivity: {
    /** Minimum paise change on a Four boundary. Must be >= 11 paise (<= 10 fails). */
    fourMinMovement: number; // 0.11
    /** Minimum paise change on a Six boundary. Must be >= 18 paise (<= 17 fails). */
    sixMinMovement: number;  // 0.18
    /** Minimum paise change in integer paise */
    fourMinPaise: number; // 11
    sixMinPaise: number;  // 18
  };

  /** Pre-entry Wicket Safety Filter */
  wicketFilter: {
    /** If wickets >= 3 before first entry (in either innings), skip/disqualify the match */
    maxAllowedWicketsBeforeEntry: number; // 3 (>= 3 skips)
  };

  /** First Entry & Booking Team Rule Configurations */
  firstEntry: {
    /** Batting control odds >= 85 paise (85 passes, 84 fails) */
    minPaiseInclusive: number; // 85
    minOddsInclusive: number;  // 1.85
  };

  /** Pre-wicket Early Exit for First Entry */
  firstExitBelow55: {
    /** While no wicket has fallen since 1st entry, exit if BATTING <= 55p (55 exits, 56 holds) */
    maxBattingPaiseInclusive: number; // 55
    maxBattingOddsInclusive: number;  // 1.55
  };

  /** Second Entry Rule Configurations */
  secondEntry: {
    /** Requires confirmed wicket strictly after first entry */
    requiresConfirmedWicket: boolean;
    /**
     * Bowling-team control odds threshold for second entry.
     * Rule: control = BOWLING and control_team_odds strictly below 65 paise (< 65 / < 1.65).
     */
    maxBowlingPaiseExclusive: number; // 65
    maxBowlingOddsExclusive: number;  // 1.65
  };

  /** Unified Bookset (Exit) Rule for BOTH First & Second Entries */
  bookset: {
    /**
     * Rule: control = BOWLING and control_team_odds strictly above 85 paise (> 85 / > 1.85).
     */
    minBowlingPaiseExclusive: number; // 85
    minBowlingOddsExclusive: number;  // 1.85
  };

  /** Entry Windows (First entry strictly before over 10 / before over 6) */
  entryWindows: {
    /** First innings: first entry only before over 10 (over < 10.0, e.g. 9.5 passes, 10.0 fails) */
    firstInningsMaxOver: number; // 10.0
    /** Second innings: first entry only before over 6 (over < 6.0, e.g. 5.5 passes, 6.0 fails) */
    secondInningsMaxOver: number; // 6.0
    /** Existing open positions continue monitoring second entry and exits after window closes */
    continueMonitoringExitsAfterWindowCloses: boolean;
  };
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  abnormalActivity: {
    fourMinMovement: 0.11,
    sixMinMovement: 0.18,
    fourMinPaise: 11,
    sixMinPaise: 18,
  },
  wicketFilter: {
    maxAllowedWicketsBeforeEntry: 3,
  },
  firstEntry: {
    minPaiseInclusive: 85,
    minOddsInclusive: 1.85,
  },
  firstExitBelow55: {
    maxBattingPaiseInclusive: 55,
    maxBattingOddsInclusive: 1.55,
  },
  secondEntry: {
    requiresConfirmedWicket: true,
    maxBowlingPaiseExclusive: 65,
    maxBowlingOddsExclusive: 1.65,
  },
  bookset: {
    minBowlingPaiseExclusive: 85,
    minBowlingOddsExclusive: 1.85,
  },
  entryWindows: {
    firstInningsMaxOver: 10.0,
    secondInningsMaxOver: 6.0,
    continueMonitoringExitsAfterWindowCloses: true,
  },
};
