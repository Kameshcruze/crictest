import { ParsedCricketMatch } from '../../types/cricket';
import { MatchOddsState } from '../../types/odds';
import { CricketStrategyEngine } from './engine';
import {
  MatchStrategyState,
  PositionType,
  SerializedMatchStrategyState,
  StrategySignal,
  StrategyStage,
  StrategyTradeRecord,
  TradePosition,
} from './types';

export interface StrategyStorageAdapter {
  loadAllSnapshots(): Promise<SerializedMatchStrategyState[]>;
  loadAllTrades(): Promise<StrategyTradeRecord[]>;
  loadAllPositions(): Promise<TradePosition[]>;
  loadRecentSignals(limit?: number): Promise<StrategySignal[]>;
  upsertTrade(
    trade: StrategyTradeRecord,
    context?: { match?: ParsedCricketMatch }
  ): Promise<void>;
  upsertPosition(
    position: TradePosition,
    context?: { match?: ParsedCricketMatch }
  ): Promise<void>;
  insertSignal(
    signal: StrategySignal,
    dedupeHash: string,
    context?: { match?: ParsedCricketMatch }
  ): Promise<void>;
  upsertSnapshot(snapshot: SerializedMatchStrategyState): Promise<void>;
  deleteMatchStrategy?(matchId: string): Promise<void>;
}

export interface StrategyAlertEvent {
  kind: 'ENTRY' | 'EXIT';
  trade: StrategyTradeRecord;
  match?: ParsedCricketMatch;
}

export interface CoordinatorOptions {
  engine?: CricketStrategyEngine;
  storage: StrategyStorageAdapter;
  strategyAlertsEnabled?: boolean;
  onStrategyAlert?: (event: StrategyAlertEvent) => Promise<void> | void;
}

function stableShortHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildSignalDedupeHash(signal: StrategySignal): string {
  const raw = [
    signal.matchId,
    signal.signalType,
    signal.status,
    signal.currentInnings,
    signal.currentOver,
    signal.ballNumber || 0,
    signal.relevantOdds?.decimalOdds ?? 'null',
    signal.relevantOdds?.opposingTeamOdds ?? 'null',
    signal.relevantOdds?.oddsDelta ?? 'null',
    signal.relevantOdds?.currentPaise ?? 'null',
  ].join(':');

  if (raw.length <= 160) {
    return raw;
  }
  const digest = stableShortHash(raw);
  return `${signal.matchId.slice(0, 24)}:${signal.signalType.slice(0, 32)}:${digest}`;
}

function tradeSignature(trade: StrategyTradeRecord): string {
  return `${trade.status}|${trade.entryDecimal}|${trade.entryOver}|${trade.exitDecimal ?? ''}|${trade.exitOver ?? ''}|${trade.exitReason ?? ''}`;
}

function positionSignature(pos: TradePosition): string {
  return `${pos.status}|${pos.entryOdds ?? ''}|${pos.entryOver ?? ''}|${pos.exitOdds ?? ''}|${pos.exitOver ?? ''}`;
}

function snapshotSignature(s: SerializedMatchStrategyState): string {
  return [
    s.stage,
    s.bookingTeamName ?? '',
    s.bookingTeamKey ?? '',
    s.pending85 ? '1' : '0',
    s.firstEntryPosition.status,
    s.secondEntryPosition.status,
    s.lastEvaluatedOver,
    s.lastEvaluatedWickets,
    s.lastEvaluatedRuns,
    s.lastEvaluatedBalls,
    s.lastEvaluatedPaise ?? '',
    s.lastEvaluatedControl,
    s.abnormalActivityCount,
  ].join('|');
}

export class StrategyPersistenceCoordinator {
  public readonly engine: CricketStrategyEngine;
  private readonly storage: StrategyStorageAdapter;
  private strategyAlertsEnabled: boolean;
  private readonly onStrategyAlert?: (event: StrategyAlertEvent) => Promise<void> | void;

  private isRehydrating = false;
  private hasRehydratedOnce = false;
  private isFlushing = false;

  // Deduplication caches
  private persistedSignalHashes = new Set<string>();
  private persistedTradeSigs = new Map<string, string>();
  private persistedPositionSigs = new Map<string, string>();
  private persistedSnapshotSigs = new Map<string, string>();
  private alertedTradeKeys = new Set<string>();

  // Match context map for rich trade records during synchronous listener callbacks
  private activeMatchContext = new Map<string, ParsedCricketMatch>();

