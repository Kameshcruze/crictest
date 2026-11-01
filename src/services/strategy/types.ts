/**
 * Types for Cricket Trading Strategy Engine (Phase 6)
 */

export type SignalStatus = 'PASS' | 'FAIL' | 'DATA UNAVAILABLE';

export type SignalType =
  | 'ABNORMAL_ACTIVITY_FOUR'
  | 'ABNORMAL_ACTIVITY_SIX'
  | 'FIRST_ENTRY_CANDIDATE'
  | 'FIRST_BOOKSET_TARGET'
  | 'SECOND_ENTRY_CANDIDATE'
  | 'SECOND_BOOKSET_TARGET'
  | 'WICKET_EVENT';

export type PositionType = 'FIRST_ENTRY' | 'SECOND_ENTRY';

export type PositionStatus =
  | 'NONE'
  | 'CANDIDATE_DETECTED'
  | 'RECORDED_ENTRY'
  | 'EXIT_CANDIDATE_DETECTED'
  | 'RECORDED_EXIT'
  | 'CANCELLED';

export interface RelevantOddsInfo {
  measuredTeam: string;
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

export interface MatchStrategyState {
  matchId: string;
  firstEntryPosition: TradePosition;
  secondEntryPosition: TradePosition;
  signalsHistory: StrategySignal[];
  candidates: StrategySignal[];
  lastEvaluatedOver: number;
  lastEvaluatedWickets: number;
  lastEvaluatedOdds: number | null;
  processedEventKeys: Set<string>;
  abnormalActivityCount: number;
  lastUpdated: Date;
}
