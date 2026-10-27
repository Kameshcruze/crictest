import {
  RawApiResponse,
  RawCrexMatch,
  ParsedCricketMatch,
  ParsedInningsScore,
  WinProbability,
} from '../types/cricket';
import { resolveTeam, resolveVenue, resolveSeries, KNOWN_TEAMS, KNOWN_VENUES, KNOWN_SERIES } from '../data/cricketMapping';

export const LOCAL_ENDPOINT = '/api/top-matches';
export const DIRECT_GOSCORER_ENDPOINT = 'https://api.goscorer.com/api/v2/getTopMatches';
export const API_ENDPOINT = DIRECT_GOSCORER_ENDPOINT;

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
          color: t.uc || (t.cc?.split('#')[1] ? `#${t.cc.split('#')[1]}` : '#2563eb'),
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

  if (raw.team1flag) team1.flagUrl = raw.team1flag;
  if (raw.team2flag) team2.flagUrl = raw.team2flag;
  if (raw.t1Sname) team1.shortName = raw.t1Sname;
  if (raw.t2Sname) team2.shortName = raw.t2Sname;

  const venueName = raw.vname || resolveVenue(raw.v);
  const seriesName = raw.sfullname || raw.sname || resolveSeries(raw.q);
  const format = (raw.fo || raw.t || 'Match').toString().trim();
  const matchTitlePrefix = raw.matchNums ? `${raw.matchNums} ${format}` : format;

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

  const resText = (raw.res || raw.soResult || '').toLowerCase();
  const isTerminalResult =
    resText.includes('won by') ||
    resText.includes('won') ||
    resText.includes('drawn') ||
    resText.includes('tied') ||
    resText.includes('no result') ||
    resText.includes('abandoned');

  const isInMatchBreak =
    resText.includes('innings break') ||
    resText.includes('lunch break') ||
    resText.includes('tea break') ||
    resText.includes('dinner break') ||
    resText.includes('stumps') ||
    resText.includes('delay') ||
    resText.includes('break');

  const hasLiveScore = !!(raw.j || raw.k);

  // Match is completed ONLY if finishTime exists or has a terminal win/draw result
  if (raw.finishTime || (isTerminalResult && !isInMatchBreak)) {
    status = 'completed';
    statusLabel = raw.res || raw.soResult || (raw.d === 6 ? 'Match Drawn' : 'Match Ended');
  } else if (hasLiveScore) {
    status = 'live';
    statusLabel = raw.a && !raw.a.startsWith('&') ? raw.a : (raw.soResult || raw.res || 'Live');
  } else {
    status = 'upcoming';
    statusLabel = 'Upcoming';
  }

  // Active Batting Team detection
  let battingTeamKey: string | undefined;
  if (status === 'live') {
    if (raw.k && team2Score) {
      battingTeamKey = raw.c;
    } else if (raw.j && team1Score) {
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

  let startTime = new Date();
  if (typeof raw.ti === 'number') {
    startTime = new Date(raw.ti);
  } else if (typeof raw.tiMs === 'number') {
    startTime = new Date(raw.tiMs);
  }

  const displayResultText =
    raw.a && !raw.a.startsWith('&')
      ? raw.a
      : raw.soResult && !raw.soResult.startsWith('&')
      ? raw.soResult
      : raw.res;

  return {
    id,
    team1,
    team2,
    seriesName,
    seriesKey: raw.q,
    venueName,
    venueKey: raw.v,
    format,
    matchTitlePrefix,
    status,
    statusLabel,
    statusDetail: typeof raw.s === 'string' ? raw.s : undefined,
    resultText: displayResultText,
    sessionText: typeof raw.s === 'string' ? raw.s : undefined,
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

export function parseMatchesMap(rawData: RawApiResponse): ParsedCricketMatch[] {
  const matches: ParsedCricketMatch[] = [];
  for (const [id, rawMatch] of Object.entries(rawData)) {
    if (rawMatch && typeof rawMatch === 'object' && rawMatch.b && rawMatch.c) {
      matches.push(transformCrexMatch(id, rawMatch));
    }
  }

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

  return matches;
}

// In-memory registry of all matches seen so far
let combinedMatchesPool: Record<string, RawCrexMatch> = {};
let hasInitialMappingLoaded = false;
let lastBackgroundSyncTime = 0;

/**
 * Fetch background mapping (teams, venues, series names) without blocking live updates
 */
async function syncBackgroundMapping(countryCode: string) {
  try {
    const res = await fetch(LOCAL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cc: countryCode }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.matches) {
        for (const [id, m] of Object.entries(data.matches)) {
          // Only populate if not already present or merge without overwriting newer live scores
          if (!combinedMatchesPool[id]) {
            combinedMatchesPool[id] = m as any;
          } else {
            combinedMatchesPool[id] = {
              ...(m as any),
              ...combinedMatchesPool[id], // Keep the fresh live scores
            };
          }
        }
      }
      if (data?.mapping) {
        registerDynamicMapping(data.mapping);
      }
      hasInitialMappingLoaded = true;
      lastBackgroundSyncTime = Date.now();
    }
  } catch {
    // Non-blocking background sync
  }
}

/**
 * Ultra-fast direct live fetch (executes every single second in < 15ms):
 * 1. Directly queries https://api.goscorer.com/api/v2/getTopMatches?_t=... with cache-busting
 * 2. Immediately parses and returns fresh scores
 * 3. Falls back to local endpoint only if direct fetch fails
 */
export async function fetchCrexTopMatches(countryCode = 'IN'): Promise<FetchResult> {
  const startTime = performance.now();
  const now = Date.now();

  // Trigger non-blocking background mapping sync if needed (once at start or every 30s)
  if (!hasInitialMappingLoaded || now - lastBackgroundSyncTime > 30000) {
    syncBackgroundMapping(countryCode);
  }

  let freshUpdates: RawApiResponse | null = null;

  try {
    // Direct Goscorer API call with cache-busting query parameter and headers
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const directRes = await fetch(`${DIRECT_GOSCORER_ENDPOINT}?_t=${now}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      body: JSON.stringify({ cc: countryCode, _t: now }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (directRes.ok) {
      const data = await directRes.json();
      if (data && typeof data === 'object') {
        freshUpdates = data;
      }
    }
  } catch {
    // Direct call failed (e.g. offline/strict firewall), fall back to local endpoint
  }

  // If direct fetch didn't return data, try local endpoint
  if (!freshUpdates) {
    try {
      const localRes = await fetch(LOCAL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cc: countryCode }),
      });
      if (localRes.ok) {
        const localData = await localRes.json();
        if (localData?.matches) {
          freshUpdates = localData.matches;
          if (localData.mapping) registerDynamicMapping(localData.mapping);
        }
      }
    } catch {
      // Fallback failed
    }
  }

  if (freshUpdates) {
    // Merge new updates into combined pool
    for (const [id, m] of Object.entries(freshUpdates)) {
      combinedMatchesPool[id] = {
        ...(combinedMatchesPool[id] || {}),
        ...(m as any),
      };
    }
  }

  const finalSource = { ...combinedMatchesPool };
  const latencyMs = Math.round(performance.now() - startTime);
  const matches = parseMatchesMap(finalSource);

  return {
    matches,
    raw: finalSource,
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
