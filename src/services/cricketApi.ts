import {
  RawApiResponse,
  RawCrexMatch,
  ParsedCricketMatch,
  ParsedInningsScore,
  WinProbability,
} from '../types/cricket';
import { resolveTeam, resolveVenue, resolveSeries, KNOWN_TEAMS, KNOWN_VENUES, KNOWN_SERIES } from '../data/cricketMapping';

export const API_ENDPOINT = '/api/top-matches';
export const DIRECT_GOSCORER_ENDPOINT = 'https://api.goscorer.com/api/v2/getTopMatches';

/**
 * Register dynamic teams, venues, series returned from Crex mapping
 */
export function registerDynamicMapping(mapping?: { teams?: any[]; venues?: any[]; series?: any[] }) {
  if (!mapping) return;

  if (Array.isArray(mapping.teams)) {
    mapping.teams.forEach((t) => {
      if (t.f_key && t.n) {
        KNOWN_TEAMS[t.f_key] = {
          key: t.f_key,
          name: t.n,
          shortName: t.sn || t.n.slice(0, 3).toUpperCase(),
          color: t.uc || t.cc?.split('#')[1] ? `#${t.cc.split('#')[1]}` : '#2563eb',
          textColor: '#ffffff',
          darkColor: t.dc || '#1e3a8a',
        };
      }
    });
  }

  if (Array.isArray(mapping.venues)) {
    mapping.venues.forEach((v) => {
      if (v.f_key && v.n) {
        KNOWN_VENUES[v.f_key] = v.n;
      }
    });
  }

  if (Array.isArray(mapping.series)) {
    mapping.series.forEach((s) => {
      if (s.f_key && s.n) {
        KNOWN_SERIES[s.f_key] = s.n;
      }
    });
  }
}

/**
 * Parses Crex raw score string like "198/3(20.0" or "123/0(24.4"
 */
