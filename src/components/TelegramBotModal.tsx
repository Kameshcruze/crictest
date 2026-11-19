import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Send,
  CheckCircle2,
  AlertCircle,
  Check,
  Radio,
  Eye,
  EyeOff,
  Zap,
  Target,
  ExternalLink,
} from 'lucide-react';
import {
  TelegramConfig,
  testTelegramConnection,
  sendTelegramMessage,
  formatScoreboardDigest,
  testOverCompletionAlert,
} from '../services/telegramService';
import { ParsedCricketMatch } from '../types/cricket';
import { useModalFocusTrap } from './useModalFocusTrap';

interface TelegramBotModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: TelegramConfig;
  onSaveConfig: (config: TelegramConfig) => void;
  matches: ParsedCricketMatch[];
  initialSection?: 'credentials' | 'alerts';
}

export const TelegramBotModal: React.FC<TelegramBotModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  matches,
  initialSection = 'credentials',
}) => {
  const [botToken, setBotToken] = useState<string>(config.botToken || '8972166437:AAGjbREY_bCgJJ77wHTJKZWMwCndj3Pi6JQ');
  const [chatId, setChatId] = useState<string>(config.chatId || '-1003980667930');
  const [enabled, setEnabled] = useState<boolean>(config.enabled ?? false);
  const [notifyWickets, setNotifyWickets] = useState<boolean>(config.notifyWickets ?? false);
  const [notifyResults, setNotifyResults] = useState<boolean>(config.notifyResults ?? false);
  const [notifyOverCompletion, setNotifyOverCompletion] = useState<boolean>(config.notifyOverCompletion ?? false);
  const [notifyStrategyEntries, setNotifyStrategyEntries] = useState<boolean>(config.notifyStrategyEntries ?? false);
  const [notifyPeriodicDigest, setNotifyPeriodicDigest] = useState<boolean>(config.notifyPeriodicDigest ?? false);
  const [digestIntervalMinutes, setDigestIntervalMinutes] = useState<number>(config.digestIntervalMinutes || 3);

  const [showToken, setShowToken] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testStatus, setTestStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [isSendingManual, setIsSendingManual] = useState<boolean>(false);

  const alertsSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (config.botToken) setBotToken(config.botToken);
    if (config.chatId) setChatId(config.chatId);
    setEnabled(config.enabled ?? false);
    setNotifyWickets(config.notifyWickets ?? false);
    setNotifyResults(config.notifyResults ?? false);
    setNotifyOverCompletion(config.notifyOverCompletion ?? false);
    setNotifyStrategyEntries(config.notifyStrategyEntries ?? false);
    setNotifyPeriodicDigest(config.notifyPeriodicDigest ?? false);
  }, [config]);

  const dialogRef = useModalFocusTrap(isOpen, onClose);

  useEffect(() => {
    if (!isOpen) return;
    if (initialSection === 'alerts' && alertsSectionRef.current) {
      setTimeout(() => {
        alertsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    }
  }, [isOpen, initialSection]);

  if (!isOpen) return null;

  const handleSave = () => {
    const updated: TelegramConfig = {
      botToken: botToken.trim(),
      chatId: chatId.trim(),
      enabled,
      notifyWickets,
      notifyResults,
      notifyOverCompletion,
      notifyStrategyEntries,
      notifyBoundaries: false,
      notifyPeriodicDigest,
      digestIntervalMinutes,
    };
    onSaveConfig(updated);
    setTestStatus({ ok: true, message: 'Telegram settings saved successfully!' });
    setTimeout(() => setTestStatus(null), 3000);
  };

  const handleTestOverAlert = async () => {
    if (!botToken.trim() || !chatId.trim()) {
      setTestStatus({ ok: false, message: 'Please provide both Bot Token and Chat ID.' });
      return;
    }

    setIsTesting(true);
    setTestStatus(null);
    const liveMatch = matches.find((m) => m.status === 'live');
    const res = await testOverCompletionAlert(botToken, chatId, liveMatch);
    setIsTesting(false);

    if (res.ok) {
      setTestStatus({ ok: true, message: 'Sample over completion alert sent to Telegram successfully!' });
    } else {
      setTestStatus({ ok: false, message: `Failed to send over alert: ${res.error}` });
    }
  };

  const handleTestConnection = async () => {
    if (!botToken.trim() || !chatId.trim()) {
      setTestStatus({ ok: false, message: 'Please provide both Bot Token and Chat ID.' });
      return;
    }

    setIsTesting(true);
    setTestStatus(null);

    const result = await testTelegramConnection(botToken, chatId);
    setIsTesting(false);

    if (result.ok) {
      setTestStatus({
        ok: true,
        message: 'Success! Test message dispatched to your Telegram group.',
      });
      onSaveConfig({
        botToken: botToken.trim(),
        chatId: chatId.trim(),
        enabled,
        notifyWickets,
        notifyResults,
        notifyOverCompletion,
        notifyStrategyEntries,
        notifyBoundaries: false,
        notifyPeriodicDigest,
        digestIntervalMinutes,
      });
    } else {
      setTestStatus({
        ok: false,
        message: result.error || 'Failed to send message. Please verify Bot Token and Group ID.',
      });
    }
  };

  const handleSendLiveScoreboardNow = async () => {
    if (!botToken.trim() || !chatId.trim()) {
      setTestStatus({ ok: false, message: 'Configure Bot Token and Chat ID first.' });
      return;
    }

    setIsSendingManual(true);
    const text = formatScoreboardDigest(matches);
    const res = await sendTelegramMessage(botToken, chatId, text);
    setIsSendingManual(false);

    if (res.ok) {
      setTestStatus({ ok: true, message: 'Live scoreboard sent to Telegram group!' });
      setTimeout(() => setTestStatus(null), 4000);
    } else {
      setTestStatus({ ok: false, message: res.error || 'Failed to send scoreboard.' });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm"
      style={{ backgroundColor: 'var(--overlay)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative w-full max-w-2xl bg-[var(--sf)] border border-[var(--bd)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="telegram-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--bd)] bg-[var(--sf)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--rds)] border border-[var(--rd)]/30 flex items-center justify-center text-[var(--rdt)]">
              <Send className="w-4 h-4 -rotate-12" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="telegram-modal-title" className="text-base font-bold text-[var(--tx)]">
                  {initialSection === 'alerts' ? 'Telegram Alerts Configuration' : 'Telegram Integration'}
                </h2>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    enabled && botToken && chatId
                      ? 'bg-[var(--ok-bg)] text-[var(--ok-tx)] border-[var(--ok-bd)]'
                      : 'bg-[var(--sf-2)] text-[var(--mu)] border-[var(--bd)]'
                  }`}
                >
                  {enabled && botToken && chatId ? '● Broadcasting Active' : '○ Standby'}
                </span>
              </div>
              <p className="text-xs text-[var(--mu)]">
                Direct Telegram bot link & real-time live cricket broadcast alerts
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Telegram modal"
            className="p-1.5 rounded-lg text-[var(--mu)] hover:text-[var(--tx)] hover:bg-[var(--sf-2)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status notification banner */}
        {testStatus && (
          <div
            className={`mx-5 mt-4 p-3 rounded-xl border text-xs flex items-center justify-between gap-2 shrink-0 ${
              testStatus.ok
                ? 'bg-[var(--ok-bg)] border-[var(--ok-bd)] text-[var(--ok-tx)]'
                : 'bg-[var(--rds)] border-[var(--rd)]/40 text-[var(--rdt)]'
            }`}
          >
            <div className="flex items-center gap-2">
              {testStatus.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{testStatus.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setTestStatus(null)}
              className="text-[var(--mu)] hover:text-[var(--tx)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Modal Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Direct Telegram Link Card */}
          <div className="p-4 rounded-xl bg-[var(--blu)] border border-[var(--info-bd)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Send className="w-4 h-4 text-[var(--blut)]" />
                <span className="text-xs font-bold text-[var(--tx)] uppercase tracking-wider">
                  Telegram Bot
                </span>
                <span className="text-xs text-[var(--blut)] font-mono font-semibold">@my_cricket_tracker_bot</span>
              </div>
              <p className="text-xs text-[var(--mu)] mt-1">
                Open Telegram directly to view match updates and notifications.
              </p>
            </div>
            <a
              href="https://t.me/my_cricket_tracker_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[var(--rd)] hover:opacity-90 text-white text-xs font-semibold rounded-xl transition-opacity shrink-0"
            >
              <span>Open in Telegram</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Credentials Section */}
          <div className="bg-[var(--sf-2)] border border-[var(--bd)] rounded-xl p-4 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--tx)] flex items-center gap-2">
              <Send className="w-3.5 h-3.5 text-[var(--blut)]" />
              <span>Telegram Credentials</span>
            </h3>

            <div className="space-y-3">
              {/* Bot Token Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-[var(--tx)]">
                    Bot Token <span className="text-[var(--rdt)]">*</span>
                  </label>
                  <span className="text-[11px] text-[var(--mu)]">From @BotFather</span>
                </div>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder="e.g. 789123456:AAFlkXb123456..."
                    className="w-full bg-[var(--sf)] border border-[var(--bd)] rounded-lg px-3 py-2 text-xs text-[var(--tx)] placeholder-[var(--mu)] focus:border-[var(--rd)] pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    aria-label={showToken ? 'Hide token' : 'Show token'}
                    className="absolute right-2.5 top-2.5 text-[var(--mu)] hover:text-[var(--tx)]"
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Chat ID Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-[var(--tx)]">
                    Group Chat ID <span className="text-[var(--rdt)]">*</span>
                  </label>
                  <span className="text-[11px] text-[var(--mu)]">Prefix -100... for groups</span>
                </div>
                <input
                  type="text"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="e.g. -1001234567890 (for groups) or 12345678 (for private)"
                  className="w-full bg-[var(--sf)] border border-[var(--bd)] rounded-lg px-3 py-2 text-xs text-[var(--tx)] placeholder-[var(--mu)] focus:border-[var(--rd)] font-mono"
                />
              </div>
            </div>

            {/* Test & Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[var(--bd)]">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || !botToken.trim() || !chatId.trim()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[var(--blut)] hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none rounded-lg transition-opacity"
              >
                <Send className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                <span>{isTesting ? 'Testing Ping...' : 'Test Connection'}</span>
              </button>

              <button
                type="button"
                onClick={handleSendLiveScoreboardNow}
                disabled={isSendingManual || !botToken.trim() || !chatId.trim()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[var(--ok-tx)] bg-[var(--ok-bg)] border border-[var(--ok-bd)] hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none rounded-lg transition-opacity"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{isSendingManual ? 'Broadcasting...' : 'Send Live Scoreboard'}</span>
              </button>

              <button
                type="button"
                onClick={handleTestOverAlert}
                disabled={isTesting || !botToken.trim() || !chatId.trim()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[var(--warn-tx)] bg-[var(--warn-bg)] border border-[var(--warn-bd)] hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none rounded-lg transition-opacity"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Test Over Alert</span>
              </button>

              <button
                type="button"
                onClick={handleSave}
                className="ml-auto flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[var(--tx)] bg-[var(--sf)] hover:bg-[var(--rds)] border border-[var(--bd)] rounded-lg transition-colors"
              >
                <Check className="w-3.5 h-3.5 text-[var(--ok-tx)]" />
                <span>Save Settings</span>
              </button>
            </div>
          </div>

          {/* Automatic Broadcast Settings */}
          <div
            ref={alertsSectionRef}
            className={`bg-[var(--sf-2)] border rounded-xl p-4 space-y-4 ${
              initialSection === 'alerts' ? 'border-[var(--rd)] ring-1 ring-[var(--rd)]/25' : 'border-[var(--bd)]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--tx)] flex items-center gap-2">
                  <Radio className="w-3.5 h-3.5 text-[var(--ok-tx)]" />
                  <span>Live Broadcast Triggers</span>
                </h3>
                <p className="text-[11px] text-[var(--mu)] mt-0.5">
                  Choose which real-time match events to post automatically to Telegram
                </p>
              </div>

              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-[var(--bar)] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[var(--sf)] after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--rd)]"></div>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[var(--bd)]">
              {/* Strategy Entry Opportunities Alert */}
              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--ok-bg)] border border-[var(--ok-bd)] cursor-pointer sm:col-span-2">
                <input
                  type="checkbox"
                  checked={notifyStrategyEntries}
                  onChange={(e) => setNotifyStrategyEntries(e.target.checked)}
                  className="mt-0.5 rounded"
                />
                <div>
                  <div className="text-xs font-semibold text-[var(--ok-tx)] flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5" />
                    <span>Trading Strategy Entry Alerts (1st & 2nd Entry Signals)</span>
                  </div>
                  <p className="text-[11px] text-[var(--tx)] mt-0.5 opacity-90">
                    Broadcasts verified <b>First Entry</b> signals when BATTING control odds are <code>&gt;= 85 paise</code> (including deferred CONFIRMED_PENDING_85 entries) within window (1st Inn &lt; 10.0 ov, 2nd Inn &lt; 6.0 ov). Exits 1st entry at BATTING &lt;= 55p if no wicket fell, or unlocks <b>Second Entry</b> after confirmed wicket + BOWLING &lt; 65p (any over). Bookset exits when BOWLING &gt; 85 paise. Verified in DB to eliminate duplicates.
                  </p>
                </div>
              </label>

              {/* Over-by-Over Completion Alert */}
              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--warn-bg)] border border-[var(--warn-bd)] cursor-pointer sm:col-span-2">
                <input
                  type="checkbox"
                  checked={notifyOverCompletion}
                  onChange={(e) => setNotifyOverCompletion(e.target.checked)}
                  className="mt-0.5 rounded"
                />
                <div>
                  <div className="text-xs font-semibold text-[var(--warn-tx)] flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5" />
                    <span>Over-by-Over Live Completion Alerts</span>
                  </div>
                  <p className="text-[11px] text-[var(--tx)] mt-0.5 opacity-85">
                    Posts a dedicated scorecard message for each match after every completed over (e.g., Over 5, Over 6). Checks the local database before sending to strictly prevent duplicate posts.
                  </p>
                </div>
              </label>

              {/* Wickets Alert */}
              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--sf)] border border-[var(--bd)] cursor-pointer hover:border-[var(--mu)] transition-colors">
                <input
                  type="checkbox"
                  checked={notifyWickets}
                  onChange={(e) => setNotifyWickets(e.target.checked)}
                  className="mt-0.5 rounded"
                />
                <div>
                  <div className="text-xs font-semibold text-[var(--tx)]">Confirmed Wickets Alert</div>
                  <p className="text-[11px] text-[var(--mu)] mt-0.5">
                    Instant wicket notifications with batting team, score, and over number.
                  </p>
                </div>
              </label>

              {/* Match Results Alert */}
              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--sf)] border border-[var(--bd)] cursor-pointer hover:border-[var(--mu)] transition-colors">
                <input
                  type="checkbox"
                  checked={notifyResults}
                  onChange={(e) => setNotifyResults(e.target.checked)}
                  className="mt-0.5 rounded"
                />
                <div>
                  <div className="text-xs font-semibold text-[var(--tx)]">Final Match Results Alert</div>
                  <p className="text-[11px] text-[var(--mu)] mt-0.5">
                    Concluded match result messages with winner and final scores.
                  </p>
                </div>
              </label>

              {/* Periodic Scoreboard Digest */}
              <div className="sm:col-span-2 p-3 rounded-lg bg-[var(--sf)] border border-[var(--bd)] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifyPeriodicDigest}
                      onChange={(e) => setNotifyPeriodicDigest(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-xs font-semibold text-[var(--tx)]">Periodic Scoreboard Digest</span>
                  </label>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-[var(--mu)]">Every</span>
                    <select
                      aria-label="Digest interval"
                      value={digestIntervalMinutes}
                      onChange={(e) => setDigestIntervalMinutes(Number(e.target.value))}
                      disabled={!notifyPeriodicDigest}
                      className="bg-[var(--sf-2)] border border-[var(--bd)] text-xs text-[var(--tx)] rounded px-2 py-1 focus:border-[var(--rd)] disabled:opacity-50"
                    >
                      <option value={1}>1 min</option>
                      <option value={2}>2 min</option>
                      <option value={3}>3 min</option>
                      <option value={5}>5 min</option>
                      <option value={10}>10 min</option>
                      <option value={15}>15 min</option>
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-[var(--mu)]">
                  Sends an automated summary of all live matches at your selected interval.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--bd)] bg-[var(--sf)] shrink-0">
          <a
            href="https://t.me/my_cricket_tracker_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--blut)] hover:underline flex items-center gap-1 font-medium"
          >
            <span>Open @my_cricket_tracker_bot</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-[var(--tx)] bg-[var(--sf-2)] hover:bg-[var(--rds)] border border-[var(--bd)] rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