  // Offline-resilient retry outbox (in-memory queue flushed when DB reconnects)
  private pendingTrades = new Map<string, { trade: StrategyTradeRecord; match?: ParsedCricketMatch }>();
  private pendingPositions = new Map<string, { position: TradePosition; match?: ParsedCricketMatch }>();
  private pendingSignals = new Map<
    string,
    { signal: StrategySignal; dedupeHash: string; match?: ParsedCricketMatch }
  >();
  private pendingStates = new Map<string, SerializedMatchStrategyState>();

  private emittedTradesBuffer: StrategyTradeRecord[] = [];

  constructor(options: CoordinatorOptions) {
    this.engine = options.engine || new CricketStrategyEngine();
    this.storage = options.storage;
    this.strategyAlertsEnabled = options.strategyAlertsEnabled === true;
    this.onStrategyAlert = options.onStrategyAlert;

    this.engine.onTrade((trade) => {
      if (this.isRehydrating) return;
      this.emittedTradesBuffer.push({ ...trade });
    });
  }

  public setStrategyAlertsEnabled(enabled: boolean): void {
    this.strategyAlertsEnabled = enabled === true;
  }

  public isStrategyAlertsEnabled(): boolean {
    return this.strategyAlertsEnabled;
  }

  public getHasRehydrated(): boolean {
    return this.hasRehydratedOnce;
  }

  public getPendingCounts() {
    return {
      trades: this.pendingTrades.size,
      positions: this.pendingPositions.size,
      signals: this.pendingSignals.size,
      states: this.pendingStates.size,
      total:
        this.pendingTrades.size +
        this.pendingPositions.size +
        this.pendingSignals.size +
        this.pendingStates.size,
    };
  }

