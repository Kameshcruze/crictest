import { useState, useEffect, useRef, useCallback } from 'react';
import { ParsedCricketMatch } from '../types/cricket';
import { MatchOddsState, ParsedMatchOdds, OddsTick, OddsMovement } from '../types/odds';
import {
  fetchMatchOdds,
  maskOddsKey,
  verifyMatchOddsConsistency,
} from '../services/oddsApi';
import { registerDynamicTeam } from '../data/cricketMapping';

export interface UseOddsManagerReturn {
  oddsByMatchId: Record<string, MatchOddsState>;
  getMatchOdds: (matchId: string) => MatchOddsState | undefined;
  refreshMatchOdds: (matchId: string) => Promise<void>;
  refreshAllOdds: () => Promise<void>;
  isGlobalRefreshing: boolean;
  totalRecordsReceived: number;
}

export function useOddsManager(
  matches: ParsedCricketMatch[],
  serverOddsByMatch?: Record<string, MatchOddsState>
): UseOddsManagerReturn {
  const [oddsByMatchId, setOddsByMatchId] = useState<Record<string, MatchOddsState>>({});
  const [isGlobalRefreshing, setIsGlobalRefreshing] = useState(false);

  // Per-match monotonic sequence tracking to guarantee async responses cannot overwrite newer requests
  const requestSeqRef = useRef<Record<string, number>>({});

  // Reference to current matches array for cross-consistency checks in async callbacks
  const matchesRef = useRef<ParsedCricketMatch[]>(matches);
  matchesRef.current = matches;

  const matchesMapRef = useRef<Record<string, ParsedCricketMatch>>({});
  const map: Record<string, ParsedCricketMatch> = {};
  matches.forEach((m) => {
    map[m.id] = m;
  });
  matchesMapRef.current = map;

  // Track initial fetch so matches are fetched immediately once discovered
  const initialFetchedRef = useRef<Set<string>>(new Set());

  // Total counter of all odds updates processed across the session
  const totalRecordsRef = useRef(0);
  const [totalRecordsReceived, setTotalRecordsReceived] = useState(0);

  /**
   * Fetch odds for a single match with strict isolation and monotonic sequence guard
   */
  const fetchOddsForMatch = useCallback(async (matchId: string, force = false) => {
    const cleanId = String(matchId || '').trim();
    if (!cleanId) return;

    const match = matchesMapRef.current[cleanId] || matchesRef.current.find((m) => m.id === cleanId);

    // Increment and capture sequence number for this match
    const seq = (requestSeqRef.current[cleanId] || 0) + 1;
    requestSeqRef.current[cleanId] = seq;

    // Set loading state for this specific match (never touching other matches)
    setOddsByMatchId((prev) => {
      const existing = prev[cleanId];
      return {
        ...prev,
        [cleanId]: {
          matchId: cleanId,
          oddsKey: cleanId,
          maskedKey: maskOddsKey(cleanId),
          status: existing?.odds ? existing.status : 'loading',
          odds: existing?.odds || null,
          error: undefined,
          recordsCount: existing?.recordsCount || 0,
          lastUpdated: existing?.lastUpdated,
          consistency: existing?.consistency || {
            isConsistent: true,
            status: 'unverified',
            reason: 'Pending verification',
          },
        },
      };
    });

    try {
      const odds: ParsedMatchOdds = await fetchMatchOdds(cleanId, { forceRefresh: force });

      // Guard: Discard if a newer request for this match was already dispatched
      if (requestSeqRef.current[cleanId] !== seq) {
        return;
      }

      // Dynamically register team names from odds speechNames if provided
      if (odds.speechNames && typeof odds.speechNames === 'object') {
        for (const [tKey, tName] of Object.entries(odds.speechNames)) {
          if (tKey && typeof tName === 'string' && tName.trim().length > 0) {
            registerDynamicTeam(tKey, tName.trim());
          }
        }
      }

      // Verify consistency against the match record if available
      const consistency = match
        ? verifyMatchOddsConsistency(match, odds)
        : { isConsistent: true, status: 'unverified' as const, reason: 'Standalone verification' };

      totalRecordsRef.current += 1;
      setTotalRecordsReceived(totalRecordsRef.current);

      setOddsByMatchId((prev) => {
        const existing = prev[cleanId];
        const existingOdds = existing?.odds || null;

        // Calculate rate movement between previous tick and new tick
        let movement: OddsMovement = existing?.movement || {
          direction: 'stable',
          deltaBack: 0,
          deltaLay: 0,
        };

        if (existingOdds && existingOdds.bookmaker.backRate !== null && odds.bookmaker.backRate !== null) {
          const deltaBack = odds.bookmaker.backRate - existingOdds.bookmaker.backRate;
          const deltaLay =
            (odds.bookmaker.layRate ?? odds.bookmaker.backRate) -
            (existingOdds.bookmaker.layRate ?? existingOdds.bookmaker.backRate);

          let direction: 'up' | 'down' | 'stable' = 'stable';
          if (deltaBack > 0) direction = 'up';
          else if (deltaBack < 0) direction = 'down';

          if (direction !== 'stable' || deltaBack !== 0 || deltaLay !== 0) {
            movement = {
              direction,
              deltaBack,
              deltaLay,
              lastChangedAt: new Date(),
            };
          }
        }

        // Record tick history (up to last 30 ticks)
        const newTick: OddsTick = {
          timestamp: new Date(),
          rawRateString: odds.bookmaker.rawRateString,
          backRate: odds.bookmaker.backRate,
          layRate: odds.bookmaker.layRate,
          decimalBack: odds.bookmaker.decimalBack,
          decimalLay: odds.bookmaker.decimalLay,
          spread: odds.bookmaker.spread,
          isSuspended: odds.bookmaker.isSuspended,
        };

        const history = [newTick, ...(existing?.history || [])].slice(0, 30);

        return {
          ...prev,
          [cleanId]: {
            matchId: cleanId,
            oddsKey: cleanId,
            maskedKey: maskOddsKey(cleanId),
            status: odds.bookmaker.isSuspended ? 'unavailable' : 'success',
            odds,
            previousOdds: existingOdds,
            movement,
            history,
            error: undefined,
            recordsCount: (existing?.recordsCount || 0) + 1,
            lastUpdated: new Date(),
            consistency,
          },
        };
      });
    } catch (err: unknown) {
      // Guard: Discard stale failures
      if (requestSeqRef.current[cleanId] !== seq) return;

      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch match odds';

      setOddsByMatchId((prev) => {
        const existing = prev[cleanId];
        // If we already have valid odds, retain them seamlessly and don't wipe to error status
        if (existing?.odds) {
          return {
            ...prev,
            [cleanId]: {
              ...existing,
              error: errorMessage,
            },
          };
        }

        return {
          ...prev,
          [cleanId]: {
            matchId: cleanId,
            oddsKey: cleanId,
            maskedKey: maskOddsKey(cleanId),
            status: 'error',
            odds: null,
            error: errorMessage,
            recordsCount: existing?.recordsCount || 0,
            lastUpdated: existing?.lastUpdated,
            consistency: {
              isConsistent: false,
              status: 'mismatch',
              reason: errorMessage,
            },
          },
        };
      });
    }
  }, []);

  /**
   * Refresh odds for all active matches
   */
  const refreshAllOdds = useCallback(async () => {
    setIsGlobalRefreshing(true);
    const activeMatches = Object.values(matchesMapRef.current);
    try {
      await Promise.all(activeMatches.map((m) => fetchOddsForMatch(m.id, true)));
    } finally {
      setIsGlobalRefreshing(false);
    }
  }, [fetchOddsForMatch]);

  // Merge authoritative server-pushed SSE odds snapshots (keeps client read-only)
  const lastServerTimestampRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!serverOddsByMatch || Object.keys(serverOddsByMatch).length === 0) return;

    setOddsByMatchId((prev) => {
      const next = { ...prev };
      let anyChanged = false;

      for (const [mId, incoming] of Object.entries(serverOddsByMatch)) {
        if (!incoming?.odds) continue;
        const incomingTime = incoming.lastUpdated ? new Date(incoming.lastUpdated).getTime() : Date.now();
        if (lastServerTimestampRef.current[mId] === incomingTime && prev[mId]?.odds) {
          continue;
        }
        lastServerTimestampRef.current[mId] = incomingTime;
        anyChanged = true;

        const existing = prev[mId];
        const newTick: OddsTick = {
          timestamp: new Date(incomingTime),
          rawRateString: incoming.odds.bookmaker.rawRateString,
          backRate: incoming.odds.bookmaker.backRate,
          layRate: incoming.odds.bookmaker.layRate,
          decimalBack: incoming.odds.bookmaker.decimalBack,
          decimalLay: incoming.odds.bookmaker.decimalLay,
          spread: incoming.odds.bookmaker.spread,
          isSuspended: incoming.odds.bookmaker.isSuspended,
        };
        const prevTick = existing?.history?.[0];
        const shouldAppendTick =
          !prevTick ||
          prevTick.rawRateString !== newTick.rawRateString ||
          newTick.timestamp.getTime() - new Date(prevTick.timestamp).getTime() >= 900;

        const history = shouldAppendTick
          ? [newTick, ...(existing?.history || [])].slice(0, 30)
          : existing?.history || [newTick];

        next[mId] = {
          ...incoming,
          lastUpdated: new Date(incomingTime),
          previousOdds: incoming.previousOdds || existing?.odds || null,
          history,
        };
      }

      return anyChanged ? next : prev;
    });
    totalRecordsRef.current += 1;
    setTotalRecordsReceived(totalRecordsRef.current);
  }, [serverOddsByMatch]);

  useEffect(() => {
    if (matches.length === 0) return;

    // Trigger initial fetch only for matches that don't already have server SSE odds
    matches.forEach((m) => {
      if (!initialFetchedRef.current.has(m.id)) {
        initialFetchedRef.current.add(m.id);
        if (!serverOddsByMatch?.[m.id]?.odds) {
          fetchOddsForMatch(m.id);
        }
      }
    });
  }, [matches, fetchOddsForMatch, serverOddsByMatch]);

  useEffect(() => {
    const liveTimer = setInterval(() => {
      matchesRef.current
        .filter((m) => m.status === 'live')
        .forEach((m) => {
          // Only poll from browser if SSE hasn't delivered a fresh update within 5s
          const lastSse = lastServerTimestampRef.current[m.id] || 0;
          if (Date.now() - lastSse > 5000) {
            fetchOddsForMatch(m.id);
          }
        });
    }, 3000);

    const nonLiveTimer = setInterval(() => {
      matchesRef.current
        .filter((m) => m.status !== 'live')
        .forEach((m) => {
          const lastSse = lastServerTimestampRef.current[m.id] || 0;
          if (Date.now() - lastSse > 20000) {
            fetchOddsForMatch(m.id);
          }
        });
    }, 20000);

    return () => {
      clearInterval(liveTimer);
      clearInterval(nonLiveTimer);
    };
  }, [fetchOddsForMatch]);

  const getMatchOdds = useCallback(
    (matchId: string) => {
      return oddsByMatchId[matchId];
    },
    [oddsByMatchId]
  );

  return {
    oddsByMatchId,
    getMatchOdds,
    refreshMatchOdds: (matchId: string) => fetchOddsForMatch(matchId, true),
    refreshAllOdds,
    isGlobalRefreshing,
    totalRecordsReceived,
  };
}
