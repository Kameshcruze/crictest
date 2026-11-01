/**
 * Odds API Service
 * Handles fetching, deduplication, caching, and parsing for the Goscorer getSV3 odds endpoint.
 *
 * Endpoint: https://api.goscorer.com/api/v3/getSV3?key={MATCH_SPECIFIC_KEY}
 */

import {
  RawGetSV3Response,
  ParsedMatchOdds,
  BookmakerOdds,
  SessionMarket,
  OddsConsistencyResult,
} from '../types/odds';
import { ParsedCricketMatch } from '../types/cricket';

export const DIRECT_ODDS_ENDPOINT = 'https://api.goscorer.com/api/v3/getSV3';
export const LOCAL_ODDS_ENDPOINT = '/api/odds';

// In-flight request deduplication: prevents duplicate network requests for the same key
const inFlightRequests = new Map<string, Promise<ParsedMatchOdds>>();

// Short TTL memory cache (default 600ms) to prevent hammering during rapid polling
interface CacheEntry {
  data: ParsedMatchOdds;
  timestamp: number;
}
const oddsMemoryCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 600;

/**
 * Parses Indian bookmaker rate strings such as "86+1", "85+1", or suspended markets "0-0,0-0,0-0", "0+0".
 *
 * In standard Indian bookmaker notation:
 * - "86+1": Back is 86, Lay is 86 + 1 = 87.
 * - In decimal odds: Back = 1 + (86 / 100) = 1.86, Lay = 1 + (87 / 100) = 1.87.
 */
export function parseBookmakerRate(rateStr?: string): BookmakerOdds {
  if (!rateStr || typeof rateStr !== 'string') {
    return {
      rawRateString: '',
      backRate: null,
      layRate: null,
      decimalBack: null,
      decimalLay: null,
      spread: null,
      isSuspended: true,
    };
  }

  const clean = rateStr.trim();

  // If rate contains 0-0 or 0+0, market is suspended / closed
  if (clean === '0+0' || clean.startsWith('0-0') || clean === '0') {
    return {
      rawRateString: clean,
      backRate: null,
      layRate: null,
      decimalBack: null,
      decimalLay: null,
      spread: null,
      isSuspended: true,
    };
  }

  // Typical format: "86+1" or "85+2"
  const plusMatch = clean.match(/^(\d+(?:\.\d+)?)\+(\d+(?:\.\d+)?)/);
  if (plusMatch) {
    const base = parseFloat(plusMatch[1]);
    const diff = parseFloat(plusMatch[2]);
    const backRate = base;
    const layRate = base + diff;
    const decimalBack = Number((1 + backRate / 100).toFixed(2));
    const decimalLay = Number((1 + layRate / 100).toFixed(2));

    return {
      rawRateString: clean,
      backRate,
      layRate,
      decimalBack,
      decimalLay,
      spread: diff,
      isSuspended: false,
    };
  }

  // Format with dash: "86-87"
  const dashMatch = clean.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
  if (dashMatch) {
    const backRate = parseFloat(dashMatch[1]);
    const layRate = parseFloat(dashMatch[2]);
    if (backRate === 0 && layRate === 0) {
      return {
        rawRateString: clean,
        backRate: null,
        layRate: null,
        decimalBack: null,
        decimalLay: null,
        spread: null,
        isSuspended: true,
      };
    }
    const spread = layRate - backRate;
    const decimalBack = Number((1 + backRate / 100).toFixed(2));
    const decimalLay = Number((1 + layRate / 100).toFixed(2));

    return {
      rawRateString: clean,
      backRate,
      layRate,
      decimalBack,
      decimalLay,
      spread,
      isSuspended: false,
    };
  }

  // Single number rate
  const singleNum = parseFloat(clean);
  if (!isNaN(singleNum) && singleNum > 0) {
    const decimalBack = Number((1 + singleNum / 100).toFixed(2));
    return {
      rawRateString: clean,
      backRate: singleNum,
      layRate: singleNum + 1,
      decimalBack,
      decimalLay: Number((1 + (singleNum + 1) / 100).toFixed(2)),
      spread: 1,
      isSuspended: false,
    };
  }

  return {
    rawRateString: clean,
    backRate: null,
    layRate: null,
    decimalBack: null,
    decimalLay: null,
    spread: null,
    isSuspended: true,
  };
}

/**
 * Parses session fancy markets from `Z` and `D` fields.
 * E.g., D="6,20", Z="64+2,208+3" =>
 *  - 6 Overs: Low 64, High 66 (spread 2)
 *  - 20 Overs: Low 208, High 211 (spread 3)
 */