  /**
   * Restores all strategy state, open/completed trades, positions, and signal history
   * from the database without firing any new alerts or duplicate writes.
   */
  public async rehydrateFromDatabase(options?: {
    preserveActiveMemory?: boolean;
  }): Promise<{
    matchesRestored: number;
    tradesRestored: number;
    positionsRestored: number;
    signalsRestored: number;
  }> {
    this.isRehydrating = true;
    let tradesRestored = 0;
    let positionsRestored = 0;
    let signalsRestored = 0;

    try {
      const [snapshots, trades, positions, signals] = await Promise.all([
        this.storage.loadAllSnapshots(),
        this.storage.loadAllTrades(),
        this.storage.loadAllPositions(),
        this.storage.loadRecentSignals(2000),
      ]);

      const preserveActive = options?.preserveActiveMemory === true;
      const inMemoryProtectedMatches = new Set<string>();
      if (preserveActive) {
        for (const id of this.engine.getAllMatchIds()) {
          const st = this.engine.getState(id);
          if (
            st.firstEntryTrade ||
            st.secondEntryTrade ||
            st.stage !== 'WAITING_FOR_CONFIRMATION'
          ) {
            inMemoryProtectedMatches.add(id);
          }
        }
      }

      const restoredMatchIds = new Set<string>();

      // 1. Restore full engine state snapshots first
      for (const snap of snapshots) {
        if (!snap?.matchId) continue;
        restoredMatchIds.add(snap.matchId);
        if (inMemoryProtectedMatches.has(snap.matchId)) continue;

        this.engine.hydrateState(snap.matchId, snap);
        this.persistedSnapshotSigs.set(snap.matchId, snapshotSignature(snap));

        for (const sig of snap.signalsHistory || []) {
          this.persistedSignalHashes.add(buildSignalDedupeHash(sig));
        }
      }

      // 2. Overlay authoritative trades from strategy_trades table
      for (const trade of trades) {
        if (!trade?.matchId) continue;
        restoredMatchIds.add(trade.matchId);
        tradesRestored += 1;

        const tradeKey = `${trade.matchId}:${trade.entryType}`;
        this.persistedTradeSigs.set(tradeKey, tradeSignature(trade));
        this.alertedTradeKeys.add(`${trade.matchId}:${trade.entryType}:${trade.status}`);

        if (inMemoryProtectedMatches.has(trade.matchId)) continue;

        const state = this.engine.getState(trade.matchId);
        const partial: Partial<MatchStrategyState> = {};

        if (trade.bookingTeam) {
          partial.bookingTeamName = state.bookingTeamName || trade.bookingTeam;
        }

        if (trade.entryType === 'FIRST_ENTRY') {
          partial.firstEntryTrade = { ...trade };
          partial.pending85 = false;
          partial.firstEntryPosition = {
            ...state.firstEntryPosition,
            status: trade.status === 'BOOKSET_COMPLETED' ? 'RECORDED_EXIT' : 'RECORDED_ENTRY',
            entryOdds: trade.entryDecimal,
            entryOver: trade.entryOver,
            entryInnings: trade.innings,
            entryWickets: trade.entryWickets,
            entryTimestamp: trade.entryTime,
            exitOdds: trade.exitDecimal ?? state.firstEntryPosition.exitOdds,
            exitOver: trade.exitOver ?? state.firstEntryPosition.exitOver,
            exitTimestamp: trade.exitTime ?? state.firstEntryPosition.exitTimestamp,
          };
        } else if (trade.entryType === 'SECOND_ENTRY') {
          partial.secondEntryTrade = { ...trade };
          partial.secondEntryPosition = {
            ...state.secondEntryPosition,
            status: trade.status === 'BOOKSET_COMPLETED' ? 'RECORDED_EXIT' : 'RECORDED_ENTRY',
            entryOdds: trade.entryDecimal,
            entryOver: trade.entryOver,
            entryInnings: trade.innings,
            entryWickets: trade.entryWickets,
            entryTimestamp: trade.entryTime,
            exitOdds: trade.exitDecimal ?? state.secondEntryPosition.exitOdds,
            exitOver: trade.exitOver ?? state.secondEntryPosition.exitOver,
            exitTimestamp: trade.exitTime ?? state.secondEntryPosition.exitTimestamp,
          };
        }

        this.engine.hydrateState(trade.matchId, partial);
        this.reconcileStageFromTrades(this.engine.getState(trade.matchId));
      }

      // 3. Overlay trade_positions rows so any candidate or recorded fields match
      for (const pos of positions) {
        if (!pos?.matchId) continue;
        restoredMatchIds.add(pos.matchId);
        positionsRestored += 1;
        this.persistedPositionSigs.set(`${pos.matchId}:${pos.positionType}`, positionSignature(pos));

        if (inMemoryProtectedMatches.has(pos.matchId)) continue;

        const state = this.engine.getState(pos.matchId);
        if (pos.positionType === 'FIRST_ENTRY' && pos.status !== 'NONE') {
          this.engine.hydrateState(pos.matchId, {
            firstEntryPosition: {
              ...state.firstEntryPosition,
              ...pos,
            },
          });
        } else if (pos.positionType === 'SECOND_ENTRY' && pos.status !== 'NONE') {
          this.engine.hydrateState(pos.matchId, {
            secondEntryPosition: {
              ...state.secondEntryPosition,
              ...pos,
            },
          });
        }
        this.reconcileStageFromTrades(this.engine.getState(pos.matchId));
      }

      // 4. Restore signal history per match (sorted newest-first, deduplicated)
      const signalsByMatch = new Map<string, StrategySignal[]>();
      for (const sig of signals) {
        if (!sig?.matchId) continue;
        restoredMatchIds.add(sig.matchId);
        signalsRestored += 1;

        const hash = buildSignalDedupeHash(sig);
        this.persistedSignalHashes.add(hash);

        const list = signalsByMatch.get(sig.matchId) || [];
        list.push(sig);
        signalsByMatch.set(sig.matchId, list);
      }

      for (const [matchId, sigList] of signalsByMatch.entries()) {
        if (inMemoryProtectedMatches.has(matchId)) continue;
        const state = this.engine.getState(matchId);

        const merged = [...sigList, ...state.signalsHistory];
        const seenIds = new Set<string>();
        const unique: StrategySignal[] = [];
        for (const s of merged) {
          const k = buildSignalDedupeHash(s);
          if (!seenIds.has(k)) {
            seenIds.add(k);
            unique.push(s);
          }
        }
        unique.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        const processedKeys = new Set(state.processedEventKeys);
        for (const s of unique) {
          processedKeys.add(
            `${s.matchId}-${s.signalType}-${s.status}-${s.currentInnings}-${s.currentOver}-${s.ballNumber || 0}`
          );
        }

        this.engine.hydrateState(matchId, {
          signalsHistory: unique.slice(0, 200),
          processedEventKeys: processedKeys,
        });
      }

      this.hasRehydratedOnce = true;

      return {
        matchesRestored: restoredMatchIds.size,
        tradesRestored,
        positionsRestored,
        signalsRestored,
      };
    } finally {
      this.emittedTradesBuffer = [];
      this.isRehydrating = false;
    }
  }

