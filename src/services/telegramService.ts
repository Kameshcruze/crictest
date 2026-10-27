import { ParsedCricketMatch } from '../types/cricket';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  notifyWickets: boolean;
  notifyResults: boolean;
  notifyBoundaries: boolean;
  notifyPeriodicDigest: boolean;
  digestIntervalMinutes: number;
}

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  botToken: '8972166437:AAGjbREY_bCgJJ77wHTJKZWMwCndj3Pi6JQ',
  chatId: '-1003980667930',
  enabled: true,
  notifyWickets: true,
  notifyResults: true,
  notifyBoundaries: false,
  notifyPeriodicDigest: true,
  digestIntervalMinutes: 3,
};

const STORAGE_KEY = 'crex_telegram_bot_config_v2';

export function getStoredTelegramConfig(): TelegramConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TELEGRAM_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_TELEGRAM_CONFIG,
      ...parsed,
      botToken: parsed.botToken || DEFAULT_TELEGRAM_CONFIG.botToken,
      chatId: parsed.chatId || DEFAULT_TELEGRAM_CONFIG.chatId,
    };
  } catch {
    return DEFAULT_TELEGRAM_CONFIG;
  }
}

export function saveStoredTelegramConfig(config: TelegramConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // LocalStorage write error fallback
  }
}

/**
 * Dispatch an HTML-formatted message to Telegram group / chat
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  htmlText: string
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  if (!botToken.trim() || !chatId.trim()) {
    return { ok: false, error: 'Bot Token and Chat ID are required' };
  }

  const cleanToken = botToken.trim().replace(/^bot/i, '');
  const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;

  const payload = {
    chat_id: chatId.trim(),
    text: htmlText,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  try {
    // 1. Direct browser fetch to Telegram Bot API
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (data.ok) {
      return { ok: true, messageId: data.result?.message_id };
    }

    return {
      ok: false,
      error: data.description || 'Telegram API rejected message',
    };
  } catch (err: unknown) {
    // 2. Fallback to server-side proxy endpoint (/api/telegram/send) if browser blocked
    try {
      const proxyRes = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: cleanToken,
          chatId: chatId.trim(),
          text: htmlText,
        }),
      });
      const proxyData = await proxyRes.json();
      if (proxyData.ok) {
        return { ok: true, messageId: proxyData.result?.message_id };
      }
      return { ok: false, error: proxyData.error || proxyData.description || 'Server proxy failed' };
    } catch {
      const errMsg = err instanceof Error ? err.message : 'Network error reaching Telegram API';
      return { ok: false, error: errMsg };
    }
  }
}

/**
 * Test connectivity with Telegram Bot by sending a test message
 */
export async function testTelegramConnection(
  botToken: string,
  chatId: string
): Promise<{ ok: boolean; error?: string }> {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const message = `🏏 <b>Crex Live Cricket Scorer Connected!</b>\n\n` +
    `✅ Your Telegram bot is linked successfully to the live cricket feed.\n` +
    `⏰ <i>Connected at ${timestamp}</i>\n` +
    `📢 Real-time updates and live scoreboards will be broadcasted here automatically.`;

  return sendTelegramMessage(botToken, chatId, message);
}

/**
 * Formats a single live match into a rich HTML Telegram post
 */
export function formatSingleMatchHtml(m: ParsedCricketMatch): string {
  const t1 = m.team1;
  const t2 = m.team2;
  const s1 = m.team1Score
    ? `${m.team1Score.runs}/${m.team1Score.wickets} (${m.team1Score.overs} ov)`
    : 'Yet to bat';
  const s2 = m.team2Score
    ? `${m.team2Score.runs}/${m.team2Score.wickets} (${m.team2Score.overs} ov)`
    : 'Yet to bat';

  const t1Batting = m.battingTeamKey === t1.key && m.status === 'live' ? ' 🏏' : '';
  const t2Batting = m.battingTeamKey === t2.key && m.status === 'live' ? ' 🏏' : '';

  let equation = m.resultText || m.statusLabel || '';
  if (m.target && m.team2Score && m.status === 'live') {
    const needed = Math.max(0, m.target - m.team2Score.runs);
    equation = `${needed} runs needed`;
  }

  let text = `🏏 <b>${t1.shortName} vs ${t2.shortName}</b> · <i>${m.format}</i>\n`;
  if (m.seriesName) text += `🏆 <code>${m.seriesName}</code>\n`;
  if (m.venueName) text += `📍 <code>${m.venueName}</code>\n\n`;

  text += `🔹 <b>${t1.shortName}</b>: <b>${s1}</b>${t1Batting}\n`;
  text += `🔹 <b>${t2.shortName}</b>: <b>${s2}</b>${t2Batting}\n\n`;

  if (equation) text += `⚡ <b>Status</b>: ${equation}\n`;
  if (m.currentRunRate) text += `📊 <b>CRR</b>: ${m.currentRunRate}`;
  if (m.requiredRunRate) text += ` | <b>RRR</b>: ${m.requiredRunRate}`;
  if (m.currentRunRate || m.requiredRunRate) text += `\n`;

  if (m.winProbability) {
    text += `🎲 <b>Win Prob</b>: ${t1.shortName} ${m.winProbability.team1Prob}% | ${t2.shortName} ${m.winProbability.team2Prob}%\n`;
  }

  return text;
}

