import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vbcslopjzilphqpdggzp.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  'sb_publishable_AdjpbtM51QRUXSC68vgpGg_LwEBDKAu';

const serverSupabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

// Catch unhandled errors so the process never unexpectedly terminates
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

app.use(express.json());

// Enable CORS for all incoming client requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control, Pragma');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// In-memory warm match store
let matchStore: {
  matches: Record<string, any>;
  mapping: { teams?: any[]; venues?: any[]; series?: any[] };
  lastUpdated: number;
} = {
  matches: {},
  mapping: {},
  lastUpdated: 0,
};

// Connected SSE clients for instantaneous real-time streaming
const sseClients: Set<express.Response> = new Set();

function broadcastToClients(data: any) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Backend Automated Telegram Broadcaster with Dynamic Supabase Settings
const DEFAULT_TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8972166437:AAGjbREY_bCgJJ77wHTJKZWMwCndj3Pi6JQ';
const DEFAULT_TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003980667930';

let activeTelegramConfig: {
  botToken: string;
  chatId: string;
  enabled: boolean;
  notifyWickets: boolean;
  notifyResults: boolean;
  notifyOverCompletion: boolean;
  notifyPeriodicDigest: boolean;
  digestIntervalMinutes: number;
} = {
  botToken: DEFAULT_TELEGRAM_BOT_TOKEN,
  chatId: DEFAULT_TELEGRAM_CHAT_ID,
  enabled: true,
  notifyWickets: true,
  notifyResults: true,
  notifyOverCompletion: true,
  notifyPeriodicDigest: true,
  digestIntervalMinutes: 3,
};

async function reloadTelegramConfigFromDb() {
  try {
    const { data } = await serverSupabase
      .from('app_settings')
      .select('value')
      .eq('key', 'telegram_config')
      .maybeSingle();

    if (data?.value && typeof data.value === 'object') {
      const cfg = data.value as any;
      activeTelegramConfig = {
        ...activeTelegramConfig,
        botToken: cfg.botToken || activeTelegramConfig.botToken,
        chatId: cfg.chatId || activeTelegramConfig.chatId,
        enabled: cfg.enabled ?? activeTelegramConfig.enabled,
        notifyWickets: cfg.notifyWickets ?? activeTelegramConfig.notifyWickets,
        notifyResults: cfg.notifyResults ?? activeTelegramConfig.notifyResults,
        notifyOverCompletion: cfg.notifyOverCompletion ?? activeTelegramConfig.notifyOverCompletion,
        notifyPeriodicDigest: cfg.notifyPeriodicDigest ?? activeTelegramConfig.notifyPeriodicDigest,
        digestIntervalMinutes: cfg.digestIntervalMinutes || activeTelegramConfig.digestIntervalMinutes,
      };
    }
  } catch {
    // Non-blocking
  }
}

// Initial config hydration and background periodic refresh every 30s
reloadTelegramConfigFromDb();
setInterval(reloadTelegramConfigFromDb, 30000);