  private reconcileStageFromTrades(state: MatchStrategyState): void {
    let stage: StrategyStage = state.stage;
    const t1 = state.firstEntryTrade;
    const t2 = state.secondEntryTrade;

    if (t2) {
      if (t2.status === 'BOOKSET_COMPLETED') {
        stage = 'FULL_BOOKSET_COMPLETED';
      } else if (t2.status === 'ACTIVE') {
        stage = 'ACTIVE_SECOND_ENTRY';
      }
    } else if (t1) {
      if (t1.status === 'BOOKSET_COMPLETED') {
        stage = 'FIRST_BOOKSET_COMPLETED';
      } else if (t1.status === 'ACTIVE') {
        stage = 'ACTIVE_FIRST_ENTRY';
      }
    }

    state.stage = stage;
  }

  /**
   * Evaluates one per-second snapshot from the timeline loop and persists all outputs
   * idempotently (with offline outbox fallback when DB is unreachable).
   */
  public async evaluateMatchSnapshot(
    match: ParsedCricketMatch,
    oddsState: MatchOddsState,
    options?: {
      isStale?: boolean;
      boundaryEvent?: { type: 'FOUR' | 'SIX'; oddsMovement: number };
      dbAvailable?: boolean;
    }
  ): Promise<{
    signals: StrategySignal[];
    state: SerializedMatchStrategyState;
    tradesEmitted: StrategyTradeRecord[];
  }> {
    this.activeMatchContext.set(match.id, match);
    this.emittedTradesBuffer = [];

    const signals = this.engine.evaluateMatch(
      match,
      oddsState,
      options?.boundaryEvent,
      { isStale: options?.isStale }
    );

    const emittedTrades = [...this.emittedTradesBuffer];
    this.emittedTradesBuffer = [];

    await this.persistEvaluationArtifacts(match.id, match, signals, emittedTrades, options?.dbAvailable);

    return {
      signals,
      state: this.engine.serializeState(match.id),
      tradesEmitted: emittedTrades,
    };
  }

  public async recordManualEntry(params: {
    matchId: string;
    positionType: PositionType;
    entryOdds: number;
    innings: number;
    over: number;
    wickets: number;
    bookingTeam: string;
    battingTeam: string;
    bowlingTeam: string;
    matchName?: string;
    seriesName?: string;
    match?: ParsedCricketMatch;
    dbAvailable?: boolean;
  }): Promise<SerializedMatchStrategyState> {
    if (params.match) {
      this.activeMatchContext.set(params.matchId, params.match);
    }
    this.emittedTradesBuffer = [];

    this.engine.recordEntry(
      params.matchId,
      params.positionType,
      params.entryOdds,
      params.innings,
      params.over,
      params.wickets,
      new Date(),
      params.bookingTeam,
      params.battingTeam,
      params.bowlingTeam,
      params.matchName,
      params.seriesName
    );

    const emittedTrades = [...this.emittedTradesBuffer];
    this.emittedTradesBuffer = [];

    await this.persistEvaluationArtifacts(
      params.matchId,
      params.match,
      [],
      emittedTrades,
      params.dbAvailable
    );
    return this.engine.serializeState(params.matchId);
  }

  public async recordManualExit(params: {
    matchId: string;
    positionType: PositionType;
    exitOdds: number;
    over: number;
    exitReason?: 'FIRST_BOOKSET_45_55' | 'FULL_BOOKSET_OPPOSING_85';
    match?: ParsedCricketMatch;
    dbAvailable?: boolean;
  }): Promise<SerializedMatchStrategyState> {
    if (params.match) {
      this.activeMatchContext.set(params.matchId, params.match);
    }
    this.emittedTradesBuffer = [];

    const reason =
      params.exitReason ||
      (params.positionType === 'FIRST_ENTRY'
        ? 'FIRST_BOOKSET_45_55'
        : 'FULL_BOOKSET_OPPOSING_85');

    this.engine.recordExit(
      params.matchId,
      params.positionType,
      params.exitOdds,
      params.over,
      new Date(),
      reason
    );

    const emittedTrades = [...this.emittedTradesBuffer];
    this.emittedTradesBuffer = [];

    await this.persistEvaluationArtifacts(
      params.matchId,
      params.match,
      [],
      emittedTrades,
      params.dbAvailable
    );
    return this.engine.serializeState(params.matchId);
  }