/**
 * Formats a live scoreboard digest of all active matches
 */
export function formatScoreboardDigest(matches: ParsedCricketMatch[]): string {
  const liveMatches = matches.filter((m) => m.status === 'live');
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (liveMatches.length === 0) {
    return `🏏 <b>Crex Live Cricket Scorer · Update (${now})</b>\n\n<i>No matches currently live. Check upcoming fixtures.</i>`;
  }

  let text = `🏏 <b>CREX LIVE CRICKET DIGEST</b> · <i>${now}</i>\n`;
  text += `🔥 <b>${liveMatches.length} Live Matches in Progress</b>\n`;
  text += `───────────────────\n\n`;

  liveMatches.forEach((m, idx) => {
    const s1 = m.team1Score
      ? `${m.team1Score.runs}/${m.team1Score.wickets} (${m.team1Score.overs} ov)`
      : 'Yet to bat';
    const s2 = m.team2Score
      ? `${m.team2Score.runs}/${m.team2Score.wickets} (${m.team2Score.overs} ov)`
      : 'Yet to bat';

    const t1Bat = m.battingTeamKey === m.team1.key ? ' 🏏' : '';
    const t2Bat = m.battingTeamKey === m.team2.key ? ' 🏏' : '';

    text += `<b>${idx + 1}. ${m.team1.shortName} vs ${m.team2.shortName}</b> (${m.format})\n`;
    text += `   • <b>${m.team1.shortName}</b>: ${s1}${t1Bat}\n`;
    text += `   • <b>${m.team2.shortName}</b>: ${s2}${t2Bat}\n`;
    if (m.resultText || m.statusLabel) {
      text += `   • <i>${m.resultText || m.statusLabel}</i>\n`;
    }
    text += `\n`;
  });

  text += `───────────────────\n`;
  text += `⚡ <i>Powered by Crex Live API</i>`;
  return text;
}

/**
 * Formats an urgent Wicket Alert
 */
export function formatWicketAlert(
  match: ParsedCricketMatch,
  battingTeamName: string,
  runs: number,
  wickets: number,
  overs: number
): string {
  return `🚨 <b>WICKET FALLS!</b> 🚨\n\n` +
    `🏏 <b>${match.team1.shortName} vs ${match.team2.shortName}</b> (${match.format})\n` +
    `💥 <b>${battingTeamName}</b> lose a wicket!\n` +
    `📊 Current Score: <b>${runs}/${wickets}</b> (${overs} ov)\n` +
    `⚡ <i>${match.resultText || match.statusLabel || 'Match in progress'}</i>\n\n` +
    `📍 ${match.venueName}`;
}

/**
 * Formats an urgent Match Result Alert
 */
export function formatResultAlert(match: ParsedCricketMatch): string {
  const s1 = match.team1Score ? `${match.team1Score.runs}/${match.team1Score.wickets} (${match.team1Score.overs} ov)` : '';
  const s2 = match.team2Score ? `${match.team2Score.runs}/${match.team2Score.wickets} (${match.team2Score.overs} ov)` : '';

  return `🏆 <b>MATCH CONCLUDED!</b> 🏆\n\n` +
    `🏏 <b>${match.team1.name} vs ${match.team2.name}</b>\n` +
    `🥇 <b>Result: ${match.resultText || match.statusLabel}</b>\n\n` +
    `📊 <b>Scores:</b>\n` +
    (s1 ? `• ${match.team1.shortName}: <b>${s1}</b>\n` : '') +
    (s2 ? `• ${match.team2.shortName}: <b>${s2}</b>\n` : '') +
    `\n🏆 ${match.seriesName}`;
}