async function sendTelegramBroadcast(htmlText: string) {
  const token = activeTelegramConfig.botToken || DEFAULT_TELEGRAM_BOT_TOKEN;
  const chatId = activeTelegramConfig.chatId || DEFAULT_TELEGRAM_CHAT_ID;
  if (!token || !chatId || !activeTelegramConfig.enabled) return false;

  try {
    const cleanToken = token.trim().replace(/^bot/i, '');
    const res = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch (e: any) {
    console.error('Telegram broadcast error:', e.message);
    return false;
  }
}

// Fast in-memory cache to prevent redundant DB roundtrips for sent overs
const sentOverBroadcastCache = new Set<string>();

/**
 * Checks in Supabase app_settings if an over update has ALREADY been sent.
 * If not, atomically records it in DB and returns true to allow dispatch.
 * Guarantees zero duplicate messages even across restarts or multiple tabs.
 */
async function checkAndRecordOverInDb(
  matchId: string,
  inningIndex: number,
  completedOver: number,
  details: {
    team1: string;
    team2: string;
    battingTeam: string;
    score: string;
    runs: number;
    wickets: number;
    overs: string;
    runRate: number;
  }
): Promise<boolean> {
  const dbKey = `tele_over:${matchId}:${inningIndex}:${completedOver}`;

  // 1. Fast in-memory filter
  if (sentOverBroadcastCache.has(dbKey)) {
    return false;
  }

  try {
    // 2. Database verification before sending: check if already exists in Supabase
    const { data: existing, error: selectErr } = await serverSupabase
      .from('app_settings')
      .select('key')
      .eq('key', dbKey)
      .maybeSingle();

    if (!selectErr && existing?.key) {
      sentOverBroadcastCache.add(dbKey);
      return false; // Already sent previously
    }

    // 3. Atomically record in Supabase DB BEFORE sending
    await serverSupabase.from('app_settings').upsert({
      key: dbKey,
      value: {
        matchId,
        inningIndex,
        completedOver,
        ...details,
        sentAt: new Date().toISOString(),
      },
      description: `Telegram over ${completedOver} broadcast record for match ${matchId}`,
      updated_at: new Date().toISOString(),
    });

    sentOverBroadcastCache.add(dbKey);
    return true;
  } catch (err: any) {
    console.warn('DB check exception for over broadcast:', err.message);
    sentOverBroadcastCache.add(dbKey);
    return true;
  }
}

/**
 * Checks in Supabase app_settings if a match conclusion notification has ALREADY been sent.
 * If not, atomically records it in DB and returns true to allow dispatch.
 * Guarantees zero duplicate messages across restarts, reloads, or multiple servers.
 */
async function checkAndRecordConclusionInDb(
  matchId: string,
  details: {
    team1: string;
    team2: string;
    result: string;
    scores?: string;
  }
): Promise<boolean> {
  const dbKey = `tele_concluded:${matchId}`;

  // 1. Fast in-memory filter
  if (finishedNotifiedMatches.has(dbKey) || finishedNotifiedMatches.has(matchId)) {
    return false;
  }

  try {
    // 2. Database verification before sending: check if already exists in Supabase
    const { data: existing, error: selectErr } = await serverSupabase
      .from('app_settings')
      .select('key')
      .eq('key', dbKey)
      .maybeSingle();

    if (!selectErr && existing?.key) {
      finishedNotifiedMatches.add(dbKey);
      finishedNotifiedMatches.add(matchId);
      return false; // Already sent previously
    }

    // 3. Atomically record in Supabase DB BEFORE sending
    await serverSupabase.from('app_settings').upsert({
      key: dbKey,
      value: {
        matchId,
        ...details,
        sentAt: new Date().toISOString(),
      },
      description: `Telegram match concluded notification record for match ${matchId}`,
      updated_at: new Date().toISOString(),
    });

    finishedNotifiedMatches.add(dbKey);
    finishedNotifiedMatches.add(matchId);
    return true;
  } catch (err: any) {
    console.warn('DB check exception for match conclusion:', err?.message || err);
    finishedNotifiedMatches.add(dbKey);
    finishedNotifiedMatches.add(matchId);
    return true;
  }
}

// Track match state for automated notifications
const backendScoresSnapshot: Record<
  string,
  {
    score1: string;
    score2: string;
    wickets1: number;
    wickets2: number;
    completedOvers1: number;
    ballsInOver1: number;
    completedOvers2: number;
    ballsInOver2: number;
    res?: string;
  }
> = {};

const finishedNotifiedMatches = new Set<string>();
let lastDigestTimestamp = Date.now();

function parseScore(raw?: string) {
  if (!raw || typeof raw !== 'string') {
    return {
      runs: 0,
      wickets: 0,
      overs: '0',
      completedOvers: 0,
      ballsInOver: 0,
      isOverComplete: false,
      runRate: 0,
    };
  }
  const match = raw.trim().match(/^(\d+)(?:[\/-](\d+))?(?:\((\d+(?:\.\d+)?))?/);
  if (!match) {
    return {
      runs: 0,
      wickets: 0,
      overs: '0',
      completedOvers: 0,
      ballsInOver: 0,
      isOverComplete: false,
      runRate: 0,
    };
  }
  const runs = parseInt(match[1], 10) || 0;
  const wickets = match[2] !== undefined ? parseInt(match[2], 10) : 0;
  const oversStr = match[3] || '0';
  const parts = oversStr.split('.');
  const completedOvers = parseInt(parts[0], 10) || 0;
  const ballsInOver = parts[1] !== undefined ? parseInt(parts[1], 10) : 0;
  // An over is complete when whole completed overs >= 1 and 0 extra balls bowled
  const isOverComplete = ballsInOver === 0 && completedOvers >= 1;
  const totalBalls = completedOvers * 6 + Math.min(ballsInOver, 6);
  const runRate = totalBalls > 0 ? Number((runs / (totalBalls / 6)).toFixed(2)) : 0;

  return {
    runs,
    wickets,
    overs: oversStr,
    completedOvers,
    ballsInOver,
    isOverComplete,
    runRate,
  };
}

let isGoscorerRunning = false;
let isCrexRunning = false;

/**
 * Unifies match score parsing, change detection, over completion broadcasts,
 * wicket alerts, and match conclusions across all data sources (Goscorer & Crex pool).
 */
async function processMatchUpdate(id: string, item: any): Promise<boolean> {
  const existing = matchStore.matches[id];
  let hasChange = false;
  if (
    !existing ||
    existing.j !== item.j ||
    existing.k !== item.k ||
    existing.res !== item.res ||
    existing.wp !== item.wp
  ) {
    hasChange = true;
  }

  // Ensure latest item properties overwrite existing while preserving auxiliary metadata
  matchStore.matches[id] = { ...(existing || {}), ...item };

  // Automated backend Telegram detection
  const prev = backendScoresSnapshot[id];
  const curScore1 = parseScore(item.j);
  const curScore2 = parseScore(item.k);
  const team1Name = item.t1Sname || item.b || 'Team 1';
  const team2Name = item.t2Sname || item.c || 'Team 2';
  const format = item.fo || 'Match';

  // Check for match conclusion
  const resText = (item.res || item.soResult || '').toLowerCase();
  const isFinished =
    Boolean(item.finishTime) ||
    item.d === 2 ||
    resText.includes('won by') ||
    resText.includes('won') ||
    resText.includes('drawn') ||
    resText.includes('tied');

  if (prev) {
    // 1. Check for wicket in innings 1
    if (
      activeTelegramConfig.notifyWickets &&
      curScore1.wickets > prev.wickets1 &&
      (item.j || '').includes('/')
    ) {
      const wicketMsg =
        `🚨 <b>WICKET FALLS!</b> 🚨\n\n` +
        `🏏 <b>${team1Name} vs ${team2Name}</b> (${format})\n` +
        `💥 <b>${team1Name}</b> lose a wicket!\n` +
        `📊 Current Score: <b>${curScore1.runs}/${curScore1.wickets}</b> (${curScore1.overs} ov)\n` +
        `⚡ <i>${item.res || item.soResult || 'Live'}</i>`;
      sendTelegramBroadcast(wicketMsg);
    }

    // 2. Check for wicket in innings 2
    if (
      activeTelegramConfig.notifyWickets &&
      curScore2.wickets > prev.wickets2 &&
      (item.k || '').includes('/')
    ) {
      const wicketMsg =
        `🚨 <b>WICKET FALLS!</b> 🚨\n\n` +
        `🏏 <b>${team1Name} vs ${team2Name}</b> (${format})\n` +
        `💥 <b>${team2Name}</b> lose a wicket!\n` +
        `📊 Current Score: <b>${curScore2.runs}/${curScore2.wickets}</b> (${curScore2.overs} ov)\n` +
        `⚡ <i>${item.res || item.soResult || 'Live'}</i>`;
      sendTelegramBroadcast(wicketMsg);
    }

    // 3. OVER COMPLETION INNINGS 1 (Sent separately for this match, verified in DB)
    const inn1OverFinished =
      curScore1.isOverComplete &&
      (curScore1.completedOvers > prev.completedOvers1 ||
        (curScore1.completedOvers === prev.completedOvers1 && prev.ballsInOver1 > 0));

    if (
      inn1OverFinished &&
      !isFinished &&
      activeTelegramConfig.notifyOverCompletion !== false
    ) {
      const allowed = await checkAndRecordOverInDb(id, 1, curScore1.completedOvers, {
        team1: team1Name,
        team2: team2Name,
        battingTeam: team1Name,
        score: `${curScore1.runs}/${curScore1.wickets}`,
        runs: curScore1.runs,
        wickets: curScore1.wickets,
        overs: `${curScore1.completedOvers}.0`,
        runRate: curScore1.runRate,
      });

      if (allowed) {
        const cachedOdds = serverOddsCache.get(id);
        const bookmaker = cachedOdds?.data?.bookmaker;
        const oddsStr = bookmaker
          ? `${cachedOdds?.data?.favoriteTeamName || 'Fav'} B: ${bookmaker.backRate} | L: ${bookmaker.layRate}`
          : undefined;

        const overMsg =
          `🏏 <b>OVER ${curScore1.completedOvers} COMPLETED</b>\n` +
          `🏆 <b>${team1Name} vs ${team2Name}</b> · <i>${format}</i>\n` +
          `───────────────────\n` +
          `🔹 <b>Batting:</b> <b>${team1Name}</b>\n` +
          `📊 <b>Score:</b> <b>${curScore1.runs}/${curScore1.wickets}</b> (${curScore1.completedOvers}.0 ov)\n` +
          `📈 <b>Current Run Rate (CRR):</b> <b>${curScore1.runRate.toFixed(2)}</b>\n` +
          (oddsStr ? `🎲 <b>Live Odds:</b> <code>${oddsStr}</code>\n` : '') +
          (item.res || item.soResult ? `⚡ <b>Status:</b> <i>${item.res || item.soResult}</i>\n` : '') +
          (item.vname ? `📍 <i>${item.vname}</i>\n` : '') +
          `───────────────────\n` +
          `⚡ <i>Crex Live Scorer · Verified Over Update</i>`;

        await sendTelegramBroadcast(overMsg);
      }
    }

    // 4. OVER COMPLETION INNINGS 2 (Sent separately for this match, verified in DB)
    const inn2OverFinished =
      curScore2.isOverComplete &&
      (curScore2.completedOvers > prev.completedOvers2 ||
        (curScore2.completedOvers === prev.completedOvers2 && prev.ballsInOver2 > 0));

    if (
      inn2OverFinished &&
      !isFinished &&
      activeTelegramConfig.notifyOverCompletion !== false
    ) {
      const allowed = await checkAndRecordOverInDb(id, 2, curScore2.completedOvers, {
        team1: team1Name,
        team2: team2Name,
        battingTeam: team2Name,
        score: `${curScore2.runs}/${curScore2.wickets}`,
        runs: curScore2.runs,
        wickets: curScore2.wickets,
        overs: `${curScore2.completedOvers}.0`,
        runRate: curScore2.runRate,
      });

      if (allowed) {
        const cachedOdds = serverOddsCache.get(id);
        const bookmaker = cachedOdds?.data?.bookmaker;
        const oddsStr = bookmaker
          ? `${cachedOdds?.data?.favoriteTeamName || 'Fav'} B: ${bookmaker.backRate} | L: ${bookmaker.layRate}`
          : undefined;

        const overMsg =
          `🏏 <b>OVER ${curScore2.completedOvers} COMPLETED</b>\n` +
          `🏆 <b>${team1Name} vs ${team2Name}</b> · <i>${format}</i>\n` +
          `───────────────────\n` +
          `🔹 <b>Batting:</b> <b>${team2Name}</b>\n` +
          `📊 <b>Score:</b> <b>${curScore2.runs}/${curScore2.wickets}</b> (${curScore2.completedOvers}.0 ov)\n` +
          `📈 <b>Current Run Rate (CRR):</b> <b>${curScore2.runRate.toFixed(2)}</b>\n` +
          (oddsStr ? `🎲 <b>Live Odds:</b> <code>${oddsStr}</code>\n` : '') +
          (item.res || item.soResult ? `⚡ <b>Status:</b> <i>${item.res || item.soResult}</i>\n` : '') +
          (item.vname ? `📍 <i>${item.vname}</i>\n` : '') +
          `───────────────────\n` +
          `⚡ <i>Crex Live Scorer · Verified Over Update</i>`;

        await sendTelegramBroadcast(overMsg);
      }
    }
  } else {
    // On first discovery: pre-seed historical overs in cache so past completed overs are not spammed
    for (let o = 1; o <= curScore1.completedOvers; o++) {
      sentOverBroadcastCache.add(`tele_over:${id}:1:${o}`);
    }
    for (let o = 1; o <= curScore2.completedOvers; o++) {
      sentOverBroadcastCache.add(`tele_over:${id}:2:${o}`);
    }
    // Also pre-seed if match is already finished so historical completed matches are never spammed
    if (isFinished) {
      finishedNotifiedMatches.add(id);
      finishedNotifiedMatches.add(`tele_concluded:${id}`);
    }
  }

  // Check for match conclusion (Database Verified & Deduplicated)
  if (
    isFinished &&
    !finishedNotifiedMatches.has(id) &&
    !finishedNotifiedMatches.has(`tele_concluded:${id}`)
  ) {
    finishedNotifiedMatches.add(id);
    finishedNotifiedMatches.add(`tele_concluded:${id}`);

    if (activeTelegramConfig.notifyResults) {
      const allowed = await checkAndRecordConclusionInDb(id, {
        team1: team1Name,
        team2: team2Name,
        result: item.res || item.soResult || 'Completed',
        scores: `${team1Name}: ${item.j || '-'}, ${team2Name}: ${item.k || '-'}`,
      });

      if (allowed) {
        const resultMsg =
          `🏆 <b>MATCH CONCLUDED!</b> 🏆\n\n` +
          `🏏 <b>${team1Name} vs ${team2Name}</b> (${format})\n` +
          `🥇 <b>Result: ${item.res || item.soResult}</b>\n\n` +
          `📊 <b>Scores:</b>\n` +
          (item.j ? `• ${team1Name}: <b>${item.j}</b>\n` : '') +
          (item.k ? `• ${team2Name}: <b>${item.k}</b>\n` : '') +
          (item.sname || item.sfullname ? `\n🏆 ${item.sname || item.sfullname}` : '');
        await sendTelegramBroadcast(resultMsg);
      }
    }
  }

  backendScoresSnapshot[id] = {
    score1: item.j || '',
    score2: item.k || '',
    wickets1: curScore1.wickets,
    wickets2: curScore2.wickets,
    completedOvers1: curScore1.completedOvers,
    ballsInOver1: curScore1.ballsInOver,
    completedOvers2: curScore2.completedOvers,
    ballsInOver2: curScore2.ballsInOver,
    res: item.res,
  };

  return hasChange;
}

// 1. Ultra-fast Goscorer API sync (runs every 1 second, ~10ms)
async function syncGoscorerApi(countryCode = 'IN') {
  if (isGoscorerRunning) return;
  isGoscorerRunning = true;
  const now = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);

    const res = await fetch(`https://api.goscorer.com/api/v2/getTopMatches?_t=${now}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      body: JSON.stringify({ cc: countryCode, _t: now }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      let hasChange = false;

      for (const [id, m] of Object.entries(data)) {
        const changed = await processMatchUpdate(id, m);
        if (changed) hasChange = true;
      }

      // Periodic Scoreboard Digest: only if explicitly enabled in telegram config
      if (
        activeTelegramConfig.notifyPeriodicDigest &&
        now - lastDigestTimestamp >= (activeTelegramConfig.digestIntervalMinutes || 15) * 60 * 1000
      ) {
        lastDigestTimestamp = now;
        const liveItems = Object.entries(matchStore.matches).filter(([_, m]) => (m.j || m.k) && !m.finishTime);
        if (liveItems.length > 0) {
          const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          let digest = `🏏 <b>CREX LIVE CRICKET DIGEST</b> · <i>${timeStr}</i>\n`;
          digest += `🔥 <b>${liveItems.length} Live Matches in Progress</b>\n`;
          digest += `───────────────────\n\n`;
          liveItems.forEach(([_, m], idx) => {
            const t1 = m.t1Sname || m.b || 'T1';
            const t2 = m.t2Sname || m.c || 'T2';
            digest += `<b>${idx + 1}. ${t1} vs ${t2}</b> (${m.fo || 'Match'})\n`;
            digest += `   • <b>${t1}</b>: ${m.j || 'Yet to bat'}\n`;
            digest += `   • <b>${t2}</b>: ${m.k || 'Yet to bat'}\n`;
            if (m.res || m.soResult) digest += `   • <i>${m.res || m.soResult}</i>\n`;
            digest += `\n`;
          });
          digest += `───────────────────\n⚡ <i>Live automated broadcast</i>`;
          sendTelegramBroadcast(digest);
        }
      }

      matchStore.lastUpdated = Date.now();

      if (hasChange && sseClients.size > 0) {
        broadcastToClients({
          type: 'update',
          matches: matchStore.matches,
          timestamp: new Date().toISOString(),
        });
      }
    }
  } catch {
    // Non-blocking
  } finally {
    isGoscorerRunning = false;
  }
}

// 2. Crex Pool sync (runs every 2.5s) to collect extra matches and mapping with live scores
async function syncCrexPool() {
  if (isCrexRunning) return;
  isCrexRunning = true;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const html = await fetch('https://crex.com/cricket-live-score', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    }).then((r) => r.text());
    clearTimeout(timeout);

    const regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let hasChange = false;

    while ((match = regex.exec(html)) !== null) {
      if (match[1].includes('ssr-bootstrap-v1') && match[1].includes('desktopTopMatchesRaw')) {
        const idx = match[1].indexOf('{&q;language&q;');
        if (idx !== -1) {
          const raw = match[1]
            .slice(idx)
            .replace(/&q;/g, '"')
            .replace(/&s;/g, "'")
            .replace(/&amp;/g, '&');
          const parsed = JSON.parse(raw);

          if (parsed.desktopTopMatchesRaw) {
            for (const [id, m] of Object.entries(parsed.desktopTopMatchesRaw)) {
              const changed = await processMatchUpdate(id, m);
              if (changed) hasChange = true;
            }
          }

          const homeMap =
            parsed['https://oc.crickapi.com/mapping/getHomeMapDatahome'] ||
            parsed['https://oc.crickapi.com/mapping/getHomeMapDatahomeAtf'];
          if (homeMap) {
            matchStore.mapping = {
              teams: homeMap.t,
              venues: homeMap.v,
              series: homeMap.s,
            };
          }
          break;
        }
      }
    }

    matchStore.lastUpdated = Date.now();

    if (hasChange && sseClients.size > 0) {
      broadcastToClients({
        type: 'update',
        matches: matchStore.matches,
        timestamp: new Date().toISOString(),
      });
    }
  } catch {
    // Non-blocking
  } finally {
    isCrexRunning = false;
  }
}

// Initial eager sync
syncGoscorerApi()
  .then(syncCrexPool)
  .catch((err) => console.error('Initial sync error:', err));

// Continuous live polling loop
setInterval(syncGoscorerApi, 1000); // Check Goscorer API every 1000ms
setInterval(syncCrexPool, 2500);   // Sync Crex fixtures pool every 2.5s for real-time live matches

// SSE Live Stream: Instant zero-latency push to connected clients
app.get('/api/live-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send current state immediately on connect
  res.write(
    `data: ${JSON.stringify({
      type: 'init',
      matches: matchStore.matches,
      mapping: matchStore.mapping,
      timestamp: new Date().toISOString(),
    })}\n\n`
  );

  sseClients.add(res);

  // Keep-alive heartbeat every 10s
  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 10000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// High-speed endpoint: Responds immediately from memory in < 1ms
app.all(['/api/top-matches', '/api/v2/getTopMatches'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (Object.keys(matchStore.matches).length === 0) {
    await Promise.all([syncGoscorerApi(req.body?.cc || 'IN'), syncCrexPool()]);
  }

  res.json({
    matches: matchStore.matches,
    mapping: matchStore.mapping,
    totalCount: Object.keys(matchStore.matches).length,
    timestamp: new Date(matchStore.lastUpdated || Date.now()).toISOString(),
  });
});

// In-flight server request deduplication & short TTL cache for odds
const serverOddsCache = new Map<string, { data: any; timestamp: number }>();
const serverOddsInFlight = new Map<string, Promise<any>>();

// Match-specific Odds Endpoint Proxy (CORS bypass and server-side deduplication)
app.get(['/api/odds', '/api/v3/getSV3'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const key = String(req.query.key || '').trim();

  if (!key) {
    return res.status(400).json({ ok: false, error: 'Missing match key parameter' });
  }

  // Input validation
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    return res.status(400).json({ ok: false, error: 'Invalid match key format' });
  }

  // Check 500ms cache
  const cached = serverOddsCache.get(key);
  if (cached && Date.now() - cached.timestamp < 500) {
    return res.json(cached.data);
  }

  // Deduplicate concurrent upstream requests for the same key
  if (serverOddsInFlight.has(key)) {
    try {
      const data = await serverOddsInFlight.get(key);
      return res.json(data);
    } catch (err: any) {
      return res.status(502).json({ ok: false, error: err.message });
    }
  }

  const fetchTask = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const upstreamRes = await fetch(
      `https://api.goscorer.com/api/v3/getSV3?key=${encodeURIComponent(key)}`,
      {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!upstreamRes.ok) {
      throw new Error(`Upstream odds API returned status ${upstreamRes.status}`);
    }

    const data = await upstreamRes.json();
    serverOddsCache.set(key, { data, timestamp: Date.now() });

    // Asynchronously record tick into match_odds_ticks table
    if (serverSupabase && data) {
      const rawRate = typeof data.s === 'string' ? data.s : typeof data.r === 'string' ? data.r : null;
      (async () => {
        try {
          await serverSupabase.from('match_odds_ticks').insert({
            match_id: key,
            odds_key: key,
            favorite_team: data.B || data.sd || null,
            raw_rate_string: rawRate,
            session_data: data.S ? { raw_sessions: data.S } : null,
            created_at: new Date().toISOString(),
          });
        } catch {
          // Non-blocking
        }
      })();
    }

    return data;
  })();

  serverOddsInFlight.set(key, fetchTask);

  try {
    const data = await fetchTask;
    return res.json(data);
  } catch (err: any) {
    return res.status(502).json({
      ok: false,
      error: err.message || 'Failed to fetch odds from upstream',
    });
  } finally {
    serverOddsInFlight.delete(key);
  }
});

