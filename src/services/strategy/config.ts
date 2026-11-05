/**
 * Strategy Configuration & Thresholds
 *
 * Rules:
 * 1. Booking Team Confirmation: Batting team in control hits 4 (>= 11 paise) or 6 (>= 18 paise).
 *    Flip formula: (100 - Pprev) + (100 - Pcurr) when bowling was in control.
 * 2. Wicket safety filter: If 3 or more wickets fall before entry, match is skipped.
 * 3. Over limits: 1st Innings <= 10.0 ov; 2nd Innings <= 6.0 ov.
 * 4. First Entry: Batting team in control, 4 (>= 11 paise) or 6 (>= 18 paise), current paise >= 85 (or held till >= 85).
 * 5. First Bookset: Batting team paise reaches 45 to 55 paise (decimal 1.45 - 1.55).
 * 6. Second Entry: Confirmed wicket before first bookset, opposite team odds < 65 paise (decimal < 1.65).
 * 7. Combined Bookset: Opposite team odds >= 85 paise (decimal >= 1.85).
 */

export interface StrategyConfig {
  /** Abnormal Activity on Boundary Rules */
  abnormalActivity: {
    /** Minimum paise change on a Four boundary. Must be >= 11 paise (<= 10 fails). */
    fourMinMovement: number; // 0.11 or 11 paise
    /** Minimum paise change on a Six boundary. Must be >= 18 paise (<= 17 fails). */
    sixMinMovement: number;  // 0.18 or 18 paise
    /** Minimum paise change in integer paise */
    fourMinPaise: number; // 11
    sixMinPaise: number;  // 18
  };

  /** Pre-entry Wicket Safety Filter */
  wicketFilter: {
    /** If wickets >= 3 before first entry, skip/disqualify the match entirely */
    maxAllowedWicketsBeforeEntry: number; // 3 (>= 3 skips)
  };

  /** First Entry Rule Configurations */
  firstEntry: {
    /** Minimum qualifying entry paise (>= 85 paise, decimal >= 1.85) */
    minPaise: number; // 85
    minOdds: number;  // 1.85
    maxOdds: number;  // 2.00
    /** First bookset exit target range: 45 to 55 paise (decimal 1.45 - 1.55) */
    booksetTargetMinPaise: number; // 45
    booksetTargetMaxPaise: number; // 55
    booksetTargetMin: number;      // 1.45
    booksetTargetMax: number;      // 1.55
  };

  /** Second Entry Rule Configurations */
  secondEntry: {
    /** Requires confirmed wicket strictly after first entry */
    requiresConfirmedWicket: boolean;
    /**
     * Opposing-team odds threshold for second entry.
     * Rule: Must be strictly below 65 paise / decimal 1.65 (< 65 / < 1.65).
     */
    maxOpposingPaiseExclusive: number; // 65
    maxOpposingOddsExclusive: number;  // 1.65
    /**
     * Combined bookset exit for both 1st and 2nd entries:
     * Rule: Opposite team odds must reach 85 paise or higher (>= 85 / >= 1.85).
     */
    minBooksetOpposingPaiseInclusive: number; // 85
    minBooksetOpposingOddsInclusive: number;  // 1.85
  };

  /** Entry Windows */
  entryWindows: {
    /** First innings: Evaluate new entries during the first 10 overs (0.0 to 10.0 overs) */
    firstInningsMaxOver: number; // 10.0
    /** Second innings: Evaluate new entries during the first 6 overs (0.0 to 6.0 overs) */
    secondInningsMaxOver: number; // 6.0
    /** Existing positions continue monitoring exit/bookset conditions after entry window closes */
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
    minPaise: 85,
    minOdds: 1.85,
    maxOdds: 2.00,
    booksetTargetMinPaise: 45,
    booksetTargetMaxPaise: 55,
    booksetTargetMin: 1.45,
    booksetTargetMax: 1.55,
  },
  secondEntry: {
    requiresConfirmedWicket: true,
    maxOpposingPaiseExclusive: 65,
    maxOpposingOddsExclusive: 1.65,
    minBooksetOpposingPaiseInclusive: 85,
    minBooksetOpposingOddsInclusive: 1.85,
  },
  entryWindows: {
    firstInningsMaxOver: 10.0,
    secondInningsMaxOver: 6.0,
    continueMonitoringExitsAfterWindowCloses: true,
  },
};
