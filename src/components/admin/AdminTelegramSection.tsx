import React, { useEffect, useState, useCallback } from 'react';
import {
  Send,
  Save,
  KeyRound,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Trash2,
  Info,
} from 'lucide-react';
import type { SafeTelegramConfigStatus } from '../../services/telegramService';
import {
  fetchAdminTelegramStatus,
  saveAdminTelegramConfig,
  sendAdminTelegramTest,
  sendAdminTelegramTestOver,
  sendAdminTelegramBroadcast,
  AdminApiError,
  AdminSessionExpiredError,
} from '../../services/adminApi';
import { ConfirmDialog } from './ConfirmDialog';

interface AdminTelegramSectionProps {
  onSessionExpired: (msg?: string) => void;
}

type PendingAction =
  | { type: 'test' }
  | { type: 'test-over' }
  | { type: 'broadcast'; text: string }
  | { type: 'clear-token' }
  | null;

export const AdminTelegramSection: React.FC<AdminTelegramSectionProps> = ({
  onSessionExpired,
}) => {
  const [status, setStatus] = useState<SafeTelegramConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [sendingAction, setSendingAction] = useState(false);

  // Editable fields for existing app_settings['telegram_config'] row
  const [enabled, setEnabled] = useState(false);
  const [chatId, setChatId] = useState('');
  const [notifyWickets, setNotifyWickets] = useState(false);
  const [notifyResults, setNotifyResults] = useState(false);
  const [notifyOverCompletion, setNotifyOverCompletion] = useState(false);
  const [notifyPeriodicDigest, setNotifyPeriodicDigest] = useState(false);
  const [notifyStrategyEntries, setNotifyStrategyEntries] = useState(false);
  const [digestIntervalMinutes, setDigestIntervalMinutes] = useState(3);

  // Write-only token replacement
  const [newToken, setNewToken] = useState('');

  // Manual broadcast draft
  const [broadcastText, setBroadcastText] = useState('');

  // Feedback banner
  const [banner, setBanner] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const hydrateForm = useCallback((cfg: SafeTelegramConfigStatus) => {
    setStatus(cfg);
    setEnabled(cfg.enabled);
    setChatId(cfg.chatId || '');
    setNotifyWickets(cfg.notifyWickets);
    setNotifyResults(cfg.notifyResults);
    setNotifyOverCompletion(cfg.notifyOverCompletion);
    setNotifyPeriodicDigest(cfg.notifyPeriodicDigest);
    setNotifyStrategyEntries(cfg.notifyStrategyEntries);
    setDigestIntervalMinutes(cfg.digestIntervalMinutes || 3);
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdminTelegramStatus();
      hydrateForm(res.data);
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) {
        onSessionExpired(err.message);
        return;
      }
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load Telegram status',
      });
    } finally {
      setLoading(false);
    }
  }, [hydrateForm, onSessionExpired]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setBanner(null);
    try {
      const res = await saveAdminTelegramConfig({
        enabled,
        chatId: chatId.trim(),
        notifyWickets,
        notifyResults,
        notifyOverCompletion,
        notifyPeriodicDigest,
        notifyStrategyEntries,
        digestIntervalMinutes: Math.max(1, Math.min(1440, Math.round(Number(digestIntervalMinutes) || 3))),
      });
      hydrateForm(res.data);
      setBanner({
        type: 'ok',
        text: 'Telegram settings saved to PostgreSQL and applied immediately (no restart required).',
      });
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) {
        onSessionExpired(err.message);
        return;
      }
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save Telegram settings',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newToken.trim()) return;
    setSavingToken(true);
    setBanner(null);
    try {
      const res = await saveAdminTelegramConfig({ botToken: newToken.trim() });
      setNewToken('');
      hydrateForm(res.data);
      setBanner({
        type: 'ok',
        text:
          res.data.tokenSource === 'env'
            ? 'Token saved server-side. Note: TELEGRAM_BOT_TOKEN in .env still takes priority until removed.'
            : `Bot token saved server-side (****${res.data.tokenLast4 || ''}) and active immediately.`,
      });
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) {
        onSessionExpired(err.message);
        return;
      }
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update bot token',
      });
    } finally {
      setSavingToken(false);
    }
  };

  const executeConfirmedAction = async () => {
    if (!pendingAction) return;
    setSendingAction(true);
    setBanner(null);
    try {
      if (pendingAction.type === 'clear-token') {
        const res = await saveAdminTelegramConfig({ clearStoredToken: true });
        hydrateForm(res.data);
        setBanner({
          type: 'ok',
          text: 'Admin-saved Telegram token cleared from server storage.',
        });
      } else if (pendingAction.type === 'test') {
        const res = await sendAdminTelegramTest(chatId.trim() || undefined);
        if (res?.ok) {
          setBanner({ type: 'ok', text: 'Test Telegram message sent and logged in audit log.' });
        } else {
          setBanner({
            type: 'error',
            text: res?.description || res?.error || 'Telegram API rejected the test message.',
          });
        }
      } else if (pendingAction.type === 'test-over') {
        const res = await sendAdminTelegramTestOver();
        if (res?.ok) {
          setBanner({ type: 'ok', text: 'Test over-completion alert sent and logged in audit log.' });
        } else {
          setBanner({
            type: 'error',
            text: res?.description || res?.error || 'Telegram API rejected the over test alert.',
          });
        }
      } else if (pendingAction.type === 'broadcast') {
        const res = await sendAdminTelegramBroadcast({
          text: pendingAction.text,
          chatId: chatId.trim() || undefined,
          confirm: true,
        });
        if (res?.ok) {
          setBroadcastText('');
          setBanner({
            type: 'ok',
            text: 'Manual broadcast delivered to Telegram and recorded in admin_audit_log.',
          });
        } else {
          setBanner({
            type: 'error',
            text: res?.description || res?.error || 'Telegram API rejected the broadcast.',
          });
        }
      }
      setPendingAction(null);
    } catch (err: unknown) {
      setPendingAction(null);
      if (err instanceof AdminSessionExpiredError) {
        onSessionExpired(err.message);
        return;
      }
      if (err instanceof AdminApiError && err.status === 429) {
        setBanner({
          type: 'error',
          text: err.message,
        });
      } else {
        setBanner({
          type: 'error',
          text: err instanceof Error ? err.message : 'Telegram action failed',
        });
      }
    } finally {
      setSendingAction(false);
    }
  };

  const tokenSourceDisplay =
    status?.tokenSource === 'env'
      ? 'env (TELEGRAM_BOT_TOKEN)'
      : status?.tokenSource === 'db'
      ? 'saved in admin'
      : 'not configured';

  const toggleItems: Array<{
    key: string;
    label: string;
    description: string;
    checked: boolean;
    onChange: (v: boolean) => void;
  }> = [
    {
      key: 'enabled',
      label: 'Master Automated Alerts',
      description: 'Master switch for all automated server-side Telegram alerts.',
      checked: enabled,
      onChange: setEnabled,
    },
    {
      key: 'notifyWickets',
      label: 'Wicket Alerts',
      description: 'Send alert immediately when a wicket falls in a live match.',
      checked: notifyWickets,
      onChange: setNotifyWickets,
    },
    {
      key: 'notifyOverCompletion',
      label: 'Over Completion Updates',
      description: 'Send scoreboard & live odds summary at the end of each over.',
      checked: notifyOverCompletion,
      onChange: setNotifyOverCompletion,
    },
    {
      key: 'notifyResults',
      label: 'Match Conclusion Results',
      description: 'Send deduplicated final match result once a match concludes.',
      checked: notifyResults,
      onChange: setNotifyResults,
    },
    {
      key: 'notifyPeriodicDigest',
      label: 'Periodic Live Digest',
      description: 'Send a combined scoreboard digest of active live matches on interval.',
      checked: notifyPeriodicDigest,
      onChange: setNotifyPeriodicDigest,
    },
    {
      key: 'notifyStrategyEntries',
      label: 'Strategy Entry & Exit Alerts',
      description: 'Also requires STRATEGY_ALERTS_ENABLED=true in server .env.',
      checked: notifyStrategyEntries,
      onChange: setNotifyStrategyEntries,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[var(--tx)]">Telegram Alerts & Broadcast</h2>
          <p className="text-xs text-[var(--mu)]">
            Edits the existing <code className="font-mono">telegram_config</code> row and applies live without restart.
          </p>
        </div>
        <button
          type="button"
          onClick={loadStatus}
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

      {/* Token Status Summary */}
      <section
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-3"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[var(--rdt)]" strokeWidth={1.8} />
            <h3 className="text-sm font-bold text-[var(--tx)]">Bot Token Status</h3>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
              status?.configured
                ? 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border-[var(--ok-bd)]'
                : 'bg-[var(--warn-bg)] text-[var(--warn-tx)] border-[var(--warn-bd)]'
            }`}
          >
            {status?.configured ? 'Configured' : 'Not Configured'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
            <div className="text-[11px] text-[var(--mu)]">Active Token Source</div>
            <div className="font-semibold text-[var(--tx)] mt-0.5">{tokenSourceDisplay}</div>
          </div>
          <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
            <div className="text-[11px] text-[var(--mu)]">Masked Token</div>
            <div className="font-mono font-semibold text-[var(--tx)] mt-0.5 tabular-nums">
              {status?.tokenLast4 ? `****${status.tokenLast4}` : 'None'}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)]">
            <div className="text-[11px] text-[var(--mu)]">Admin-Saved Token</div>
            <div className="font-semibold text-[var(--tx)] mt-0.5">
              {status?.hasDbToken ? 'Present (server-side)' : 'None'}
            </div>
          </div>
        </div>

        {status?.tokenSource === 'env' && (
          <div className="p-3.5 rounded-xl bg-[var(--blu)] border border-[var(--info-bd)] text-[var(--blut)] text-xs flex items-start gap-2.5">
            <Info className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.8} />
            <span>
              <strong>Environment variable priority:</strong> <code className="font-mono">TELEGRAM_BOT_TOKEN</code> in{' '}
              <code className="font-mono">.env</code> takes priority. Any token saved below will be stored server-side
              but will <strong>not</strong> be used until <code className="font-mono">TELEGRAM_BOT_TOKEN</code> is removed
              from the environment and the server is restarted.
            </span>
          </div>
        )}
      </section>

      {/* Alert Settings Form (existing telegram_config row) */}
      <form
        onSubmit={handleSaveSettings}
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-4"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <div>
          <h3 className="text-sm font-bold text-[var(--tx)]">Notification Triggers & Chat Target</h3>
          <p className="text-xs text-[var(--mu)] mt-0.5">
            Changes save directly to <code className="font-mono">app_settings[&apos;telegram_config&apos;]</code> and take effect immediately.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="tg-chat-id" className="block text-xs font-semibold text-[var(--tx)]">
              Target Chat / Channel ID
            </label>
            <input
              id="tg-chat-id"
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="-1001234567890"
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-mono text-[var(--tx)] placeholder-[var(--mu)] focus:border-[var(--rd)]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tg-digest-interval" className="block text-xs font-semibold text-[var(--tx)]">
              Periodic Digest Interval (minutes)
            </label>
            <input
              id="tg-digest-interval"
              type="number"
              min={1}
              max={1440}
              value={digestIntervalMinutes}
              onChange={(e) => setDigestIntervalMinutes(parseInt(e.target.value, 10) || 1)}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-mono tabular-nums text-[var(--tx)] focus:border-[var(--rd)]"
            />
          </div>
        </div>

        <div className="divide-y divide-[var(--bd)] border-t border-b border-[var(--bd)]">
          {toggleItems.map((item) => (
            <label
              key={item.key}
              className="py-3 flex items-center justify-between gap-3 cursor-pointer min-h-[44px]"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--tx)]">{item.label}</div>
                <div className="text-[11px] text-[var(--mu)]">{item.description}</div>
              </div>
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) => item.onChange(e.target.checked)}
                className="w-5 h-5 accent-[var(--rd)] shrink-0 cursor-pointer"
              />
            </label>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingSettings}
            className="min-h-[44px] px-5 rounded-xl bg-[var(--rd)] text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Save className="w-4 h-4" strokeWidth={1.8} />
            <span>{savingSettings ? 'Saving...' : 'Save Telegram Settings'}</span>
          </button>
        </div>
      </form>

      {/* Write-Only Token Replace */}
      <form
        onSubmit={handleSaveToken}
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-3"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <div>
          <h3 className="text-sm font-bold text-[var(--tx)]">Replace Bot Token (Write-Only)</h3>
          <p className="text-xs text-[var(--mu)] mt-0.5">
            Stored server-side only and never returned by any API endpoint.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="password"
            autoComplete="new-password"
            aria-label="New Telegram Bot Token"
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            placeholder="Paste new bot token (write-only)"
            className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-mono text-[var(--tx)] placeholder-[var(--mu)] focus:border-[var(--rd)]"
          />
          <button
            type="submit"
            disabled={savingToken || !newToken.trim()}
            className="min-h-[44px] px-4 rounded-xl bg-[var(--rd)] text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-45 shrink-0"
          >
            {savingToken ? 'Saving...' : 'Save Token'}
          </button>
          {status?.hasDbToken && (
            <button
              type="button"
              onClick={() => setPendingAction({ type: 'clear-token' })}
              className="min-h-[44px] px-3.5 rounded-xl bg-[var(--sf-2)] hover:bg-[var(--rds)] border border-[var(--bd)] text-xs font-semibold text-[var(--rdt)] inline-flex items-center justify-center gap-1.5 shrink-0"
            >
              <Trash2 className="w-4 h-4" strokeWidth={1.8} />
              <span>Clear Saved</span>
            </button>
          )}
        </div>
      </form>

      {/* Test & Manual Broadcast (Rate-limited 1 per 10s, Confirm Required, Audit Logged) */}
      <section
        className="rounded-2xl bg-[var(--sf)] border border-[var(--bd)] p-4 sm:p-5 space-y-4"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <div>
          <h3 className="text-sm font-bold text-[var(--tx)]">Test & Manual Broadcast</h3>
          <p className="text-xs text-[var(--mu)] mt-0.5">
            Rate-limited to 1 send per 10 seconds per action. Every dispatch requires confirmation and is recorded in{' '}
            <code className="font-mono">admin_audit_log</code>.
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            disabled={!status?.configured || !chatId.trim() || sendingAction}
            onClick={() => setPendingAction({ type: 'test' })}
            className="min-h-[44px] px-4 rounded-xl bg-[var(--sf-2)] hover:bg-[var(--rds)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] hover:text-[var(--rdt)] transition-colors disabled:opacity-45 inline-flex items-center gap-2"
          >
            <Send className="w-4 h-4" strokeWidth={1.8} />
            <span>Send Test Message</span>
          </button>

          <button
            type="button"
            disabled={!status?.configured || !chatId.trim() || sendingAction}
            onClick={() => setPendingAction({ type: 'test-over' })}
            className="min-h-[44px] px-4 rounded-xl bg-[var(--sf-2)] hover:bg-[var(--blu)] border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] hover:text-[var(--blut)] transition-colors disabled:opacity-45 inline-flex items-center gap-2"
          >
            <Send className="w-4 h-4" strokeWidth={1.8} />
            <span>Send Test Over Alert</span>
          </button>
        </div>

        <div className="space-y-2 pt-2 border-t border-[var(--bd)]">
          <label htmlFor="tg-broadcast-text" className="block text-xs font-semibold text-[var(--tx)]">
            Custom Broadcast Message (HTML supported)
          </label>
          <textarea
            id="tg-broadcast-text"
            rows={4}
            maxLength={4000}
            value={broadcastText}
            onChange={(e) => setBroadcastText(e.target.value)}
            placeholder="Write a message to broadcast to the configured Telegram chat..."
            className="w-full p-3.5 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-xs text-[var(--tx)] placeholder-[var(--mu)] focus:border-[var(--rd)] resize-y"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--mu)] tabular-nums">
              {broadcastText.length} / 4000 characters
            </span>
            <button
              type="button"
              disabled={!status?.configured || !chatId.trim() || !broadcastText.trim() || sendingAction}
              onClick={() => setPendingAction({ type: 'broadcast', text: broadcastText.trim() })}
              className="min-h-[44px] px-4 rounded-xl bg-[var(--rd)] text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-45 inline-flex items-center gap-2"
            >
              <Send className="w-4 h-4" strokeWidth={1.8} />
              <span>Send Broadcast</span>
            </button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        isOpen={pendingAction !== null}
        title={
          pendingAction?.type === 'clear-token'
            ? 'Clear Admin-Saved Bot Token'
            : pendingAction?.type === 'broadcast'
            ? 'Confirm Telegram Broadcast'
            : pendingAction?.type === 'test-over'
            ? 'Confirm Test Over Alert'
            : 'Confirm Test Message'
        }
        description={
          pendingAction?.type === 'clear-token'
            ? 'Remove the bot token stored in PostgreSQL. If TELEGRAM_BOT_TOKEN is not set in .env, Telegram alerts will stop until a new token is provided.'
            : pendingAction?.type === 'broadcast'
            ? `Send this broadcast message to chat ${chatId || '(default)'}? This action will be recorded in admin_audit_log.`
            : `Send a test notification to chat ${chatId || '(default)'}? This action will be recorded in admin_audit_log.`
        }
        previewText={pendingAction?.type === 'broadcast' ? pendingAction.text : undefined}
        confirmLabel={pendingAction?.type === 'clear-token' ? 'Clear Token' : 'Send Now'}
        danger={pendingAction?.type === 'clear-token' || pendingAction?.type === 'broadcast'}
        busy={sendingAction}
        onConfirm={executeConfirmedAction}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
};