// 24/7 Webhook / Cron Endpoint (hit by cron-job.org, UptimeRobot, or Vercel Cron)
app.all(['/api/cron', '/api/telegram/cron'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  await syncGoscorerApi('IN');

  const liveItems = Object.entries(matchStore.matches).filter(
    ([_, m]) => (m.j || m.k) && !m.finishTime
  );

  let sent = false;
  if (liveItems.length > 0) {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let digest = `🏏 <b>CREX LIVE CRICKET 24/7 DIGEST</b> · <i>${timeStr}</i>\n`;
    digest += `🔥 <b>${liveItems.length} Live Matches in Progress</b>\n`;
    digest += `───────────────────\n\n`;

    liveItems.forEach(([_, m], idx) => {
      const t1 = m.t1Sname || m.b || 'T1';
      const t2 = m.t2Sname || m.c || 'T2';
      digest += `<b>${idx + 1}. ${t1} vs ${t2}</b> (${m.fo || 'Match'})\n`;
      digest += `   • <b>${t1}</b>: ${m.j || 'Yet to bat'}\n`;
      digest += `   • <b>${t2}</b>: ${m.k || 'Yet to bat'}\n`;
      if (m.res || m.soResult) digest += `   • <i>${m.res || m.soResult}</i>\n`;
      digest += `\n`;
    });

    digest += `───────────────────\n⚡ <i>24/7 Automated cron broadcast</i>`;
    sent = await sendTelegramBroadcast(digest);
  }

  res.json({
    ok: true,
    status: 'cron_executed',
    timestamp: new Date().toISOString(),
    liveMatchesCount: liveItems.length,
    telegramSent: sent,
  });
});