export function parseSessionMarkets(zStr?: string, dStr?: string): SessionMarket[] {
  if (!zStr || typeof zStr !== 'string') return [];

  const sessions: SessionMarket[] = [];
  const overMarkers = dStr ? dStr.split(',').map((o) => parseInt(o.trim(), 10)).filter((n) => !isNaN(n)) : [];
  const sessionEntries = zStr.split(',').map((s) => s.trim()).filter(Boolean);

  sessionEntries.forEach((entry, idx) => {
    const match = entry.match(/^(\d+(?:\.\d+)?)\+(\d+(?:\.\d+)?)/);
    if (match) {
      const low = parseFloat(match[1]);
      const spread = parseFloat(match[2]);
      const high = low + spread;
      const overs = overMarkers[idx] || (idx === 0 ? 6 : idx === 1 ? 20 : (idx + 1) * 10);

      sessions.push({
        overs,
        low,
        high,
        spread,
        rawString: entry,
      });
    }
  });

  return sessions;
}

/**
 * Transforms raw getSV3 API payload into a structured ParsedMatchOdds object
 */
export function transformGetSV3Response(
  matchKey: string,
  raw: RawGetSV3Response,
  latencyMs: number
): ParsedMatchOdds {
  const speechNames = raw.speech_names || {};
  let favoriteTeamKey: string | undefined;
  let favoriteTeamName: string | undefined;

  if (typeof raw.F === 'string' && raw.F.length > 0) {
    favoriteTeamKey = raw.F.replace(/^\^/, '');
    if (speechNames[favoriteTeamKey]) {
      favoriteTeamName = speechNames[favoriteTeamKey];
    }
  }

  const bookmaker = parseBookmakerRate(raw.R);
  const sessions = parseSessionMarkets(raw.Z, raw.D);

  return {
    matchKey,
    dtId: raw.dt_id,
    format: raw.fo,
    statusText: raw.B || raw.b,
    favoriteTeamKey,
    favoriteTeamName,
    speechNames,
    bookmaker,
    sessions,
    raw,
    latencyMs,
    timestamp: new Date(),
  };
}

export interface FetchOddsOptions {
  /** Skip the short memory cache */
  forceRefresh?: boolean;
  /** Request abort signal */
  signal?: AbortSignal;
  /** Custom timeout in ms (default 4000ms) */
  timeoutMs?: number;
}

/**
 * Main odds retrieval function.
 *
 * 1. Checks memory cache (if not forceRefresh).
 * 2. Checks in-flight request map to prevent duplicate parallel fetches.
 * 3. Attempts direct fetch to https://api.goscorer.com/api/v3/getSV3?key=...
 * 4. Falls back to backend proxy /api/odds?key=... if direct call fails.
 * 5. Validates response HTTP status, parses and returns structured ParsedMatchOdds.
 */
export async function fetchMatchOdds(
  matchKey: string,
  options: FetchOddsOptions = {}
): Promise<ParsedMatchOdds> {
  const cleanKey = String(matchKey || '').trim();

  if (!cleanKey) {
    throw new Error('fetchMatchOdds: matchKey parameter is required');
  }

  const now = Date.now();

  // 1. Check in-memory cache
  if (!options.forceRefresh) {
    const cached = oddsMemoryCache.get(cleanKey);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  // 2. Check in-flight requests (request deduplication)
  const existingInFlight = inFlightRequests.get(cleanKey);
  if (existingInFlight && !options.forceRefresh) {
    return existingInFlight;
  }

  const fetchPromise = (async () => {
    const startTime = performance.now();
    const timeoutMs = options.timeoutMs || 4000;

    let response: Response | null = null;
    let rawText = '';

    // Step A: Attempt direct API call with simple GET (no custom headers to prevent browser OPTIONS preflight)
    const directUrl = `${DIRECT_ODDS_ENDPOINT}?key=${encodeURIComponent(cleanKey)}&_t=${now}`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      response = await fetch(directUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
    } catch {
      response = null;
    }

    // Step B: Fall back to local backend proxy route (/api/odds)
    if (!response || !response.ok) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        if (options.signal) {
          options.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }

        response = await fetch(`${LOCAL_ODDS_ENDPOINT}?key=${encodeURIComponent(cleanKey)}&_t=${now}`, {
          method: 'GET',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
      } catch {
        response = null;
      }
    }

    // Step C: Fall back to public CORS proxy if running on static hosting (e.g. GitHub Pages without backend)
    if (!response || !response.ok) {
      const fallbackProxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(`${DIRECT_ODDS_ENDPOINT}?key=${encodeURIComponent(cleanKey)}`)}`,
        `https://corsproxy.io/?url=${encodeURIComponent(`${DIRECT_ODDS_ENDPOINT}?key=${encodeURIComponent(cleanKey)}`)}`,
      ];

      for (const proxyUrl of fallbackProxies) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

          if (options.signal) {
            options.signal.addEventListener('abort', () => controller.abort(), { once: true });
          }

          const proxyRes = await fetch(proxyUrl, { method: 'GET', signal: controller.signal });
          clearTimeout(timeoutId);
          if (proxyRes.ok) {
            response = proxyRes;
            break;
          }
        } catch {
          // Continue to next proxy
        }
      }
    }

    // Step D: Validate HTTP response
    if (!response || !response.ok) {
      throw new Error(
        `Odds API could not retrieve odds for key "${cleanKey}" (${response?.status ? `HTTP ${response.status}` : 'All endpoints unreachable'})`
      );
    }

    // Step D: Parse response text and JSON safely
    try {
      rawText = await response.text();
    } catch (readErr: any) {
      throw new Error(`Failed to read odds response for key "${cleanKey}": ${readErr?.message}`);
    }

    let parsedJson: RawGetSV3Response;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      throw new Error(
        `Odds API returned malformed JSON for key "${cleanKey}": ${rawText.slice(0, 100)}`
      );
    }

    if (!parsedJson || typeof parsedJson !== 'object') {
      throw new Error(`Invalid response structure received for key "${cleanKey}"`);
    }

    const latencyMs = Math.round(performance.now() - startTime);
    const parsedOdds = transformGetSV3Response(cleanKey, parsedJson, latencyMs);

    // Save to memory cache
    oddsMemoryCache.set(cleanKey, {
      data: parsedOdds,
      timestamp: Date.now(),
    });

    return parsedOdds;
  })();

  // Track in-flight request
  inFlightRequests.set(cleanKey, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    inFlightRequests.delete(cleanKey);
  }
}

