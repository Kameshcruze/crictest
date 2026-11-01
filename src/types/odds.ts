/**
 * Type definitions for Goscorer / Crex Live Odds API (getSV3)
 */

export interface RawGetSV3Response {
  A?: string;
  B?: string | number; // Toss info or status e.g. "NZ opt to bowl" or 1
  D?: string | number; // Session overs markers e.g. "6,20" or 6
  F?: string; // Favorite team key with ^ prefix, e.g. "^O"
  L?: string;
  M?: string;
  R?: string | number; // Indian rate format e.g. "86+1", "0-0,0-0,0-0", "0+0"
  S?: string;
  Z?: string | number; // Session lines e.g. "64+2,208+3"
  a?: string; // Team codes separated by dot e.g. "R.O"
  b?: string;
  c?: string;
  ca?: number;
  cl?: Array<{ code: string; name: string }>;
  d?: string;
  dt_id?: string; // discrete match ID
  ed?: number;
  f?: number;
  fo?: string; // Format e.g. "T20I"
  g?: string;
  gen?: number;
  h?: string;
  i?: string;
  j?: string; // Score e.g. "0/0(0.0"
  l?: string;
  m?: string;
  mn?: string;
  ms?: number;
  mt?: number;
  n?: string;
  n1?: number;
  o?: string;
  oh?: number;
  p?: string;
  q?: string;
  r?: string;
  s?: string;
  sd?: number;
  sf?: string;
  source_id?: number;
  speech_names?: Record<string, string>; // e.g. { "O": "India", "R": "New Zealand" }
  st?: string;
  t?: string;
  tp?: number;
  tti?: number;
  wp?: string; // Win probability string e.g. "R,64172,141708,0"
  y?: string;
  z?: string;
  [key: string]: unknown;
}

export interface BookmakerOdds {
  /** Indian rate string as returned by API, e.g. "86+1" */
  rawRateString: string;
  /** Back rate in paise / percentage points, e.g. 86 (meaning 86/100) */
  backRate: number | null;
  /** Lay rate in paise / percentage points, e.g. 87 (86 + 1) */
  layRate: number | null;
  /** Decimal Back odds, e.g. 1.86 */
  decimalBack: number | null;
  /** Decimal Lay odds, e.g. 1.87 */
  decimalLay: number | null;
  /** Whether trading is currently suspended or rates are 0-0 */
  isSuspended: boolean;
  /** Spread difference between back and lay (e.g. 1) */
  spread: number | null;
}

export interface SessionMarket {
  /** Target overs for the session, e.g. 6 or 20 */
  overs: number;
  /** Lower run boundary (No / Under threshold) */
  low: number;
  /** Upper run boundary (Yes / Over threshold) */
  high: number;
  /** Difference / spread between low and high */
  spread: number;
  /** Raw representation string from API, e.g. "64+2" */
  rawString: string;
}

export interface ParsedMatchOdds {
  /** Unique match identifier used for the odds lookup (e.g. "12JG") */
  matchKey: string;
  /** Discrete match identifier from the API (e.g. "3377699741002338") */
  dtId?: string;
  /** Match format (e.g. "T20I", "ODI", "Test") */
  format?: string;
  /** Match status text or toss announcement */
  statusText?: string;
  /** Favorite team key (e.g. "O") */
  favoriteTeamKey?: string;
  /** Favorite team resolved name (e.g. "India") */
  favoriteTeamName?: string;
  /** Team names map returned in the odds payload */
  speechNames: Record<string, string>;
  /** Parsed bookmaker odds (Back and Lay) */
  bookmaker: BookmakerOdds;
  /** Parsed session fancy markets (e.g. 6-over, 20-over) */
  sessions: SessionMarket[];
  /** Raw API payload */
  raw: RawGetSV3Response;
  /** API fetch response latency in milliseconds */
  latencyMs: number;
  /** Timestamp when the odds data was retrieved */
  timestamp: Date;
}

export type OddsRequestStatus = 'idle' | 'loading' | 'success' | 'error' | 'unavailable';

export interface OddsConsistencyResult {
  isConsistent: boolean;
  status: 'verified' | 'unverified' | 'mismatch';
  dtIdMatched?: boolean;
  teamsMatched?: boolean;
  reason: string;
}

export interface OddsTick {
  timestamp: Date;
  rawRateString: string;
  backRate: number | null;
  layRate: number | null;
  decimalBack: number | null;
  decimalLay: number | null;
  spread: number | null;
  isSuspended: boolean;
}

export interface OddsMovement {
  direction: 'up' | 'down' | 'stable';
  deltaBack: number;
  deltaLay: number;
  lastChangedAt?: Date;
}

export interface MatchOddsState {
  matchId: string;
  oddsKey: string;
  maskedKey: string;
  status: OddsRequestStatus;
  odds: ParsedMatchOdds | null;
  previousOdds?: ParsedMatchOdds | null;
  movement?: OddsMovement;
  history?: OddsTick[];
  error?: string;
  recordsCount: number;
  lastUpdated?: Date;
  consistency: OddsConsistencyResult;
}

