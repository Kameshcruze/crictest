import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  Lock,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Sliders,
  Bell,
} from 'lucide-react';
import type { PositionType } from '../../services/strategy/types';
import {
  fetchAdminStrategyRules,
  postAdminManualEntry,
  postAdminManualExit,
  postAdminStrategyReset,
  toggleAdminStrategyAlerts,
  AdminStrategyRulesResponse,
  AdminSessionExpiredError,
} from '../../services/adminApi';
import { ConfirmDialog } from './ConfirmDialog';

interface AdminStrategySectionProps {
  onSessionExpired: (msg?: string) => void;
}

type StrategyPendingAction =
  | {
      type: 'alerts-on';
    }
  | {
      type: 'entry';
      matchId: string;
      matchTitle: string;
      positionType: PositionType;
      entryOdds: number;
      innings: number;
      over: number;
      wickets: number;
      bookingTeam: string;
    }
  | {
      type: 'exit';
      matchId: string;
      matchTitle: string;
      positionType: PositionType;
      exitOdds: number;
      over: number;
      exitReason: string;
    }
  | {
      type: 'reset';
      matchId: string;
      matchTitle: string;
    }
  | null;

export const AdminStrategySection: React.FC<AdminStrategySectionProps> = ({
  onSessionExpired,
}) => {
  const [data, setData] = useState<AdminStrategyRulesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const [selectedMatchId, setSelectedMatchId] = useState<string>('');

  // Manual Entry Form
  const [entryPosType, setEntryPosType] = useState<PositionType>('FIRST_ENTRY');
  const [entryOdds, setEntryOdds] = useState<string>('1.86');
  const [entryInnings, setEntryInnings] = useState<string>('1');
  const [entryOver, setEntryOver] = useState<string>('0');
  const [entryWickets, setEntryWickets] = useState<string>('0');
  const [entryBookingTeam, setEntryBookingTeam] = useState<string>('');

  // Manual Exit Form
  const [exitPosType, setExitPosType] = useState<PositionType>('FIRST_ENTRY');
  const [exitOdds, setExitOdds] = useState<string>('1.55');
  const [exitOver, setExitOver] = useState<string>('0');
  const [exitReason, setExitReason] = useState<string>('FIRST_BOOKSET_45_55');

  const [pendingAction, setPendingAction] = useState<StrategyPendingAction>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdminStrategyRules();
      setData(res);
      setSelectedMatchId((prev) => {
        if (prev && res.matches.some((m) => m.id === prev)) return prev;
        return res.matches[0]?.id || '';
      });
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) {
        onSessionExpired(err.message);
        return;
      }
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load strategy data',
      });
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedMatch = useMemo(
    () => data?.matches.find((m) => m.id === selectedMatchId) || null,
    [data, selectedMatchId]
  );

  // Pre-fill sensible live defaults when match selection changes
  useEffect(() => {
    if (!selectedMatch) return;
    setEntryInnings(String(selectedMatch.innings || 1));
    setEntryOver(String(selectedMatch.over || 0));
    setEntryWickets(String(selectedMatch.wickets || 0));
    setExitOver(String(selectedMatch.over || 0));
    if (selectedMatch.decimalBack && selectedMatch.decimalBack > 1) {
      setEntryOdds(selectedMatch.decimalBack.toFixed(2));
    }
    if (selectedMatch.decimalLay && selectedMatch.decimalLay > 1) {
      setExitOdds(selectedMatch.decimalLay.toFixed(2));
    }
    const defaultBooking =
      selectedMatch.state?.bookingTeamName ||
      (selectedMatch.innings === 2 ? selectedMatch.team2Name : selectedMatch.team1Name);
    setEntryBookingTeam(defaultBooking || '');
  }, [selectedMatch?.id]);

  const handleToggleAlertsOff = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const res = await toggleAdminStrategyAlerts({ enabled: false });
      setData((prev) =>
        prev
          ? {
              ...prev,
              strategyAlerts: res.strategyAlerts,
              strategyAlertsEnabled: res.strategyAlerts.enabled,
            }
          : prev
      );
      setBanner({
        type: 'ok',
        text: 'Master Strategy Alerts turned OFF immediately (saved in app_settings and logged in audit log).',
      });
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) {
        onSessionExpired(err.message);
        return;
      }
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update strategy alerts switch',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleResetAlertsToEnv = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const res = await toggleAdminStrategyAlerts({ resetToEnvDefault: true });
      setData((prev) =>
        prev
          ? {
              ...prev,
              strategyAlerts: res.strategyAlerts,
              strategyAlertsEnabled: res.strategyAlerts.enabled,
            }
          : prev
      );
      setBanner({
        type: 'ok',
        text: `Master Strategy Alerts reset to environment default (STRATEGY_ALERTS_ENABLED=${String(res.strategyAlerts.envDefault)}).`,
      });
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) {
        onSessionExpired(err.message);
        return;
      }
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to reset strategy alerts switch',
      });
    } finally {
      setBusy(false);
    }
  };

  const executeConfirmed = async () => {
    if (!pendingAction) return;
    setBusy(true);
    setBanner(null);
    try {
      if (pendingAction.type === 'alerts-on') {
        const res = await toggleAdminStrategyAlerts({ enabled: true, confirm: true });
        setData((prev) =>
          prev
            ? {
                ...prev,
                strategyAlerts: res.strategyAlerts,
                strategyAlertsEnabled: res.strategyAlerts.enabled,
              }
            : prev
        );
        setBanner({
          type: 'ok',
          text: 'Master Strategy Alerts turned ON immediately (saved in app_settings and logged in audit log).',
        });
        setPendingAction(null);
        return;
      } else if (pendingAction.type === 'entry') {
        await postAdminManualEntry({
          matchId: pendingAction.matchId,
          positionType: pendingAction.positionType,
          entryOdds: pendingAction.entryOdds,
          innings: pendingAction.innings,
          over: pendingAction.over,
          wickets: pendingAction.wickets,
          bookingTeam: pendingAction.bookingTeam,
          matchName: pendingAction.matchTitle,
          seriesName: selectedMatch?.seriesName,
        });
        setBanner({
          type: 'ok',
          text: `Manual ${pendingAction.positionType === 'FIRST_ENTRY' ? '1st' : '2nd'} Entry recorded for ${pendingAction.matchTitle} (marked MANUAL) and broadcast to live clients.`,
        });
      } else if (pendingAction.type === 'exit') {
        await postAdminManualExit({
          matchId: pendingAction.matchId,
          positionType: pendingAction.positionType,
          exitOdds: pendingAction.exitOdds,
          over: pendingAction.over,
          exitReason: pendingAction.exitReason || undefined,
        });
        setBanner({
          type: 'ok',
          text: `Manual Exit recorded for ${pendingAction.matchTitle} (marked MANUAL) and broadcast to live clients.`,
        });
      } else if (pendingAction.type === 'reset') {
        await postAdminStrategyReset(pendingAction.matchId);
        setBanner({
          type: 'ok',
          text: `Strategy state reset for ${pendingAction.matchTitle} and synced across live clients.`,
        });
      }
      setPendingAction(null);
      await load();
    } catch (err: unknown) {
      setPendingAction(null);
      if (err instanceof AdminSessionExpiredError) {
        onSessionExpired(err.message);
        return;
      }
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Strategy action failed',
      });
    } finally {
      setBusy(false);
    }
  };

  const rules = data?.rules;
  const strategyAlerts = data?.strategyAlerts;
  const activeState = selectedMatch?.state || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[var(--tx)]">Strategy Controls & Rules</h2>
          <p className="text-xs text-[var(--mu)]">
            Read-only engine thresholds and admin-only manual entry, exit, and reset overrides.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="min-h-[44px] px-4 rounded-xl bg-[var(--sf)] hover:bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] inline-flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
          <span>Refresh</span>
        </button>
      </div>

      {banner && (
        <div
          role={banner.type === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
            banner.type === 'ok'
              ? 'bg-[var(--ok-bg)] border-[var(--ok-bd)] text-[var(--ok-tx)]'
              : 'bg-[var(--rds)] border-[var(--rd)]/35 text-[var(--rdt)]'
          }`}
        >
          {banner.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.8} />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.8} />
          )}
          <span>{banner.text}</span>
        </div>
      )}

      {/* Master Strategy-Alerts Switch */}
      <section
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-3"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Bell className="w-4 h-4 text-[var(--rdt)]" strokeWidth={1.8} />
              <h3 className="text-sm font-bold text-[var(--tx)]">Master Strategy Alerts Switch</h3>
              {strategyAlerts && (
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${
                    strategyAlerts.enabled
                      ? 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border-[var(--ok-bd)]'
                      : 'bg-[var(--sf-2)] text-[var(--mu)] border-[var(--bd)]'
                  }`}
                >
                  {strategyAlerts.enabled ? 'ON' : 'OFF'}
                </span>
              )}
            </div>
            {strategyAlerts && (
              <p className="text-xs text-[var(--mu)]">
                Status:{' '}
                <strong className="text-[var(--tx)]">
                  {strategyAlerts.enabled ? 'Enabled (sending live strategy alerts)' : 'Disabled (strategy alerts suppressed)'}
                </strong>{' '}
                · Source:{' '}
                <strong className="text-[var(--tx)]">
                  {strategyAlerts.source === 'db'
                    ? 'Saved in Admin (app_settings)'
                    : `Environment default (STRATEGY_ALERTS_ENABLED=${String(strategyAlerts.envDefault)})`}
                </strong>
                {strategyAlerts.source === 'db' && (
                  <span>
                    {' '}
                    (env default: {String(strategyAlerts.envDefault)}
                    {strategyAlerts.updatedAt
                      ? ` · updated ${new Date(strategyAlerts.updatedAt).toLocaleString()}`
                      : ''}
                    )
                  </span>
                )}
              </p>
            )}
          </div>

          {strategyAlerts && (
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {strategyAlerts.enabled ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleToggleAlertsOff}
                  className="min-h-[44px] px-4 rounded-xl bg-[var(--rds)] hover:opacity-90 border border-[var(--rd)]/30 text-[var(--rdt)] text-xs font-semibold transition-opacity disabled:opacity-45"
                >
                  Turn Strategy Alerts OFF
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingAction({ type: 'alerts-on' })}
                  className="min-h-[44px] px-4 rounded-xl bg-[var(--ok-bg)] hover:opacity-90 border border-[var(--ok-bd)] text-[var(--ok-tx)] text-xs font-semibold transition-opacity disabled:opacity-45"
                >
                  Turn Strategy Alerts ON
                </button>
              )}

              {strategyAlerts.source === 'db' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleResetAlertsToEnv}
                  className="min-h-[44px] px-3.5 rounded-xl bg-[var(--sf-2)] hover:bg-[var(--bd)]/35 border border-[var(--bd)] text-[var(--tx)] text-xs font-semibold transition-colors disabled:opacity-45"
                >
                  Reset to Env Default
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Read-Only Strategy Rules (Single Source of Truth from Real Engine Config) */}
      <section
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-3"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-[var(--mu)]" strokeWidth={1.8} />
              <h3 className="text-sm font-bold text-[var(--tx)]">Engine Thresholds (Read-Only)</h3>
            </div>
            <p className="text-[11px] text-[var(--mu)] mt-0.5">
              Read directly from live server engine config (<code className="font-mono">strategyCoordinator.engine.getConfig()</code>).
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[var(--sf-2)] text-[var(--mu)] border border-[var(--bd)]">
            Single Source of Truth
          </span>
        </div>

        {rules && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs tabular-nums">
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
              <div className="text-[11px] text-[var(--mu)]">1st Entry Min</div>
              <div className="font-bold text-[var(--tx)] mt-0.5">
                BATTING &gt;= {rules.firstEntry.minPaiseInclusive}p
              </div>
              <div className="text-[10px] text-[var(--mu)] mt-0.5">
                &gt;= {rules.firstEntry.minOddsInclusive.toFixed(2)} decimal
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
              <div className="text-[11px] text-[var(--mu)]">2nd Entry Target</div>
              <div className="font-bold text-[var(--tx)] mt-0.5">
                BOWLING &lt; {rules.secondEntry.maxBowlingPaiseExclusive}p
              </div>
              <div className="text-[10px] text-[var(--mu)] mt-0.5">
                &lt; {rules.secondEntry.maxBowlingOddsExclusive.toFixed(2)} · after wkt
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
              <div className="text-[11px] text-[var(--mu)]">Early Exit (No Wkt)</div>
              <div className="font-bold text-[var(--tx)] mt-0.5">
                BATTING &lt;= {rules.firstExitBelow55.maxBattingPaiseInclusive}p
              </div>
              <div className="text-[10px] text-[var(--mu)] mt-0.5">
                &lt;= {rules.firstExitBelow55.maxBattingOddsInclusive.toFixed(2)} decimal
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
              <div className="text-[11px] text-[var(--mu)]">Unified Bookset</div>
              <div className="font-bold text-[var(--tx)] mt-0.5">
                BOWLING &gt; {rules.bookset.minBowlingPaiseExclusive}p
              </div>
              <div className="text-[10px] text-[var(--mu)] mt-0.5">
                &gt; {rules.bookset.minBowlingOddsExclusive.toFixed(2)} decimal
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
              <div className="text-[11px] text-[var(--mu)]">Abnormal Jump (4 / 6)</div>
              <div className="font-bold text-[var(--tx)] mt-0.5">
                &gt;= {rules.abnormalActivity.fourMinPaise}p / &gt;= {rules.abnormalActivity.sixMinPaise}p
              </div>
              <div className="text-[10px] text-[var(--mu)] mt-0.5">
                {rules.abnormalActivity.fourMinMovement.toFixed(2)} / {rules.abnormalActivity.sixMinMovement.toFixed(2)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
              <div className="text-[11px] text-[var(--mu)]">Over Limits &amp; Wkts</div>
              <div className="font-bold text-[var(--tx)] mt-0.5">
                &lt; {rules.entryWindows.firstInningsMaxOver.toFixed(1)} / &lt; {rules.entryWindows.secondInningsMaxOver.toFixed(1)} ov
              </div>
              <div className="text-[10px] text-[var(--mu)] mt-0.5">
                Skip if &gt;= {rules.wicketFilter.maxAllowedWicketsBeforeEntry} wkts
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Match Selector & Current State */}
      <section
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-4"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-[var(--rdt)]" strokeWidth={1.8} />
          <h3 className="text-sm font-bold text-[var(--tx)]">Manual Match Overrides</h3>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="admin-strategy-match" className="block text-xs font-semibold text-[var(--tx)]">
            Select Match
          </label>
          <select
            id="admin-strategy-match"
            value={selectedMatchId}
            onChange={(e) => setSelectedMatchId(e.target.value)}
            className="w-full min-h-[44px] px-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] focus:border-[var(--rd)]"
          >
            {data?.matches.length ? (
              data.matches.map((m) => (
                <option key={m.id} value={m.id}>
                  [{m.status.toUpperCase()}] {m.title} ({m.format}) — {m.seriesName} [ID: {m.id}]
                </option>
              ))
            ) : (
              <option value="">No matches available in live store</option>
            )}
          </select>
        </div>

        {selectedMatch && (
          <div className="p-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-[var(--tx)]">
                {selectedMatch.title}{' '}
                <span className="font-normal text-[var(--mu)]">· {selectedMatch.seriesName}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="px-2 py-0.5 rounded-md font-mono text-[11px] bg-[var(--sf)] border border-[var(--bd)] text-[var(--tx)]">
                  {activeState?.stage || 'WAITING_FOR_CONFIRMATION'}
                </span>
                {(activeState?.firstEntryTrade?.isManual ||
                  activeState?.firstEntryTrade?.source === 'MANUAL' ||
                  activeState?.secondEntryTrade?.isManual ||
                  activeState?.secondEntryTrade?.source === 'MANUAL') && (
                  <span className="px-2 py-0.5 rounded-md font-bold text-[10px] bg-[var(--purple-bg)] text-[var(--purple-tx)] border border-[var(--purple-bd)]">
                    MANUAL
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--mu)] tabular-nums">
              <span>Score 1: {selectedMatch.score1 || '—'}</span>
              <span>Score 2: {selectedMatch.score2 || '—'}</span>
              <span>
                Bookmaker: {selectedMatch.favTeam || '—'} B:{selectedMatch.decimalBack ?? '—'} / L:
                {selectedMatch.decimalLay ?? '—'}
              </span>
              <span>
                1st Entry: {activeState?.firstEntryPosition?.status || 'NONE'}
                {activeState?.firstEntryTrade?.entryDecimal
                  ? ` @ ${activeState.firstEntryTrade.entryDecimal.toFixed(2)}`
                  : ''}
              </span>
              <span>
                2nd Entry: {activeState?.secondEntryPosition?.status || 'NONE'}
                {activeState?.secondEntryTrade?.entryDecimal
                  ? ` @ ${activeState.secondEntryTrade.entryDecimal.toFixed(2)}`
                  : ''}
              </span>
            </div>
          </div>
        )}

        {selectedMatch && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
            {/* Manual Entry Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const parsedOdds = Number(entryOdds);
                if (!Number.isFinite(parsedOdds) || parsedOdds <= 1) {
                  setBanner({ type: 'error', text: 'Entry decimal odds must be greater than 1.00.' });
                  return;
                }
                setPendingAction({
                  type: 'entry',
                  matchId: selectedMatch.id,
                  matchTitle: selectedMatch.title,
                  positionType: entryPosType,
                  entryOdds: parsedOdds,
                  innings: Number(entryInnings) || 1,
                  over: Number(entryOver) || 0,
                  wickets: Number(entryWickets) || 0,
                  bookingTeam: entryBookingTeam.trim() || 'Manual Override',
                });
              }}
              className="p-4 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] space-y-3"
            >
              <div className="text-xs font-bold text-[var(--tx)]">Manual Entry Override</div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label htmlFor="entry-pos-type" className="block text-[11px] font-semibold text-[var(--mu)]">
                    Position
                  </label>
                  <select
                    id="entry-pos-type"
                    value={entryPosType}
                    onChange={(e) => setEntryPosType(e.target.value as PositionType)}
                    className="w-full min-h-[44px] px-2.5 rounded-xl bg-[var(--sf)] border border-[var(--bd)] text-xs text-[var(--tx)]"
                  >
                    <option value="FIRST_ENTRY">1st Entry</option>
                    <option value="SECOND_ENTRY">2nd Entry</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="entry-odds" className="block text-[11px] font-semibold text-[var(--mu)]">
                    Entry Decimal Odds
                  </label>
                  <input
                    id="entry-odds"
                    type="number"
                    step="0.01"
                    min="1.01"
                    required
                    value={entryOdds}
                    onChange={(e) => setEntryOdds(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-[var(--sf)] border border-[var(--bd)] text-xs font-mono tabular-nums text-[var(--tx)]"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="entry-innings" className="block text-[11px] font-semibold text-[var(--mu)]">
                    Innings
                  </label>
                  <select
                    id="entry-innings"
                    value={entryInnings}
                    onChange={(e) => setEntryInnings(e.target.value)}
                    className="w-full min-h-[44px] px-2.5 rounded-xl bg-[var(--sf)] border border-[var(--bd)] text-xs text-[var(--tx)]"
                  >
                    <option value="1">Innings 1</option>
                    <option value="2">Innings 2</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="entry-over" className="block text-[11px] font-semibold text-[var(--mu)]">
                    Over / Wickets
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      id="entry-over"
                      type="number"
                      step="0.1"
                      min="0"
                      aria-label="Entry over"
                      value={entryOver}
                      onChange={(e) => setEntryOver(e.target.value)}
                      className="w-full min-h-[44px] px-2 rounded-xl bg-[var(--sf)] border border-[var(--bd)] text-xs font-mono tabular-nums text-[var(--tx)]"
                    />
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="10"
                      aria-label="Entry wickets"
                      value={entryWickets}
                      onChange={(e) => setEntryWickets(e.target.value)}
                      className="w-full min-h-[44px] px-2 rounded-xl bg-[var(--sf)] border border-[var(--bd)] text-xs font-mono tabular-nums text-[var(--tx)]"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="entry-booking-team" className="block text-[11px] font-semibold text-[var(--mu)]">
                  Booking Team
                </label>
                <input
                  id="entry-booking-team"
                  type="text"
                  value={entryBookingTeam}
                  onChange={(e) => setEntryBookingTeam(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl bg-[var(--sf)] border border-[var(--bd)] text-xs text-[var(--tx)]"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[44px] px-4 rounded-xl bg-[var(--ok-bg)] hover:opacity-90 border border-[var(--ok-bd)] text-[var(--ok-tx)] text-xs font-semibold transition-opacity disabled:opacity-45"
              >
                Record Manual Entry
              </button>
            </form>

            {/* Manual Exit Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const parsedOdds = Number(exitOdds);
                if (!Number.isFinite(parsedOdds) || parsedOdds <= 1) {
                  setBanner({ type: 'error', text: 'Exit decimal odds must be greater than 1.00.' });
                  return;
                }
                setPendingAction({
                  type: 'exit',
                  matchId: selectedMatch.id,
                  matchTitle: selectedMatch.title,
                  positionType: exitPosType,
                  exitOdds: parsedOdds,
                  over: Number(exitOver) || 0,
                  exitReason,
                });
              }}
              className="p-4 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] space-y-3"
            >
              <div className="text-xs font-bold text-[var(--tx)]">Manual Exit Override</div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label htmlFor="exit-pos-type" className="block text-[11px] font-semibold text-[var(--mu)]">
                    Position
                  </label>
                  <select
                    id="exit-pos-type"
                    value={exitPosType}
                    onChange={(e) => setExitPosType(e.target.value as PositionType)}
                    className="w-full min-h-[44px] px-2.5 rounded-xl bg-[var(--sf)] border border-[var(--bd)] text-xs text-[var(--tx)]"
                  >
                    <option value="FIRST_ENTRY">1st Entry</option>
                    <option value="SECOND_ENTRY">2nd Entry</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="exit-odds" className="block text-[11px] font-semibold text-[var(--mu)]">
                    Exit Decimal Odds
                  </label>
                  <input
                    id="exit-odds"
                    type="number"
                    step="0.01"
                    min="1.01"
                    required
                    value={exitOdds}
                    onChange={(e) => setExitOdds(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-[var(--sf)] border border-[var(--bd)] text-xs font-mono tabular-nums text-[var(--tx)]"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="exit-over" className="block text-[11px] font-semibold text-[var(--mu)]">
                    Exit Over
                  </label>
                  <input
                    id="exit-over"
                    type="number"
                    step="0.1"
                    min="0"
                    value={exitOver}
                    onChange={(e) => setExitOver(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-[var(--sf)] border border-[var(--bd)] text-xs font-mono tabular-nums text-[var(--tx)]"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="exit-reason" className="block text-[11px] font-semibold text-[var(--mu)]">
                    Exit Reason
                  </label>
                  <select
                    id="exit-reason"
                    value={exitReason}
                    onChange={(e) => setExitReason(e.target.value)}
                    className="w-full min-h-[44px] px-2.5 rounded-xl bg-[var(--sf)] border border-[var(--bd)] text-xs text-[var(--tx)]"
                  >
                    <option value="FIRST_EXIT_BELOW_55">FIRST_EXIT_BELOW_55</option>
                    <option value="FIRST_BOOKSET_45_55">FIRST_BOOKSET_45_55</option>
                    <option value="FULL_BOOKSET_OPPOSING_85">FULL_BOOKSET_OPPOSING_85</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[44px] px-4 rounded-xl bg-[var(--blu)] hover:opacity-90 border border-[var(--info-bd)] text-[var(--blut)] text-xs font-semibold transition-opacity disabled:opacity-45"
              >
                Record Manual Exit
              </button>
            </form>
          </div>
        )}

        {/* Danger Zone: Reset Match Strategy (Requires Typing RESET) */}
        {selectedMatch && (
          <div className="p-4 rounded-xl bg-[var(--rds)]/60 border border-[var(--rd)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-[var(--rdt)]">Reset Match Strategy State</div>
              <p className="text-[11px] text-[var(--mu)] mt-0.5">
                Clears server-side strategy state, open positions, and signals for{' '}
                <strong className="text-[var(--tx)]">{selectedMatch.title}</strong>. Requires typing{' '}
                <code className="font-mono">RESET</code> to confirm.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setPendingAction({
                  type: 'reset',
                  matchId: selectedMatch.id,
                  matchTitle: selectedMatch.title,
                })
              }
              className="min-h-[44px] px-4 rounded-xl bg-[var(--rd)] text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-45 inline-flex items-center justify-center gap-2 shrink-0"
            >
              <RotateCcw className="w-4 h-4" strokeWidth={1.8} />
              <span>Reset Match</span>
            </button>
          </div>
        )}
      </section>

      <ConfirmDialog
        isOpen={pendingAction !== null}
        title={
          pendingAction?.type === 'alerts-on'
            ? 'Enable Master Strategy Alerts?'
            : pendingAction?.type === 'reset'
            ? `Reset Strategy: ${pendingAction.matchTitle}`
            : pendingAction?.type === 'entry'
            ? `Confirm Manual ${pendingAction.positionType === 'FIRST_ENTRY' ? '1st' : '2nd'} Entry`
            : pendingAction?.type === 'exit'
            ? `Confirm Manual Exit`
            : 'Confirm Action'
        }
        description={
          pendingAction?.type === 'alerts-on'
            ? 'Turning Master Strategy Alerts ON takes effect immediately without a server restart. Automated strategy entry and exit Telegram messages will be dispatched whenever Telegram is enabled and configured. This change will be saved in app_settings and logged in the admin audit log.'
            : pendingAction?.type === 'reset'
            ? `This permanently resets the strategy state for ${pendingAction.matchTitle} (${pendingAction.matchId}) on the server and broadcasts the reset to all live viewers.`
            : pendingAction?.type === 'entry'
            ? `Record a MANUAL ${pendingAction.positionType} on ${pendingAction.matchTitle} at decimal odds ${pendingAction.entryOdds.toFixed(2)} (Inn ${pendingAction.innings}, Over ${pendingAction.over}, Wkts ${pendingAction.wickets}). Public Analysis cards will display a MANUAL badge.`
            : pendingAction?.type === 'exit'
            ? `Record a MANUAL exit for ${pendingAction.positionType} on ${pendingAction.matchTitle} at decimal odds ${pendingAction.exitOdds.toFixed(2)} (Over ${pendingAction.over}, Reason: ${pendingAction.exitReason}).`
            : ''
        }
        confirmLabel={
          pendingAction?.type === 'alerts-on'
            ? 'Turn Alerts ON'
            : pendingAction?.type === 'reset'
            ? 'Reset Strategy'
            : 'Confirm Override'
        }
        danger={pendingAction?.type === 'reset'}
        requiredKeyword={pendingAction?.type === 'reset' ? 'RESET' : undefined}
        busy={busy}
        onConfirm={executeConfirmed}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
};
