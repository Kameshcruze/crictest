/**
 * Strategy Configuration & Ambiguity Specifications (Phase 6)
 *
 * All thresholds, boundary definitions, and measurement configurations are
 * declared here so that rules remain explicit and decoupled from UI components.
 */

export interface StrategyConfig {
  /** Abnormal Activity Rule Configurations */
  abnormalActivity: {
    /** Minimum odds movement on a Four boundary. Must be >= 0.11. Movement of <= 0.10 fails. */
    fourMinMovement: number;
    /** Minimum odds movement on a Six boundary. Must be >= 0.18. Movement of <= 0.17 fails. */
    sixMinMovement: number;
    /**
     * Ambiguity Isolation:
     * Crex API directly quotes the market favorite team rate. This config specifies
     * which team's decimal odds movement is measured during a boundary event.
     * Options: 'favorite' (default, directly quoted) | 'batting' | 'bowling'.
     */
    measuredTeamTarget: 'favorite' | 'batting' | 'bowling';
  };

  /** First Entry Rule Configurations */
  firstEntry: {
    /** Minimum qualifying entry decimal odds (inclusive). Lower boundary: 1.85 */
    minOdds: number;
    /** Maximum qualifying entry decimal odds (inclusive). Upper boundary: 2.00 */
    maxOdds: number;
    /** First bookset exit target lower bound (inclusive): 1.45 */
    booksetTargetMin: number;
    /** First bookset exit target upper bound (inclusive): 1.55 */
    booksetTargetMax: number;
  };

  /** Second Entry Rule Configurations */
  secondEntry: {
    /** Requires confirmed wicket strictly after first entry is established */
    requiresConfirmedWicket: boolean;
    /**
     * Opposing-team odds threshold for second-entry candidate.
     * Rule: Must be strictly below 1.65 (< 1.65). 1.65 and 1.66 do NOT qualify.
     */
    maxOpposingOddsExclusive: number;
    /**
     * Opposing-team odds threshold for second-entry bookset.
     * Rule: Must reach 1.85 or higher (>= 1.85). 1.84 does NOT qualify.
     */
    minBooksetOpposingOddsInclusive: number;
    /**
     * Ambiguity Isolation:
     * How opposing-team odds are derived when the odds API quotes the primary team.
     * 'complementary': Uses standard 2-way exchange probability: 1 / (1 - 1 / favoriteOdds).
     * 'direct_if_available': Uses direct opposing rate if both teams are quoted in raw payload.
     */
    opposingOddsDerivation: 'complementary' | 'direct_if_available';
  };

  /** Entry Windows */
  entryWindows: {
    /** First innings: Evaluate new entries during the first 10 overs (0.0 to 10.0 overs) */
    firstInningsMaxOver: number;
    /** Second innings: Evaluate new entries during the first 6 overs (0.0 to 6.0 overs) */
    secondInningsMaxOver: number;
    /** Existing positions continue monitoring exit/bookset conditions after entry window closes */
    continueMonitoringExitsAfterWindowCloses: boolean;
  };

  /** Documented Ambiguities & Clarification Notes */
  ambiguities: {
    issueId: string;
    topic: string;
    description: string;
    currentResolution: string;
    clarificationNeededFromUser: string;
  }[];
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  abnormalActivity: {
    fourMinMovement: 0.11, // >= 0.11 qualifies; <= 0.10 does not
    sixMinMovement: 0.18,  // >= 0.18 qualifies; <= 0.17 does not
    measuredTeamTarget: 'favorite',
  },
  firstEntry: {
    minOdds: 1.85,
    maxOdds: 2.00,
    booksetTargetMin: 1.45,
    booksetTargetMax: 1.55,
  },
  secondEntry: {
    requiresConfirmedWicket: true,
    maxOpposingOddsExclusive: 1.65, // < 1.65 qualifies; 1.65 and 1.66 fail
    minBooksetOpposingOddsInclusive: 1.85, // >= 1.85 qualifies; 1.84 fails
    opposingOddsDerivation: 'complementary',
  },
  entryWindows: {
    firstInningsMaxOver: 10.0,
    secondInningsMaxOver: 6.0,
    continueMonitoringExitsAfterWindowCloses: true,
  },
  ambiguities: [
    {
      issueId: 'AMB-01-TEAM-ODDS-MEASUREMENT',
      topic: 'Boundary Odds Movement Team Target',
      description:
        'The Crex / Goscorer API (getSV3) returns bookmaker odds for the current favorite team (e.g., ^O or ^R). When a Four or Six occurs, the odds shift could be measured on the favorite team, the batting team, or the bowling team.',
      currentResolution:
        'Configured to measure the favorite team (measuredTeamTarget = "favorite"), whose odds are continuously quoted in decimalBack/decimalLay. If batting team equals favorite, movement directly reflects batting team firming. Absolute delta magnitude is evaluated.',
      clarificationNeededFromUser:
        'Should abnormal activity always measure the batting team odds specifically (even if underdogs), or the current market favorite team odds?',
    },
    {
      issueId: 'AMB-02-OPPOSING-ODDS-DERIVATION',
      topic: 'Opposing-Team Odds Calculation',
      description:
        'Second-entry rule requires evaluating opposing-team odds (below 1.65, and bookset at 1.85+). When the API returns single-sided odds for Team A (e.g. Back 1.90), Team B odds are not always explicitly quoted in a separate field.',
      currentResolution:
        'Derived using the standard exchange 2-way complementary formula: OpposingOdds = 1 / (1 - 1 / FavoriteOdds) rounded to 2 decimal places (e.g., Favorite at 2.60 -> Opposing at 1.63). If direct dual rates are available, direct rates take precedence.',
      clarificationNeededFromUser:
        'Does your trading venue provide separate explicit opposing-team prices, or should we continue computing opposing odds using the standard 2-way complement formula?',
    },
    {
      issueId: 'AMB-03-BOOKSET-TARGET-DIRECTION',
      topic: 'First Bookset Target Range vs Single Threshold',
      description:
        'First bookset target range is 1.45 to 1.55. In trading, once odds shorten into or below 1.55 down to 1.45, exit is active.',
      currentResolution:
        'Evaluated as inclusive range [1.45, 1.55]. If odds shorten to within 1.45 - 1.55 (or reach <= 1.55 down to 1.45), FIRST_BOOKSET_TARGET signals PASS.',
      clarificationNeededFromUser:
        'If odds gap below 1.45 (e.g. 1.40 after a wicket), should bookset still trigger as an exit, or does it strictly require landing between 1.45 and 1.55?',
    },
  ],
};