export function parseInningsScore(raw?: string, inningIndex = 1): ParsedInningsScore | undefined {
  if (!raw || typeof raw !== 'string') return undefined;

  const clean = raw.trim();
  const match = clean.match(/^(\d+)(?:\/(\d+))?(?:\((\d+(?:\.\d+)?))?/);
  if (!match) return undefined;

  const runs = parseInt(match[1], 10) || 0;
  const wickets = match[2] !== undefined ? parseInt(match[2], 10) : 0;
  const oversStr = match[3] || '0';
  const overs = parseFloat(oversStr) || 0;

  const parts = oversStr.split('.');
  const completedOvers = parseInt(parts[0], 10) || 0;
  const ballsInOver = parts[1] ? parseInt(parts[1], 10) : 0;
  const totalBalls = completedOvers * 6 + Math.min(ballsInOver, 6);

  const runRate = totalBalls > 0 ? Number(((runs / (totalBalls / 6))).toFixed(2)) : 0;

  return {
    inningIndex,
    runs,
    wickets,
    overs,
    completedOvers,
    ballsInOver,
    totalBalls,
    runRate,
    rawString: raw,
  };
}

/**
 * Parse win probability string like "R,218014,646624,13"
 */
export function parseWinProbability(wpStr?: string, team1Key?: string, team2Key?: string): WinProbability | undefined {
  if (!wpStr || typeof wpStr !== 'string') return undefined;

  const parts = wpStr.split(',');
  if (parts.length >= 3) {
    const favoriteTeam = parts[0];
    const val1 = parseFloat(parts[1]);
    const val2 = parseFloat(parts[2]);

    if (!isNaN(val1) && !isNaN(val2) && val1 + val2 > 0) {
      const sum = val1 + val2;
      const prob1 = Math.round((val1 / sum) * 100);
      const prob2 = 100 - prob1;

      return {
        team1Prob: prob1,
        team2Prob: prob2,
        favoriteTeamKey: favoriteTeam,
      };
    }
  }

  return undefined;
}

/**
 * Transforms a single Crex raw match object into a clean parsed match model
 */
export function transformCrexMatch(id: string, raw: RawCrexMatch): ParsedCricketMatch {
  const team1 = resolveTeam(raw.b);
  const team2 = resolveTeam(raw.c);
  const venueName = resolveVenue(raw.v);
  const seriesName = resolveSeries(raw.q);
  const format = (raw.fo || 'Match').trim();

  // Innings parsing
  const innings: ParsedInningsScore[] = [];
  if (raw.j) {
    const inn1 = parseInningsScore(raw.j, 1);
    if (inn1) {
      inn1.teamCode = team1.shortName;
      innings.push(inn1);
    }
  }
  if (raw.k) {
    const inn2 = parseInningsScore(raw.k, 2);
    if (inn2) {
      inn2.teamCode = team2.shortName;
      innings.push(inn2);
    }
  }
  if (raw.l) {
    const inn3 = parseInningsScore(raw.l, 3);
    if (inn3) innings.push(inn3);
  }
  if (raw.m) {
    const inn4 = parseInningsScore(raw.m, 4);
    if (inn4) innings.push(inn4);
  }

  const team1Score = innings[0];
  const team2Score = innings[1];

  // Precise status determination matching Crex criteria
  let status: 'live' | 'upcoming' | 'completed' = 'upcoming';
  let statusLabel = 'Upcoming';

  const resLower = (raw.res || '').toLowerCase();
  const isTerminalResult =
    resLower.includes('won by') ||
    resLower.includes('won') ||
    resLower.includes('drawn') ||
    resLower.includes('tied') ||
    resLower.includes('no result') ||
    resLower.includes('abandoned');

  const isInMatchBreak =
    resLower.includes('innings break') ||
    resLower.includes('lunch break') ||
    resLower.includes('tea break') ||
    resLower.includes('dinner break') ||
    resLower.includes('stumps') ||
    resLower.includes('delay') ||
    resLower.includes('break');

  // Match is completed ONLY if finishTime exists or has a terminal win/draw result
  if (raw.finishTime || (isTerminalResult && !isInMatchBreak)) {
    status = 'completed';
    statusLabel = raw.res || (raw.d === 6 ? 'Match Drawn' : 'Match Ended');
  } else if (raw.j || raw.k || isInMatchBreak || raw.d === 1 || raw.d === 2) {
    // Has live score or is currently in progress
    if (raw.j || raw.k || isInMatchBreak) {
      status = 'live';
      statusLabel = raw.res || 'Live';
    } else {
      status = 'upcoming';
      statusLabel = 'Upcoming';
    }
  } else {
    status = 'upcoming';
    statusLabel = 'Upcoming';
  }

  // Active Batting Team detection
  let battingTeamKey: string | undefined;
  if (status === 'live') {
    if (raw.k && team2Score) {
      // 2nd innings is underway: Team 2 is batting
      battingTeamKey = raw.c;
    } else if (raw.j && team1Score) {
      // 1st innings is underway: Team 1 is batting
      battingTeamKey = raw.b;
    }
  }

  // Target and Run Rates calculation
  let target: number | undefined;
  let requiredRunRate: number | undefined;
  let currentRunRate: number | undefined;

  if (status === 'live' && team1Score) {
    if (!team2Score) {
      currentRunRate = team1Score.runRate;
    } else {
      target = team1Score.runs + 1;
      currentRunRate = team2Score.runRate;

      let maxOvers = 20;
      if (format.includes('ODI') || format.includes('List A')) maxOvers = 50;
      if (format.includes('T20')) maxOvers = 20;
      if (format.includes('Test') || format.includes('First Class')) maxOvers = 0;

      if (maxOvers > 0) {
        const totalBalls = maxOvers * 6;
        const ballsRemaining = Math.max(0, totalBalls - team2Score.totalBalls);
        const runsNeeded = Math.max(0, target - team2Score.runs);
        if (ballsRemaining > 0) {
          requiredRunRate = Number(((runsNeeded / (ballsRemaining / 6))).toFixed(2));
        }
      }
    }
  }

  const winProbability = parseWinProbability(raw.wp, raw.b, raw.c);

  // Parse start time (can be timestamp number or relative string)
  let startTime = new Date();
  if (typeof raw.ti === 'number') {
    startTime = new Date(raw.ti);
  }

  return {
    id,
    team1,
    team2,
    seriesName,
    seriesKey: raw.q,
    venueName,
    venueKey: raw.v,
    format,
    status,
    statusLabel,
    statusDetail: raw.s || undefined,
    resultText: raw.res || undefined,
    sessionText: raw.s || undefined,
    innings,
    team1Score,
    team2Score,
    startTime,
    finishTime: raw.finishTime ? new Date(raw.finishTime) : undefined,
    winProbability,
    odds: raw.flb,
    board: raw.cb,
    target,
    requiredRunRate,
    currentRunRate,
    battingTeamKey,
    raw,
  };
}

export interface FetchResult {
  matches: ParsedCricketMatch[];
  raw: RawApiResponse;
  latencyMs: number;
  timestamp: Date;
  matchCount: number;
}

/**
 * Fetch top matches, trying full-stack proxy route first (which aggregates all Crex live matches),
 * and falling back directly to Goscorer API if needed.
 */
export async function fetchCrexTopMatches(countryCode = 'IN'): Promise<FetchResult> {
  const startTime = performance.now();
  let rawData: RawApiResponse = {};
  let mapping: any = null;

  try {
    // 1. Try our internal server endpoint which merges getTopMatches and desktopTopMatchesRaw
    const response = await fetch('/api/top-matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cc: countryCode }),
    });

    if (response.ok) {
      const data = await response.json();
      rawData = data.matches || {};
      mapping = data.mapping;
      registerDynamicMapping(mapping);
    } else {
      throw new Error(`Server returned HTTP ${response.status}`);
    }
  } catch (serverErr) {
    // Fallback: direct Goscorer API fetch
    const response = await fetch(DIRECT_GOSCORER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cc: countryCode }),
    });

    if (!response.ok) {
      throw new Error(`Crex API returned HTTP ${response.status}: ${response.statusText}`);
    }

    rawData = await response.json();
  }

  const latencyMs = Math.round(performance.now() - startTime);
  const matches: ParsedCricketMatch[] = [];

  for (const [id, rawMatch] of Object.entries(rawData)) {
    if (rawMatch && typeof rawMatch === 'object' && rawMatch.b && rawMatch.c) {
      matches.push(transformCrexMatch(id, rawMatch));
    }
  }

  // Sort: Live matches first, then Upcoming, then Completed
  matches.sort((a, b) => {
    const statusPriority = { live: 0, upcoming: 1, completed: 2 };
    if (statusPriority[a.status] !== statusPriority[b.status]) {
      return statusPriority[a.status] - statusPriority[b.status];
    }
    if (a.status === 'upcoming') {
      return a.startTime.getTime() - b.startTime.getTime();
    }
    if (a.status === 'completed') {
      return (b.finishTime?.getTime() || b.startTime.getTime()) - (a.finishTime?.getTime() || a.startTime.getTime());
    }
    return b.startTime.getTime() - a.startTime.getTime();
  });

  return {
    matches,
    raw: rawData,
    latencyMs,
    timestamp: new Date(),
    matchCount: matches.length,
  };
}

/**
 * Web Audio sound generator for live cricket events
 */
export function playAlertSound(type: 'wicket' | 'boundary' | 'refresh' = 'refresh'): void {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'wicket') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(580, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.35);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'boundary') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.25);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    }
  } catch {
    // Ignore audio context restrictions if blocked
  }
}
