import React, { useState } from 'react';
import {
  X,
  Send,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ShieldAlert,
  Flame,
  Clock,
  Radio,
  Eye,
  EyeOff,
  ExternalLink,
  Code2,
  BookOpen,
  Settings,
  HelpCircle,
  Zap,
} from 'lucide-react';
import {
  TelegramConfig,
  testTelegramConnection,
  sendTelegramMessage,
  formatScoreboardDigest,
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
  const [activeTab, setActiveTab] = useState<'control' | 'guide' | 'scripts'>('control');
  const [botToken, setBotToken] = useState<string>(config.botToken || '8972166437:AAGjbREY_bCgJJ77wHTJKZWMwCndj3Pi6JQ');
  const [chatId, setChatId] = useState<string>(config.chatId || '-1003980667930');
  const [enabled, setEnabled] = useState<boolean>(config.enabled ?? true);
  const [notifyWickets, setNotifyWickets] = useState<boolean>(config.notifyWickets ?? true);
  const [notifyResults, setNotifyResults] = useState<boolean>(config.notifyResults ?? true);
  const [notifyPeriodicDigest, setNotifyPeriodicDigest] = useState<boolean>(config.notifyPeriodicDigest ?? true);
  const [digestIntervalMinutes, setDigestIntervalMinutes] = useState<number>(config.digestIntervalMinutes || 3);

  const [showToken, setShowToken] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testStatus, setTestStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [isSendingManual, setIsSendingManual] = useState<boolean>(false);
  const [copiedScript, setCopiedScript] = useState<string | null>(null);

  React.useEffect(() => {
    if (config.botToken) setBotToken(config.botToken);
    if (config.chatId) setChatId(config.chatId);
    setEnabled(config.enabled ?? true);
  }, [config]);

  if (!isOpen) return null;

  const handleSave = () => {
    const updated: TelegramConfig = {
      botToken: botToken.trim(),
      chatId: chatId.trim(),
      enabled,
      notifyWickets,
      notifyResults,
      notifyBoundaries: false,
      notifyPeriodicDigest,
      digestIntervalMinutes,
    };
    onSaveConfig(updated);
    setTestStatus({ ok: true, message: 'Telegram settings saved successfully!' });
    setTimeout(() => setTestStatus(null), 3000);
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

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedScript(id);
    setTimeout(() => setCopiedScript(null), 2000);
  };

  const pythonScript = `#!/usr/bin/env python3
"""
24/7 Crex Live Cricket Score Telegram Bot
Run on VPS / Railway / Render / Local PC:
pip install requests
python telegram_cricket_bot.py
"""

import time
import requests

BOT_TOKEN = "${botToken || 'YOUR_TELEGRAM_BOT_TOKEN'}"
CHAT_ID = "${chatId || 'YOUR_TELEGRAM_CHAT_ID'}"
API_URL = "https://api.goscorer.com/api/v2/getTopMatches"

last_scores = {}

def send_telegram(text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": CHAT_ID,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }
    try:
        r = requests.post(url, json=payload, timeout=8)
        return r.json().get("ok", False)
    except Exception as e:
        print(f"Error sending message: {e}")
        return False

def check_live_cricket():
    global last_scores
    try:
        t = int(time.time() * 1000)
        res = requests.post(
            f"{API_URL}?_t={t}",
            json={"cc": "IN", "_t": t},
            headers={"Content-Type": "application/json", "Cache-Control": "no-cache"},
            timeout=5
        )
        if not res.ok:
            return

        data = res.json()
        for match_id, m in data.items():
            team1 = m.get("t1Sname") or m.get("b") or "Team1"
            team2 = m.get("t2Sname") or m.get("c") or "Team2"
            score1 = m.get("j", "")
            score2 = m.get("k", "")
            status_text = m.get("res") or m.get("soResult") or m.get("a") or "Live"

            current_sig = f"{score1}-{score2}-{status_text}"
            prev_sig = last_scores.get(match_id)

            if prev_sig and prev_sig != current_sig:
                # Score changed!
                msg = (
                    f"🏏 <b>{team1} vs {team2}</b>\\n"
                    f"📊 Score: {score1 or 'Yet to bat'} | {score2 or 'Yet to bat'}\\n"
                    f"⚡ {status_text}"
                )
                print(f"Broadcasting update for {team1} vs {team2}")
                send_telegram(msg)

            last_scores[match_id] = current_sig
    except Exception as err:
        print(f"Sync error: {err}")

if __name__ == "__main__":
    print(f"Starting 24/7 Cricket Telegram Bot to chat {CHAT_ID}...")
    send_telegram("🚀 <b>24/7 Crex Cricket Telegram Bot Started!</b>")
    while True:
        check_live_cricket()
        time.sleep(2) # Checks every 2 seconds
`;

  const nodeScript = `// 24/7 Crex Cricket Telegram Bot (Node.js)
// Run with: node bot.js
const BOT_TOKEN = "${botToken || 'YOUR_TELEGRAM_BOT_TOKEN'}";
const CHAT_ID = "${chatId || 'YOUR_TELEGRAM_CHAT_ID'}";

let lastScores = {};

async function sendTelegram(text) {
  try {
    const res = await fetch(\`https://api.telegram.org/bot\${BOT_TOKEN}/sendMessage\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
    return res.ok;
  } catch (e) {
    console.error("Telegram send error:", e.message);
  }
}

async function pollMatches() {
  try {
    const now = Date.now();
    const res = await fetch(\`https://api.goscorer.com/api/v2/getTopMatches?_t=\${now}\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cc: "IN", _t: now })
    });
    if (!res.ok) return;

    const matches = await res.json();
    for (const [id, m] of Object.entries(matches)) {
      const sig = \`\${m.j || ''}-\${m.k || ''}-\${m.res || ''}\`;
      if (lastScores[id] && lastScores[id] !== sig && (m.j || m.k)) {
        const msg = \`🏏 <b>Live Cricket Update</b>\\n🔹 <b>Score:</b> \${m.j || '—'} | \${m.k || '—'}\\n⚡ <i>\${m.res || m.soResult || 'Live'}</i>\`;
        await sendTelegram(msg);
      }
      lastScores[id] = sig;
    }
  } catch (err) {
    console.error("Poll error:", err.message);
  }
}

console.log("Crex Telegram Bot running every 2 seconds...");
setInterval(pollMatches, 2000);
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
        <div className="flex items-center border-b border-slate-800 px-5 bg-slate-950/40 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('control')}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'control'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Bot Controller & Alerts</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('guide')}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'guide'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Step-by-Step Setup Guide</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scripts')}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'scripts'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>24/7 Server Scripts</span>
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
                      <button
                        type="button"
                        onClick={() => setActiveTab('guide')}
                        className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      >
                        <HelpCircle className="w-3 h-3" />
                        <span>How to get Bot Token?</span>
                      </button>
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
                      <button
                        type="button"
                        onClick={() => setActiveTab('guide')}
                        className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      >
                        <HelpCircle className="w-3 h-3" />
                        <span>How to get Group ID?</span>
                      </button>
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
                    <span>{isSendingManual ? 'Broadcasting...' : 'Send Live Scoreboard Now'}</span>
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

          {activeTab === 'guide' && (
            <div className="space-y-4 text-xs text-slate-300">
              <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-500/30 text-blue-200">
                <p className="font-semibold text-sm mb-1 text-blue-100">
                  How to Connect Telegram Bot to your Group (5 Minutes)
                </p>
                <p className="text-xs text-blue-300/90 leading-relaxed">
                  Follow these simple steps on your Telegram app. You will get a Bot Token from Telegram&apos;s official <code>@BotFather</code> and your group&apos;s Chat ID.
                </p>
              </div>

              {/* Step 1 */}
              <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center">
                    1
                  </span>
                  <h4 className="font-bold text-slate-200">Create the Bot with @BotFather</h4>
                </div>
                <div className="pl-7 space-y-1 text-slate-400">
                  <p>• In Telegram search bar, search for <b>@BotFather</b> (with verified blue tick).</p>
                  <p>• Start the chat and send: <code className="text-emerald-400 bg-slate-900 px-1.5 py-0.5 rounded">/newbot</code></p>
                  <p>• Enter a display name for your bot (e.g. <i>Crex Live Scorer</i>).</p>
                  <p>• Enter a username ending in &quot;bot&quot; (e.g. <i>my_cricket_live_bot</i>).</p>
                  <p>• BotFather will reply with your <b>HTTP API Token</b> (looks like: <code>789123456:AAFlkXb12...</code>). Copy this token!</p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center">
                    2
                  </span>
                  <h4 className="font-bold text-slate-200">Add the Bot to your Telegram Group</h4>
                </div>
                <div className="pl-7 space-y-1 text-slate-400">
                  <p>• Open or create the Telegram group where you want scores sent.</p>
                  <p>• Tap Group Name &gt; <b>Add Members</b> &gt; search for your bot&apos;s username &gt; add it.</p>
                  <p>• <b>Important:</b> Promote your bot to <b>Admin</b> (or enable &quot;Send Messages&quot; permission) so it has rights to broadcast.</p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center">
                    3
                  </span>
                  <h4 className="font-bold text-slate-200">Get your Group&apos;s Chat ID</h4>
                </div>
                <div className="pl-7 space-y-2 text-slate-400">
                  <p>Telegram groups have a unique numeric ID starting with <code className="text-amber-400 bg-slate-900 px-1 py-0.5 rounded">-100...</code>. Here are two quick ways to get it:</p>
                  
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <p className="font-semibold text-slate-200">Method A (Fastest - 30 seconds):</p>
                    <p>1. Add <b>@RawDataBot</b> to your group.</p>
                    <p>2. It will post a JSON message. Look for <code className="text-emerald-400">&quot;chat&quot;: &#123; &quot;id&quot;: -100xxxxxxxxxx &#125;</code>.</p>
                    <p>3. Copy that number (including the minus sign) and remove @RawDataBot.</p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <p className="font-semibold text-slate-200">Method B (Via Web Browser):</p>
                    <p>1. Send any test message like &quot;hello&quot; in the group.</p>
                    <p>2. In your browser, open: <br/><code className="text-blue-400 break-all">https://api.telegram.org/bot&lt;YOUR_BOT_TOKEN&gt;/getUpdates</code></p>
                    <p>3. Search for <code className="text-emerald-400">&quot;chat&quot;:&#123;&quot;id&quot;:-100...</code> and copy that number.</p>
                  </div>
                </div>
              </div>

              {/* Step 4 */}
              <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center">
                    4
                  </span>
                  <h4 className="font-bold text-slate-200">Paste Credentials & Click &quot;Test Connection&quot;</h4>
                </div>
                <div className="pl-7 space-y-1 text-slate-400">
                  <p>• Switch back to the <b>Bot Controller</b> tab above.</p>
                  <p>• Paste your <b>Bot Token</b> and <b>Group Chat ID</b>.</p>
                  <p>• Click <b>Test Connection</b>. You will immediately see a test message appear in your Telegram group!</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'scripts' && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800 text-xs text-slate-400">
                <p className="font-semibold text-slate-200 mb-1">
                  Run 24/7 in the Cloud (Without keeping browser open)
                </p>
                <p>
                  You can deploy these standalone scripts on any free server (Railway, Render, VPS, or local machine) so that matches are checked and broadcasted to Telegram around the clock.
                </p>
              </div>

              {/* Python Script */}
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-slate-950 border-b border-slate-800 text-xs">
                  <span className="font-bold text-slate-300">Python 24/7 Bot (telegram_cricket_bot.py)</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(pythonScript, 'python')}
                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                  >
                    {copiedScript === 'python' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedScript === 'python' ? 'Copied' : 'Copy Python Script'}</span>
                  </button>
                </div>
                <pre className="p-3 bg-slate-950/90 text-slate-300 text-[11px] font-mono overflow-x-auto max-h-56">
                  {pythonScript}
                </pre>
              </div>

              {/* Node.js Script */}
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-slate-950 border-b border-slate-800 text-xs">
                  <span className="font-bold text-slate-300">Node.js Bot (telegram_bot.js)</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(nodeScript, 'node')}
                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                  >
                    {copiedScript === 'node' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedScript === 'node' ? 'Copied' : 'Copy Node Script'}</span>
                  </button>
                </div>
                <pre className="p-3 bg-slate-950/90 text-slate-300 text-[11px] font-mono overflow-x-auto max-h-56">
                  {nodeScript}
                </pre>
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
