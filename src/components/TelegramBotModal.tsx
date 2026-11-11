import React, { useState } from 'react';
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

interface TelegramBotModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: TelegramConfig;
  onSaveConfig: (config: TelegramConfig) => void;
  matches: ParsedCricketMatch[];
}

export const TelegramBotModal: React.FC<TelegramBotModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  matches,
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

  React.useEffect(() => {
    if (config.botToken) setBotToken(config.botToken);
    if (config.chatId) setChatId(config.chatId);
    setEnabled(config.enabled ?? false);
    setNotifyWickets(config.notifyWickets ?? false);
    setNotifyResults(config.notifyResults ?? false);
    setNotifyOverCompletion(config.notifyOverCompletion ?? false);
    setNotifyStrategyEntries(config.notifyStrategyEntries ?? false);
    setNotifyPeriodicDigest(config.notifyPeriodicDigest ?? false);
  }, [config]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Send className="w-5 h-5 -rotate-12" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Telegram Integration</h2>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    enabled && botToken && chatId
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {enabled && botToken && chatId ? '● Broadcasting Active' : '○ Standby'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Direct Telegram bot link & real-time live cricket broadcast alerts
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status notification banner */}
        {testStatus && (
          <div
            className={`mx-5 mt-4 p-3 rounded-xl border text-xs flex items-center justify-between gap-2 shrink-0 ${
              testStatus.ok
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {testStatus.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{testStatus.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setTestStatus(null)}
              className="text-slate-400 hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Modal Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Direct Telegram Link Card */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-blue-950/50 to-slate-900 border border-blue-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Telegram Bot
                </span>
                <span className="text-xs text-blue-300 font-mono">@my_cricket_tracker_bot</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Open Telegram directly to view match updates and notifications.
              </p>
            </div>
            <a
              href="https://t.me/my_cricket_tracker_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-sm shadow-blue-900/40 transition-colors shrink-0"
            >
              <span>Open in Telegram</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Credentials Section */}
          <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Send className="w-3.5 h-3.5 text-blue-400" />
              <span>Telegram Credentials</span>
            </h3>

            <div className="space-y-3">
              {/* Bot Token Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-300">
                    Bot Token <span className="text-rose-400">*</span>
                  </label>
                  <span className="text-[11px] text-slate-400">From @BotFather</span>
                </div>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder="e.g. 789123456:AAFlkXb123456..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200"
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Chat ID Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-300">
                    Group Chat ID <span className="text-rose-400">*</span>
                  </label>
                  <span className="text-[11px] text-slate-400">Prefix -100... for groups</span>
                </div>
                <input
                  type="text"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="e.g. -1001234567890 (for groups) or 12345678 (for private)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>
            </div>

            {/* Test & Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || !botToken.trim() || !chatId.trim()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:pointer-events-none rounded-lg transition-colors"
              >
                <Send className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                <span>{isTesting ? 'Testing Ping...' : 'Test Connection'}</span>
              </button>

              <button
                type="button"
                onClick={handleSendLiveScoreboardNow}
                disabled={isSendingManual || !botToken.trim() || !chatId.trim()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-800/60 disabled:opacity-50 disabled:pointer-events-none rounded-lg transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isSendingManual ? 'Broadcasting...' : 'Send Live Scoreboard'}</span>
              </button>

              <button
                type="button"
                onClick={handleTestOverAlert}
                disabled={isTesting || !botToken.trim() || !chatId.trim()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-amber-300 bg-amber-950/60 hover:bg-amber-900/60 border border-amber-800/60 disabled:opacity-50 disabled:pointer-events-none rounded-lg transition-colors"
              >
                <Radio className="w-3.5 h-3.5 text-amber-400" />
                <span>Test Over Alert</span>
              </button>

              <button
                type="button"
                onClick={handleSave}
                className="ml-auto flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
              >
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Save Settings</span>
              </button>
            </div>
          </div>

          {/* Automatic Broadcast Settings */}
          <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Radio className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Live Broadcast Triggers</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
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
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800">
              {/* Strategy Entry Opportunities Alert */}
              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/40 cursor-pointer hover:border-emerald-500/70 transition-colors sm:col-span-2">
                <input
                  type="checkbox"
                  checked={notifyStrategyEntries}
                  onChange={(e) => setNotifyStrategyEntries(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-500 focus:ring-0 bg-slate-800 border-slate-700"
                />
                <div>
                  <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-emerald-400" />
                    <span>🎯 Trading Strategy Entry Alerts (1st & 2nd Entry Signals)</span>
                  </div>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    Broadcasts verified <b>First Entry</b> signals when odds hit <code>[1.85, 2.00]</code> within window (1st Inn &le; 10.0 ov, 2nd Inn &le; 6.0 ov). Strictly requires First Entry before <b>Second Entry</b> alerts can ever be sent (after confirmed wicket + opposing odds &lt; 1.65). Verified in DB to eliminate duplicates.
                  </p>
                </div>
              </label>

              {/* Over-by-Over Completion Alert */}
              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-900/70 border border-amber-500/30 cursor-pointer hover:border-amber-500/60 transition-colors sm:col-span-2">
                <input
                  type="checkbox"
                  checked={notifyOverCompletion}
                  onChange={(e) => setNotifyOverCompletion(e.target.checked)}
                  className="mt-0.5 rounded text-amber-500 focus:ring-0 bg-slate-800 border-slate-700"
                />
                <div>
                  <div className="text-xs font-semibold text-amber-200 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-amber-400" />
                    <span>⚡ Over-by-Over Live Completion Alerts</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Posts a dedicated scorecard message for each match after every completed over (e.g., Over 5, Over 6). Checks the local database before sending to strictly prevent duplicate posts.
                  </p>
                </div>
              </label>

              {/* Wickets Alert */}
              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-900/60 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                <input
                  type="checkbox"
                  checked={notifyWickets}
                  onChange={(e) => setNotifyWickets(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600 focus:ring-0 bg-slate-800 border-slate-700"
                />
                <div>
                  <div className="text-xs font-semibold text-white">Confirmed Wickets Alert</div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Instant wicket notifications with batting team, score, and over number.
                  </p>
                </div>
              </label>

              {/* Match Results Alert */}
              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-900/60 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                <input
                  type="checkbox"
                  checked={notifyResults}
                  onChange={(e) => setNotifyResults(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600 focus:ring-0 bg-slate-800 border-slate-700"
                />
                <div>
                  <div className="text-xs font-semibold text-white">Final Match Results Alert</div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Concluded match result messages with winner and final scores.
                  </p>
                </div>
              </label>

              {/* Periodic Scoreboard Digest */}
              <div className="sm:col-span-2 p-3 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifyPeriodicDigest}
                      onChange={(e) => setNotifyPeriodicDigest(e.target.checked)}
                      className="rounded text-blue-600 focus:ring-0 bg-slate-800 border-slate-700"
                    />
                    <span className="text-xs font-semibold text-white">Periodic Scoreboard Digest</span>
                  </label>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400">Every</span>
                    <select
                      value={digestIntervalMinutes}
                      onChange={(e) => setDigestIntervalMinutes(Number(e.target.value))}
                      disabled={!notifyPeriodicDigest}
                      className="bg-slate-800 border border-slate-700 text-xs text-white rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
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
                <p className="text-[11px] text-slate-400">
                  Sends an automated summary of all live matches at your selected interval.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800 bg-slate-950/60 shrink-0">
          <a
            href="https://t.me/my_cricket_tracker_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            <span>Open @my_cricket_tracker_bot</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