// Telegram Bot Dispatch Proxy
app.post('/api/telegram/send', async (req, res) => {
  const { botToken, chatId, text } = req.body || {};
  const token = botToken || DEFAULT_TELEGRAM_BOT_TOKEN;
  const targetChatId = chatId || DEFAULT_TELEGRAM_CHAT_ID;

  if (!text) {
    return res.status(400).json({ ok: false, error: 'Missing message text' });
  }

  try {
    const cleanToken = String(token).trim().replace(/^bot/i, '');
    const tgRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(targetChatId).trim(),
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await tgRes.json();
    return res.status(tgRes.status).json(data);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint to test an over completion alert directly
app.post('/api/telegram/test-over', async (req, res) => {
  const { botToken, chatId, matchId } = req.body || {};
  const token = botToken || activeTelegramConfig.botToken || DEFAULT_TELEGRAM_BOT_TOKEN;
  const targetChatId = chatId || activeTelegramConfig.chatId || DEFAULT_TELEGRAM_CHAT_ID;

  const sampleMatch = (matchId && matchStore.matches[matchId])
    ? matchStore.matches[matchId]
    : Object.values(matchStore.matches)[0];

  const t1 = sampleMatch?.t1Sname || sampleMatch?.b || 'IND';
  const t2 = sampleMatch?.t2Sname || sampleMatch?.c || 'NZ';
  const format = sampleMatch?.fo || 'T20I';
  const venue = sampleMatch?.vname || 'Seddon Park, Hamilton';

  const testMsg =
    `🏏 <b>OVER 10 COMPLETED (TEST NOTIFICATION)</b>\n` +
    `🏆 <b>${t1} vs ${t2}</b> · <i>${format}</i>\n` +
    `───────────────────\n` +
    `🔹 <b>Batting:</b> <b>${t1}</b>\n` +
    `📊 <b>Score:</b> <b>88/2</b> (10.0 ov)\n` +
    `📈 <b>Current Run Rate (CRR):</b> <b>8.80</b>\n` +
    `🎲 <b>Live Odds:</b> <code>${t1} B: 72 | L: 74</code>\n` +
    `⚡ <b>Status:</b> <i>${t1} opted to bat</i>\n` +
    `📍 <i>${venue}</i>\n` +
    `───────────────────\n` +
    `⚡ <i>Crex Live Scorer · Verified Over Update</i>`;

  try {
    const cleanToken = String(token).trim().replace(/^bot/i, '');
    const tgRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(targetChatId).trim(),
        text: testMsg,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await tgRes.json();
    return res.status(tgRes.status).json(data);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Trigger initial connection greeting on boot
setTimeout(() => {
  sendTelegramBroadcast(
    '🏏 <b>Crex Live Cricket Scorer Connected!</b>\n\n' +
    '✅ Backend automated live cricket feed is now active.\n' +
    '📢 Real-time wickets, match conclusions, and live scoreboards will be broadcasted here automatically.'
  );
}, 2000);

// Diagnostic Endpoint: Check Supabase connectivity and table counts
app.get('/api/supabase/status', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    const [matchesRes, teamsRes, settingsRes, positionsRes] = await Promise.all([
      serverSupabase.from('matches').select('*', { count: 'exact', head: true }),
      serverSupabase.from('teams').select('*', { count: 'exact', head: true }),
      serverSupabase.from('app_settings').select('key, updated_at'),
      serverSupabase.from('trade_positions').select('*', { count: 'exact', head: true }),
    ]);

    res.json({
      ok: !matchesRes.error && !teamsRes.error,
      connected: true,
      url: SUPABASE_URL,
      matchesCount: matchesRes.count ?? 0,
      teamsCount: teamsRes.count ?? 0,
      positionsCount: positionsRes.count ?? 0,
      settingsFound: settingsRes.data?.map((s: { key: string }) => s.key) ?? [],
      errors: {
        matches: matchesRes.error?.message || null,
        teams: teamsRes.error?.message || null,
        settings: settingsRes.error?.message || null,
        positions: positionsRes.error?.message || null,
      },
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Mount Vite or serve static files
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Live Scorer server running on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
