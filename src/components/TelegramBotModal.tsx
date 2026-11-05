import React, { useState } from 'react';
import {
  X,
  Send,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Flame,
  Clock,
  Radio,
  Eye,
  EyeOff,
  Settings,
  Zap,
  Target,
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
  const [activeTab, setActiveTab] = useState<'always-on' | 'control'>('always-on');
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
  const [isTestingCron, setIsTestingCron] = useState<boolean>(false);
  const [testStatus, setTestStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [isSendingManual, setIsSendingManual] = useState<boolean>(false);
  const [copiedScript, setCopiedScript] = useState<string | null>(null);

  const originUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const cronWebhookUrl = `${originUrl}/api/cron`;

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
      // Auto-save verified credentials
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

  const handleTestCron = async () => {
    setIsTestingCron(true);
    setTestStatus(null);
    try {
      const res = await fetch('/api/cron');
      const data = await res.json();
      if (data.ok) {
        setTestStatus({
          ok: true,
          message: `Cron webhook triggered successfully! Live matches: ${data.liveMatchesCount}. Broadcast sent to Telegram group!`,
        });
      } else {
        setTestStatus({ ok: false, message: data.error || 'Cron execution failed.' });
      }
    } catch (err: any) {
      setTestStatus({ ok: false, message: err.message });
    } finally {
      setIsTestingCron(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedScript(id);
    setTimeout(() => setCopiedScript(null), 2000);
  };

  const cloudflareWorkerScript = `/**
 * 24/7 Cloudflare Worker Crex Live Cricket Telegram Bot
 * Runs 100% Free on Cloudflare's Global Network (No computer or browser needed)
 * 100,000 free requests/day & unlimited Cron Triggers
 */

const BOT_TOKEN = "${botToken || '8972166437:AAGjbREY_bCgJJ77wHTJKZWMwCndj3Pi6JQ'}";
const CHAT_ID = "${chatId || '-1003980667930'}";

export default {
  // 1. Cron Trigger (runs every minute even with no users)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAndBroadcast());
  },

  // 2. HTTP Fetch trigger (for testing)
  async fetch(request, env, ctx) {
    await checkAndBroadcast();
    return new Response("Cron executed successfully", { status: 200 });
  }
};

async function checkAndBroadcast() {
  try {
    const now = Date.now();
    const res = await fetch("https://api.goscorer.com/api/v2/getTopMatches?_t=" + now, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cc: "IN", _t: now })
    });

    if (!res.ok) return;
    const matches = await res.json();
    const live = Object.entries(matches).filter(([_, m]) => (m.j || m.k) && !m.finishTime);

    if (live.length > 0) {
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      let text = "🏏 <b>CREX LIVE CRICKET 24/7 DIGEST</b> · <i>" + timeStr + "</i>\\n";
      text += "🔥 <b>" + live.length + " Live Matches in Progress</b>\\n───────────────────\\n\\n";

      live.forEach(([_, m], i) => {
        const t1 = m.t1Sname || m.b || "Team 1";
        const t2 = m.t2Sname || m.c || "Team 2";
        text += "<b>" + (i + 1) + ". " + t1 + " vs " + t2 + "</b> (" + (m.fo || "Match") + ")\\n";
        text += "   • <b>" + t1 + "</b>: " + (m.j || "Yet to bat") + "\\n";
        text += "   • <b>" + t2 + "</b>: " + (m.k || "Yet to bat") + "\\n";
        if (m.res || m.soResult) text += "   • <i>" + (m.res || m.soResult) + "</i>\\n";
        text += "\\n";
      });

      text += "───────────────────\\n⚡ <i>Cloudflare 24/7 Edge Bot</i>";

      await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: text,
          parse_mode: "HTML",
          disable_web_page_preview: true
        })
      });
    }
  } catch (err) {
    console.error("Worker error:", err);
  }
}
`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Send className="w-5 h-5 -rotate-12" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Telegram Bot Broadcaster</h2>
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
                Send real-time cricket scores, wicket alerts & digests directly to your Telegram group
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

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-slate-800 px-5 bg-slate-950/40 shrink-0 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('always-on')}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'always-on'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span className="font-bold text-emerald-300">24/7 Always-On (No Website Needed)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('control')}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'control'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Bot Controller & Alerts</span>
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
        <div className="p-5 overflow-y-auto space-y-6">
          {activeTab === 'always-on' && (
            <div className="space-y-6">
              {/* Webhook Endpoint */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                {/* Webhook URL Input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">
                    Your Live 24/7 Webhook Cron URL:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={cronWebhookUrl}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-emerald-400 font-mono focus:outline-none select-all"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(cronWebhookUrl, 'webhook-url')}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors shrink-0"
                    >
                      {copiedScript === 'webhook-url' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedScript === 'webhook-url' ? 'Copied!' : 'Copy URL'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleTestCron}
                      disabled={isTestingCron}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg transition-colors shrink-0 shadow-sm"
                    >
                      <Zap className={`w-3.5 h-3.5 ${isTestingCron ? 'animate-spin' : ''}`} />
                      <span>{isTestingCron ? 'Triggering...' : 'Test /api/cron Now'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Method 2: Free 24/7 Cloudflare Worker */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center">
                      2
                    </span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                      Method 2: Standalone Cloudflare Worker (Runs on Cloudflare Edge)
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(cloudflareWorkerScript, 'cf-worker')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-300 bg-blue-950/60 hover:bg-blue-900/60 border border-blue-800/60 rounded-lg transition-colors"
                  >
                    {copiedScript === 'cf-worker' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedScript === 'cf-worker' ? 'Copied Code' : 'Copy Worker Code'}</span>
                  </button>
                </div>

                <p className="text-xs text-slate-400">
                  Deploy this lightweight script to a free Cloudflare Worker. It runs directly on Cloudflare with a 1-minute Cron Trigger, completely independent of any server or browser.
                </p>

                <pre className="p-3 bg-slate-950 text-slate-300 text-[11px] font-mono rounded-lg border border-slate-800 overflow-x-auto max-h-48">
                  {cloudflareWorkerScript}
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'control' && (
            <div className="space-y-6">
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
                    <p className="text-[11px] text-slate-500 mt-1">
                      Generated from @BotFather on Telegram (starts with numbers followed by colon).
                    </p>
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
                    <p className="text-[11px] text-slate-500 mt-1">
                      Telegram group IDs always start with a negative prefix (e.g. <code>-100...</code>).
                    </p>
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
                  {/* Strategy Entry Opportunities Alert (First & Second Entry) */}
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

                  {/* Over-by-Over Completion Alert (Verified in DB) */}
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
                        <span>⚡ Over-by-Over Live Completion Alerts (Separate Match Updates)</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Posts a dedicated scorecard message for each match after every completed over (e.g., Over 5, Over 6). Checks the Supabase database before sending to strictly prevent duplicate posts.
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
                      <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5 text-rose-400" />
                        <span>🚨 Instant Wicket Alerts</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Posts a notification to group the moment a wicket falls.
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
                      <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>🏆 Match Conclusion Alerts</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Posts final scorecard and winner when a match completes.
                      </p>
                    </div>
                  </label>

                  {/* Periodic Digest */}
                  <div className="sm:col-span-2 p-3 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={notifyPeriodicDigest}
                          onChange={(e) => setNotifyPeriodicDigest(e.target.checked)}
                          className="rounded text-blue-600 focus:ring-0 bg-slate-800 border-slate-700"
                        />
                        <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-blue-400" />
                          <span>📊 Periodic Full Scoreboard Digest</span>
                        </div>
                      </label>

                      {notifyPeriodicDigest && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-slate-400">Every:</span>
                          <select
                            value={digestIntervalMinutes}
                            onChange={(e) => setDigestIntervalMinutes(Number(e.target.value))}
                            className="bg-slate-800 text-xs text-white border border-slate-700 rounded px-2 py-1 focus:outline-none"
                          >
                            <option value={1}>1 Minute</option>
                            <option value={2}>2 Minutes</option>
                            <option value={5}>5 Minutes</option>
                            <option value={10}>10 Minutes</option>
                            <option value={15}>15 Minutes</option>
                          </select>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Dispatches a formatted summary table of all live matches to the group periodically.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between text-xs shrink-0">
          <span className="text-slate-500">
            {enabled ? '🟢 Telegram broadcast active' : '⚪ Broadcasting paused'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
