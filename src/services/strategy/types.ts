/**
 * Types for Cricket Trading Strategy Engine (Abnormal Boundary & Booking Team Strategy)
 */

export type SignalStatus = 'PASS' | 'FAIL' | 'DATA UNAVAILABLE';

export type SignalType =
  | 'ABNORMAL_ACTIVITY_FOUR'
  | 'ABNORMAL_ACTIVITY_SIX'
  | 'BOOKING_TEAM_CONFIRMED'
  | 'ENTRY_CONFIRMATION_BOUNDARY'
  | 'ENTRY_CONFIRMED_WAITING_85'
  | 'FIRST_ENTRY_CANDIDATE'
  | 'FIRST_ENTRY_TRIGGER'
  | 'FIRST_BOOKSET_TARGET'
  | 'SECOND_ENTRY_CANDIDATE'
  | 'SECOND_ENTRY_TRIGGER'
  | 'SECOND_BOOKSET_TARGET'
  | 'FULL_BOOKSET_TARGET'
  | 'DISQUALIFIED_WICKET_LIMIT'
  | 'WICKET_EVENT';

export type PositionType = 'FIRST_ENTRY' | 'SECOND_ENTRY';

export type PositionStatus =
  | 'NONE'
  | 'CANDIDATE_DETECTED'
  | 'RECORDED_ENTRY'
  | 'EXIT_CANDIDATE_DETECTED'
  | 'RECORDED_EXIT'
  | 'CANCELLED';

export type StrategyStage =
  | 'WAITING_FOR_CONFIRMATION'
  | 'DISQUALIFIED_3_WICKETS'
  | 'CONFIRMED_BOOKING_TEAM'
  | 'CONFIRMED_PENDING_85'
  | 'ACTIVE_FIRST_ENTRY'
  | 'FIRST_BOOKSET_COMPLETED'
  | 'ACTIVE_SECOND_ENTRY'
  | 'FULL_BOOKSET_COMPLETED'
  | 'WINDOW_EXPIRED';

export type TeamControlState = 'BATTING' | 'BOWLING' | 'UNKNOWN';

export interface RelevantOddsInfo {
  measuredTeam: string;
  teamInControl?: TeamControlState;
  currentPaise?: number | null;
  previousPaise?: number | null;
  calculatedDelta?: number | null;
  decimalOdds: number | null;
  previousDecimalOdds?: number | null;
  oddsDelta?: number | null;
  opposingTeamOdds?: number | null;
  bookmakerRateString?: string;
  spread?: number | null;
  isStale?: boolean;
}

export interface StrategySignal {
  id: string;
  signalType: SignalType;
  matchId: string;
  timestamp: Date;
  currentInnings: number;
  currentOver: number;
  ballNumber: number;
  relevantOdds: RelevantOddsInfo;
  ruleEvaluated: string;
  status: SignalStatus;
  explanation: string;
  metadata?: Record<string, unknown>;
}

export interface TradePosition {
  id: string;
  matchId: string;
  positionType: PositionType;
  status: PositionStatus;
  candidateSignalId?: string;
  entryOdds?: number;
  entryTimestamp?: Date;
  entryOver?: number;
  entryInnings?: number;
  /** Wickets count at the exact moment of entry (used for second-entry wicket confirmation) */
  entryWickets?: number;
  exitOdds?: number;
  exitTimestamp?: Date;
  exitOver?: number;
  booksetSignalId?: string;
}

/**
 * Dedicated database trade model for the strategy_trades table.
 * Records every entry and exit with complete ball, over, paise, and odds metrics.
 */
export interface StrategyTradeRecord {
  id: string;
  matchId: string;
  matchName?: string;
  seriesName?: string;
  bookingTeam: string;
  battingTeam: string;
  bowlingTeam: string;
  entryType: PositionType;
  innings: number;
  entryOver: number;
  entryPaise: number;
  entryDecimal: number;
  entryWickets: number;
  entryTime: Date;
  exitOver?: number;
  exitPaise?: number;
  exitDecimal?: number;
  exitTime?: Date;
  exitReason?: 'FIRST_BOOKSET_45_55' | 'FULL_BOOKSET_OPPOSING_85';
  status: 'ACTIVE' | 'BOOKSET_COMPLETED' | 'CANCELLED';
  createdAt: Date;
  updatedAt: Date;
}

export interface MatchStrategyState {
  matchId: string;
  stage: StrategyStage;
  bookingTeamName?: string | null;
  bookingTeamKey?: string | null;
  battingTeamKey?: string | null;
  bowlingTeamKey?: string | null;
  teamInControl: TeamControlState;
  firstEntryPosition: TradePosition;
  secondEntryPosition: TradePosition;
  firstEntryTrade?: StrategyTradeRecord | null;
  secondEntryTrade?: StrategyTradeRecord | null;
  pending85: boolean;
  signalsHistory: StrategySignal[];
  candidates: StrategySignal[];
  lastEvaluatedOver: number;
  lastEvaluatedWickets: number;
  lastEvaluatedRuns: number;
  lastEvaluatedBalls: number;
  lastEvaluatedOdds: number | null;
  lastEvaluatedPaise: number | null;
  lastEvaluatedControl: TeamControlState;
  bookingConfirmedBoundary?: {
    type: 'FOUR' | 'SIX';
    over: number;
    ball: number;
    paiseDelta: number;
    timestamp: Date;
  } | null;
  entryConfirmedBoundary?: {
    type: 'FOUR' | 'SIX';
    over: number;
    ball: number;
    paiseDelta: number;
    timestamp: Date;
  } | null;
  processedEventKeys: Set<string>;
  abnormalActivityCount: number;
  lastUpdated: Date;
}