  public async resetMatch(matchId: string): Promise<SerializedMatchStrategyState> {
    this.engine.resetState(matchId);

    for (const key of Array.from(this.pendingTrades.keys())) {
      if (key.startsWith(`${matchId}:`)) this.pendingTrades.delete(key);
    }
    for (const key of Array.from(this.pendingPositions.keys())) {
      if (key.startsWith(`${matchId}:`)) this.pendingPositions.delete(key);
    }
    for (const key of Array.from(this.pendingSignals.keys())) {
      if (key.startsWith(`${matchId}:`)) this.pendingSignals.delete(key);
    }
    this.pendingStates.delete(matchId);

    for (const key of Array.from(this.persistedTradeSigs.keys())) {
      if (key.startsWith(`${matchId}:`)) this.persistedTradeSigs.delete(key);
    }
    for (const key of Array.from(this.persistedPositionSigs.keys())) {
      if (key.startsWith(`${matchId}:`)) this.persistedPositionSigs.delete(key);
    }
    this.persistedSnapshotSigs.delete(matchId);

    for (const key of Array.from(this.alertedTradeKeys)) {
      if (key.startsWith(`${matchId}:`)) this.alertedTradeKeys.delete(key);
    }
    for (const hash of Array.from(this.persistedSignalHashes)) {
      if (hash.startsWith(`${matchId}:`)) this.persistedSignalHashes.delete(hash);
    }

    if (this.storage.deleteMatchStrategy) {
      try {
        await this.storage.deleteMatchStrategy(matchId);
      } catch {
        // Non-blocking reset cleanup
      }
    }

    return this.engine.serializeState(matchId);
  }

  private async persistEvaluationArtifacts(
    matchId: string,
    match: ParsedCricketMatch | undefined,
    signals: StrategySignal[],
    emittedTrades: StrategyTradeRecord[],
    dbAvailable = true
  ): Promise<void> {
    const state = this.engine.getState(matchId);
    const snapshot = this.engine.serializeState(matchId);

    // 1. Trades: always ensure current trade records are queued/saved if changed or emitted
    const candidateTrades: StrategyTradeRecord[] = [...emittedTrades];
    if (state.firstEntryTrade && !candidateTrades.some((t) => t.entryType === 'FIRST_ENTRY')) {
      candidateTrades.push(state.firstEntryTrade);
    }
    if (state.secondEntryTrade && !candidateTrades.some((t) => t.entryType === 'SECOND_ENTRY')) {
      candidateTrades.push(state.secondEntryTrade);
    }

    for (const trade of candidateTrades) {
      const key = `${trade.matchId}:${trade.entryType}`;
      const sig = tradeSignature(trade);
      if (this.persistedTradeSigs.get(key) !== sig) {
        await this.tryPersistTrade(key, { ...trade }, match, dbAvailable);
      }
    }

    // 2. Dispatch Strategy Telegram Alerts ONLY if explicitly enabled & not already alerted
    for (const trade of emittedTrades) {
      const alertKey = `${trade.matchId}:${trade.entryType}:${trade.status}`;
      if (
        this.strategyAlertsEnabled &&
        !this.isRehydrating &&
        this.onStrategyAlert &&
        !this.alertedTradeKeys.has(alertKey)
      ) {
        this.alertedTradeKeys.add(alertKey);
        try {
          await this.onStrategyAlert({
            kind: trade.status === 'BOOKSET_COMPLETED' ? 'EXIT' : 'ENTRY',
            trade: { ...trade },
            match,
          });
        } catch (err) {
          console.warn('[Strategy Alert Error]', err);
        }
      }
    }

    // 3. Positions (first & second)
    for (const pos of [state.firstEntryPosition, state.secondEntryPosition]) {
      if (pos.status === 'NONE') continue;
      const key = `${pos.matchId}:${pos.positionType}`;
      const sig = positionSignature(pos);
      if (this.persistedPositionSigs.get(key) !== sig) {
        await this.tryPersistPosition(key, { ...pos }, match, dbAvailable);
      }
    }

    // 4. Signals (only persist new/unique signals not already hashed)
    for (const signal of signals) {
      if (signal.status === 'DATA UNAVAILABLE' && signal.signalType !== 'FIRST_ENTRY_CANDIDATE') {
        continue;
      }
      const dedupeHash = buildSignalDedupeHash(signal);
      if (!this.persistedSignalHashes.has(dedupeHash)) {
        await this.tryPersistSignal(dedupeHash, { ...signal }, match, dbAvailable);
      }
    }

    // 5. Strategy State Snapshot (for zero-loss reboot rehydration)
    const snapSig = snapshotSignature(snapshot);
    if (this.persistedSnapshotSigs.get(matchId) !== snapSig || emittedTrades.length > 0) {
      await this.tryPersistSnapshot(matchId, snapshot, dbAvailable);
    }
  }

