/**
 * Type definitions for Crex Cricket API data
 */

export interface RawCrexMatch {
  a?: string;
  b: string; // Team 1 key
  c: string; // Team 2 key
  cb?: string; // Cricket board
  cc?: string;
  d: number; // 0 = upcoming, 1 = live, 2 = completed, 6 = drawn
  dt_id?: string;
  e?: string | number;
  es_id?: number;
  f?: number;
  finishTime?: number;
  flb?: string; // Live betting / market odds
  fo?: string; // Format e.g. "ODI", "Test", "T20I", "First Class"
  fs?: number;
  fta?: string;
  g?: number | string;
  gc?: number;
  gi?: number;
  h?: number | string;
  i?: number | string;
  j?: string; // Innings 1 score e.g. "198/3(20.0"
  k?: string; // Innings 2 score e.g. "199/4(13.2"
  l?: string; // Innings 3 score
  m?: string; // Innings 4 score
  match_cohort?: string;
  mm?: string;
  n?: number;
  n1?: number;
  oi?: string;
  q: string; // Series key
  r?: string;
  relevant_team_fkey?: string;
  res?: string; // Result string e.g. "IND won by 6 wickets"
  s?: string; // Day/Session info e.g. "1/3/90"
  t?: number;
  ti: number; // Match start timestamp in milliseconds
  v: string; // Venue key
  wp?: string; // Win probability e.g. "R,218014,646624,13"
  [key: string]: unknown;
}

export interface RawApiResponse {
  [matchId: string]: RawCrexMatch;
}

export interface TeamInfo {
  key: string;
  name: string;
  shortName: string;
  color: string;
  textColor?: string;
  darkColor?: string;
  lightColor?: string;
}

export interface ParsedInningsScore {
  inningIndex: number;
  runs: number;
  wickets: number;
  overs: number;
  completedOvers: number;
  ballsInOver: number;
  totalBalls: number;
  runRate: number;
  rawString: string;
  teamCode?: string;
}

export interface WinProbability {
  team1Prob: number;
  team2Prob: number;
  favoriteTeamKey?: string;
}

export interface ParsedCricketMatch {
  id: string;
  team1: TeamInfo;
  team2: TeamInfo;
  seriesName: string;
  seriesKey: string;
  venueName: string;
  venueKey: string;
  format: string;
  status: 'live' | 'upcoming' | 'completed';
  statusLabel: string;
  statusDetail?: string;
  resultText?: string;
  sessionText?: string;
  innings: ParsedInningsScore[];
  team1Score?: ParsedInningsScore;
  team2Score?: ParsedInningsScore;
  startTime: Date;
  finishTime?: Date;
  winProbability?: WinProbability;
  odds?: string;
  board?: string;
  target?: number;
  requiredRunRate?: number;
  currentRunRate?: number;
  battingTeamKey?: string;
  raw: RawCrexMatch;
}
