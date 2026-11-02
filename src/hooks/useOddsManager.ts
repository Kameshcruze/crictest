import { useState, useEffect, useRef, useCallback } from 'react';
import { ParsedCricketMatch } from '../types/cricket';
import { MatchOddsState, ParsedMatchOdds, OddsTick, OddsMovement } from '../types/odds';
import {
  fetchMatchOdds,
  maskOddsKey,
  verifyMatchOddsConsistency,
} from '../services/oddsApi';
import { registerDynamicTeam } from '../data/cricketMapping';
import { syncOddsToSupabase } from '../services/supabaseSyncService';

export interface UseOddsManagerReturn {
  oddsByMatchId: Record<string, MatchOddsState>;
  getMatchOdds: (matchId: string) => MatchOddsState | undefined;
  refreshMatchOdds: (matchId: string) => Promise<void>;
  refreshAllOdds: () => Promise<void>;
  isGlobalRefreshing: boolean;
  totalRecordsReceived: number;
}

export function useOddsManager(matches: ParsedCricketMatch[]): UseOddsManagerReturn {
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

      let computedMovement: OddsMovement = {
        direction: 'stable',
        deltaBack: 0,
        deltaLay: 0,
      };

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

        computedMovement = movement;

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

      // Asynchronously persist current odds and price movement to Supabase
      syncOddsToSupabase(cleanId, {
        matchId: cleanId,
        oddsKey: cleanId,
        maskedKey: maskOddsKey(cleanId),
        status: odds.bookmaker.isSuspended ? 'unavailable' : 'success',
        odds,
        movement: computedMovement,
        recordsCount: totalRecordsRef.current,
        lastUpdated: new Date(),
        consistency,
      }).catch(() => {});
    } catch (err: unknown) {
      // Guard: Discard stale failures
      if (requestSeqRef.current[cleanId] !== seq) return;

      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch match odds';

      setOddsByMatchId((prev) => {
        const existing = prev[cleanId];
        return {
          ...prev,
          [cleanId]: {
            matchId: cleanId,
            oddsKey: cleanId,
            maskedKey: maskOddsKey(cleanId),
            status: 'error',
            odds: existing?.odds || null,
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

  /**
   * Automatic background polling loop for odds
   * - Trigger initial fetch once when a match is discovered
   * - Live matches: polled steadily every 3 seconds
   * - Upcoming/Completed matches: polled every 20 seconds
   */
  useEffect(() => {
    if (matches.length === 0) return;

    // Trigger initial fetch for any new match not yet fetched
    matches.forEach((m) => {
      if (!initialFetchedRef.current.has(m.id)) {
        initialFetchedRef.current.add(m.id);
        fetchOddsForMatch(m.id);
      }
    });
  }, [matches, fetchOddsForMatch]);

  useEffect(() => {
    const liveTimer = setInterval(() => {
      matchesRef.current
        .filter((m) => m.status === 'live')
        .forEach((m) => {
          fetchOddsForMatch(m.id);
        });
    }, 3000);

    const nonLiveTimer = setInterval(() => {
      matchesRef.current
        .filter((m) => m.status !== 'live')
        .forEach((m) => {
          fetchOddsForMatch(m.id);
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