  private async tryPersistTrade(
    key: string,
    trade: StrategyTradeRecord,
    match: ParsedCricketMatch | undefined,
    dbAvailable: boolean
  ): Promise<void> {
    if (!dbAvailable) {
      this.pendingTrades.set(key, { trade, match });
      return;
    }

    try {
      await this.storage.upsertTrade(trade, { match });
      this.persistedTradeSigs.set(key, tradeSignature(trade));
      this.pendingTrades.delete(key);
    } catch {
      this.pendingTrades.set(key, { trade, match });
    }
  }

  private async tryPersistPosition(
    key: string,
    position: TradePosition,
    match: ParsedCricketMatch | undefined,
    dbAvailable: boolean
  ): Promise<void> {
    if (!dbAvailable) {
      this.pendingPositions.set(key, { position, match });
      return;
    }

    try {
      await this.storage.upsertPosition(position, { match });
      this.persistedPositionSigs.set(key, positionSignature(position));
      this.pendingPositions.delete(key);
    } catch {
      this.pendingPositions.set(key, { position, match });
    }
  }

  private async tryPersistSignal(
    dedupeHash: string,
    signal: StrategySignal,
    match: ParsedCricketMatch | undefined,
    dbAvailable: boolean
  ): Promise<void> {
    if (!dbAvailable) {
      if (this.pendingSignals.size < 2000) {
        this.pendingSignals.set(dedupeHash, { signal, dedupeHash, match });
      }
      return;
    }

    try {
      await this.storage.insertSignal(signal, dedupeHash, { match });
      this.persistedSignalHashes.add(dedupeHash);
      this.pendingSignals.delete(dedupeHash);
    } catch {
      if (this.pendingSignals.size < 2000) {
        this.pendingSignals.set(dedupeHash, { signal, dedupeHash, match });
      }
    }
  }

  private async tryPersistSnapshot(
    matchId: string,
    snapshot: SerializedMatchStrategyState,
    dbAvailable: boolean
  ): Promise<void> {
    if (!dbAvailable) {
      this.pendingStates.set(matchId, snapshot);
      return;
    }

    try {
      await this.storage.upsertSnapshot(snapshot);
      this.persistedSnapshotSigs.set(matchId, snapshotSignature(snapshot));
      this.pendingStates.delete(matchId);
    } catch {
      this.pendingStates.set(matchId, snapshot);
    }
  }

  /**
   * Flushes any queued trades, positions, signals, and state snapshots once DB recovers.
   */
  public async flushPendingSaves(): Promise<{
    flushed: number;
    remaining: number;
  }> {
    if (this.isFlushing) {
      return { flushed: 0, remaining: this.getPendingCounts().total };
    }
    const counts = this.getPendingCounts();
    if (counts.total === 0) {
      return { flushed: 0, remaining: 0 };
    }

    this.isFlushing = true;
    let flushed = 0;

    try {
      for (const [key, item] of Array.from(this.pendingTrades.entries())) {
        try {
          await this.storage.upsertTrade(item.trade, { match: item.match });
          this.persistedTradeSigs.set(key, tradeSignature(item.trade));
          this.pendingTrades.delete(key);
          flushed += 1;
        } catch {
          // Retain in outbox for next retry
        }
      }

      for (const [key, item] of Array.from(this.pendingPositions.entries())) {
        try {
          await this.storage.upsertPosition(item.position, { match: item.match });
          this.persistedPositionSigs.set(key, positionSignature(item.position));
          this.pendingPositions.delete(key);
          flushed += 1;
        } catch {
          // Retain in outbox for next retry
        }
      }

      for (const [hash, item] of Array.from(this.pendingSignals.entries())) {
        try {
          await this.storage.insertSignal(item.signal, item.dedupeHash, { match: item.match });
          this.persistedSignalHashes.add(hash);
          this.pendingSignals.delete(hash);
          flushed += 1;
        } catch {
          // Retain in outbox for next retry
        }
      }

      for (const [matchId, snap] of Array.from(this.pendingStates.entries())) {
        try {
          await this.storage.upsertSnapshot(snap);
          this.persistedSnapshotSigs.set(matchId, snapshotSignature(snap));
          this.pendingStates.delete(matchId);
          flushed += 1;
        } catch {
          // Retain in outbox for next retry
        }
      }

      return { flushed, remaining: this.getPendingCounts().total };
    } finally {
      this.isFlushing = false;
    }
  }
}