/**
 * Clear the odds cache for a specific match key or all keys
 */
export function clearOddsCache(matchKey?: string): void {
  if (matchKey) {
    oddsMemoryCache.delete(matchKey);
  } else {
    oddsMemoryCache.clear();
  }
}

/**
 * Masks an odds key for diagnostic / privacy display (e.g. "12JG" -> "12**")
 */
export function maskOddsKey(key?: string): string {
  if (!key) return '****';
  const clean = key.trim();
  if (clean.length <= 2) return clean[0] + '*';
  const visibleCount = Math.min(2, Math.floor(clean.length / 2));
  return clean.slice(0, visibleCount) + '*'.repeat(clean.length - visibleCount);
}

/**
 * Cross-validates an incoming odds payload against the cricket match model.
 * Verifies that:
 * 1. Discrete tournament/match identifier (dt_id) matches between cricket data and odds data.
 * 2. Team names/keys in speech_names match the teams in the cricket match.
 */
export function verifyMatchOddsConsistency(
  match: ParsedCricketMatch,
  odds: ParsedMatchOdds
): OddsConsistencyResult {
  // 1. Verify Discrete Match ID (dt_id) if both provide it
  const matchDtId = match.raw?.dt_id ? String(match.raw.dt_id).trim() : undefined;
  const oddsDtId = odds.dtId ? String(odds.dtId).trim() : undefined;

  let dtIdMatched: boolean | undefined = undefined;
  if (matchDtId && oddsDtId) {
    dtIdMatched = matchDtId === oddsDtId;
    if (!dtIdMatched) {
      return {
        isConsistent: false,
        status: 'mismatch',
        dtIdMatched: false,
        teamsMatched: false,
        reason: `CRITICAL MISMATCH: Match has dt_id "${matchDtId}" but odds has dt_id "${oddsDtId}".`,
      };
    }
  }

  // 2. Verify Team Names / Short Names
  const speechNames = Object.values(odds.speechNames || {}).map((n) =>
    String(n).toLowerCase().trim()
  );
  const speechKeys = Object.keys(odds.speechNames || {}).map((k) => k.toLowerCase().trim());

  let teamsMatched: boolean | undefined = undefined;
  const t1Name = match.team1.name.toLowerCase();
  const t1Short = match.team1.shortName.toLowerCase();
  const t2Name = match.team2.name.toLowerCase();
  const t2Short = match.team2.shortName.toLowerCase();

  if (speechNames.length > 0) {
    const hasOverlap = speechNames.some(
      (sn) =>
        t1Name.includes(sn) ||
        sn.includes(t1Name) ||
        t2Name.includes(sn) ||
        sn.includes(t2Name) ||
        t1Short === sn ||
        t2Short === sn
    );

    const hasKeyOverlap = speechKeys.some(
      (sk) =>
        sk === (match.raw?.b || '').toLowerCase() || sk === (match.raw?.c || '').toLowerCase()
    );

    teamsMatched = hasOverlap || hasKeyOverlap;

    if (!teamsMatched && dtIdMatched === undefined) {
      return {
        isConsistent: false,
        status: 'mismatch',
        dtIdMatched: false,
        teamsMatched: false,
        reason: `Team mismatch: Expected [${match.team1.shortName}, ${match.team2.shortName}], Odds has [${speechNames.join(', ')}].`,
      };
    }
  }

  if (dtIdMatched === true || teamsMatched === true) {
    const matchedParts: string[] = [];
    if (dtIdMatched) matchedParts.push(`dt_id: ${matchDtId}`);
    if (teamsMatched && speechNames.length > 0)
      matchedParts.push(`Teams: ${speechNames.join(' & ')}`);
    return {
      isConsistent: true,
      status: 'verified',
      dtIdMatched,
      teamsMatched,
      reason: `Verified (${matchedParts.join(', ')})`,
    };
  }

  return {
    isConsistent: true,
    status: 'unverified',
    dtIdMatched,
    teamsMatched,
    reason: 'Unverified (odds payload lacks dt_id and team names for full cross-check)',
  };
}
