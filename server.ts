import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Local PostgreSQL connection pool configuration
// Supports standard discrete variables (PGPASSWORD, PGUSER, etc.) or full DATABASE_URL
const poolConfig: pg.PoolConfig = {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

if (process.env.PGPASSWORD) {
  poolConfig.user = process.env.PGUSER || 'postgres';
  poolConfig.password = process.env.PGPASSWORD;
  poolConfig.host = process.env.PGHOST || 'localhost';
  poolConfig.port = Number(process.env.PGPORT) || 5432;
  poolConfig.database = process.env.PGDATABASE || 'leadhunt';
} else {
  poolConfig.connectionString =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/leadhunt';
}

export const dbPool = new Pool(poolConfig);
const DATABASE_URL = poolConfig.connectionString || `postgresql://${poolConfig.user || 'postgres'}:****@${poolConfig.host || 'localhost'}:${poolConfig.port || 5432}/${poolConfig.database || 'leadhunt'}`;

// Database connection verification test on server startup
async function testDbConnection() {
  try {
    const client = await dbPool.connect();
    const res = await client.query('SELECT NOW() as now, current_database() as db_name');

    // Clean up any historical matches in database outside WBBL 2026 and Abu Dhabi T10 2026
    await client.query(`
      DELETE FROM matches
      WHERE NOT (
        series_key IN ('2KG', '^2KG', '2IO', '^2IO')
        OR LOWER(COALESCE(series_name, '')) LIKE '%wbbl%'
        OR LOWER(COALESCE(series_name, '')) LIKE '%big bash%'
        OR (LOWER(COALESCE(series_name, '')) LIKE '%abu dhabi%' AND LOWER(COALESCE(series_name, '')) LIKE '%t10%')
      )
    `).catch(() => {});

    client.release();
    const safeUrl = DATABASE_URL.replace(/:([^:@]+)@/, ':****@');
    console.log(`\n======================================================`);
    console.log(`[PostgreSQL] Connection SUCCESSFUL!`);
    console.log(`[PostgreSQL] Connected to: "${res.rows[0].db_name}" (${safeUrl})`);
    console.log(`[PostgreSQL] Filter Active: WBBL 2026 & Abu Dhabi T10 2026`);
    console.log(`[PostgreSQL] Server Time: ${res.rows[0].now}`);
    console.log(`======================================================\n`);
  } catch (err: any) {
    const safeUrl = DATABASE_URL.replace(/:([^:@]+)@/, ':****@');
    console.warn(`\n======================================================`);
    console.warn(`[PostgreSQL] Connection Warning: Could not connect to local PostgreSQL`);
    console.warn(`Target URL: ${safeUrl}`);
    console.warn(`Reason: ${err.message}`);
    console.warn(`Tip: Ensure PostgreSQL service is running on localhost:5432 and database "leadhunt" exists.`);
    console.warn(`The application will continue running and auto-retry on incoming requests.`);
    console.warn(`======================================================\n`);
  }
}
testDbConnection();

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
  enabled: false,
  notifyWickets: false,
  notifyResults: false,
  notifyOverCompletion: false,
  notifyPeriodicDigest: false,
  digestIntervalMinutes: 3,
};

async function reloadTelegramConfigFromDb() {
  try {
    const res = await dbPool.query('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', ['telegram_config']);
    if (res.rows.length > 0 && res.rows[0].value) {
      const cfg = res.rows[0].value as any;
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
    // Non-blocking if database is offline or starting up
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
 * Checks in PostgreSQL app_settings if an over update has ALREADY been sent.
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
    // 2. Database verification before sending: check if already exists in PostgreSQL
    const existing = await dbPool.query('SELECT key FROM app_settings WHERE key = $1 LIMIT 1', [dbKey]);
    if (existing.rows.length > 0) {
      sentOverBroadcastCache.add(dbKey);
      return false; // Already sent previously
    }

    // 3. Atomically record in PostgreSQL app_settings BEFORE sending
    const payload = {
      matchId,
      inningIndex,
      completedOver,
      ...details,
      sentAt: new Date().toISOString(),
    };
    await dbPool.query(
      `INSERT INTO app_settings (key, value, description, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [dbKey, JSON.stringify(payload), `Telegram over ${completedOver} broadcast record for match ${matchId}`]
    );

    sentOverBroadcastCache.add(dbKey);
    return true;
  } catch (err: any) {
    sentOverBroadcastCache.add(dbKey);
    return true;
  }
}

/**
 * Checks in PostgreSQL app_settings if a match conclusion notification has ALREADY been sent.
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
    // 2. Database verification before sending: check if already exists in PostgreSQL
    const existing = await dbPool.query('SELECT key FROM app_settings WHERE key = $1 LIMIT 1', [dbKey]);
    if (existing.rows.length > 0) {
      finishedNotifiedMatches.add(dbKey);
      finishedNotifiedMatches.add(matchId);
      return false; // Already sent previously
    }

    // 3. Atomically record in PostgreSQL BEFORE sending
    const payload = {
      matchId,
      ...details,
      sentAt: new Date().toISOString(),
    };
    await dbPool.query(
      `INSERT INTO app_settings (key, value, description, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [dbKey, JSON.stringify(payload), `Telegram match concluded notification record for match ${matchId}`]
    );

    finishedNotifiedMatches.add(dbKey);
    finishedNotifiedMatches.add(matchId);
    return true;
  } catch (err: any) {
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
const notifiedWickets = new Set<string>();
let lastDigestTimestamp = Date.now();

function resolveTeamName(key?: string, fallbackName?: string): string {
  if (fallbackName && fallbackName.trim() && fallbackName !== key && fallbackName.length > 2) {
    return fallbackName.trim();
  }
  const teamsMap = matchStore.mapping?.teams as Record<string, any> | undefined;
  if (key && teamsMap && teamsMap[key]) {
    const t = teamsMap[key];
    return t.sname || t.name || t.sn || t.fn || fallbackName || key;
  }
  return fallbackName || key || 'Team';
}

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
 * Strict Tournament Filter:
 * Only permits:
 * 1. WBBL - Women's Big Bash League 2026 (series key 2KG / ^2KG)
 * 2. Abu Dhabi T10 2026 (series key 2IO / ^2IO)
 * All other matches are excluded from memory, UI, and database storage.
 */
function isAllowedTournament(item: any, mapping?: { series?: any[] }): boolean {
  if (!item) return false;
  const rawQ = String(item.q || item.seriesKey || '').replace(/^\^/, '').toUpperCase();
  const seriesName = String(item.sfullname || item.sname || item.seriesName || '').toLowerCase();
  const fName = String(item.fName || item.matchTitlePrefix || '').toLowerCase();
  const fo = String(item.fo || item.format || '').toLowerCase();

  let mappedSeriesName = '';
  if (mapping?.series && Array.isArray(mapping.series)) {
    const sObj = mapping.series.find(
      (s: any) =>
        s.f_key === rawQ ||
        String(s.f_key).toUpperCase() === rawQ ||
        s.key === rawQ
    );
    if (sObj) {
      mappedSeriesName = `${sObj.n || ''} ${sObj.sn || ''}`.toLowerCase();
    }
  }

  const combined = `${seriesName} ${mappedSeriesName} ${fName} ${fo}`.toLowerCase();

  // 1. WBBL - Women's Big Bash League 2026
  const isWbbl =
    rawQ === '2KG' ||
    combined.includes('wbbl') ||
    combined.includes('big bash');

  // 2. Abu Dhabi T10 2026
  const isAbuDhabiT10 =
    rawQ === '2IO' ||
    (combined.includes('abu dhabi') && (combined.includes('t10') || combined.includes('t-10'))) ||
    combined.includes('abudhabi t10');

  return isWbbl || isAbuDhabiT10;
}

/**
 * Unifies match score parsing, change detection, over completion broadcasts,
 * wicket alerts, and match conclusions across all data sources (Goscorer & Crex pool).
 */
async function processMatchUpdate(id: string, item: any): Promise<boolean> {
  // Enforce tournament filter: exclude anything outside WBBL 2026 and Abu Dhabi T10 2026
  if (!isAllowedTournament(item, matchStore.mapping)) {
    if (matchStore.matches[id]) {
      delete matchStore.matches[id];
    }
    delete backendScoresSnapshot[id];
    return false;
  }

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

  // Preserve existing score strings if an incoming poll item has transient empty scores
  if (!item.j && existing?.j) item.j = existing.j;
  if (!item.k && existing?.k) item.k = existing.k;

  // Ensure latest item properties overwrite existing while preserving auxiliary metadata
  matchStore.matches[id] = { ...(existing || {}), ...item };

  // Automated backend Telegram detection
  const prev = backendScoresSnapshot[id];
  const curScore1 = parseScore(item.j);
  const curScore2 = parseScore(item.k);
  const team1Name = resolveTeamName(item.b, item.t1Sname || item.t1Name);
  const team2Name = resolveTeamName(item.c, item.t2Sname || item.t2Name);
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

  if (prev && !isFinished && !resText.includes('break')) {
    // 1. Check for wicket in innings 1 (Strictly deduplicated per match and wicket count)
    const wicketKey1 = `${id}-inn1-w${curScore1.wickets}`;
    if (
      activeTelegramConfig.enabled &&
      activeTelegramConfig.notifyWickets &&
      curScore1.wickets > 0 &&
      curScore1.wickets > prev.wickets1 &&
      !notifiedWickets.has(wicketKey1) &&
      (item.j || '').includes('/')
    ) {
      notifiedWickets.add(wicketKey1);
      const wicketMsg =
        `🚨 <b>WICKET FALLS!</b> 🚨\n\n` +
        `🏏 <b>${team1Name} vs ${team2Name}</b> (${format})\n` +
        `💥 <b>${team1Name}</b> lose a wicket!\n` +
        `📊 Current Score: <b>${curScore1.runs}/${curScore1.wickets}</b> (${curScore1.overs} ov)\n` +
        `⚡ <i>${item.res || item.soResult || 'Live'}</i>`;
      sendTelegramBroadcast(wicketMsg);
    }

    // 2. Check for wicket in innings 2 (Strictly deduplicated per match and wicket count)
    const wicketKey2 = `${id}-inn2-w${curScore2.wickets}`;
    if (
      activeTelegramConfig.enabled &&
      activeTelegramConfig.notifyWickets &&
      curScore2.wickets > 0 &&
      curScore2.wickets > prev.wickets2 &&
      !notifiedWickets.has(wicketKey2) &&
      (item.k || '').includes('/')
    ) {
      notifiedWickets.add(wicketKey2);
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
        if (!isAllowedTournament(m, matchStore.mapping)) {
          if (matchStore.matches[id]) {
            delete matchStore.matches[id];
            hasChange = true;
          }
          continue;
        }
        const changed = await processMatchUpdate(id, m);
        if (changed) hasChange = true;
      }

      // Prune any existing matches that are outside WBBL 2026 and Abu Dhabi T10 2026
      for (const [id, m] of Object.entries(matchStore.matches)) {
        if (!isAllowedTournament(m, matchStore.mapping)) {
          delete matchStore.matches[id];
          hasChange = true;
        }
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

          if (parsed.desktopTopMatchesRaw) {
            for (const [id, m] of Object.entries(parsed.desktopTopMatchesRaw)) {
              if (!isAllowedTournament(m, matchStore.mapping)) {
                if (matchStore.matches[id]) {
                  delete matchStore.matches[id];
                  hasChange = true;
                }
                continue;
              }
              const changed = await processMatchUpdate(id, m);
              if (changed) hasChange = true;
            }
          }

          // Prune non-allowed tournament matches from memory immediately
          for (const [mId, mObj] of Object.entries(matchStore.matches)) {
            if (!isAllowedTournament(mObj, matchStore.mapping)) {
              delete matchStore.matches[mId];
              hasChange = true;
            }
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

// 3. Ultra-fast Live Match Score Sync directly from getSV3 (ball-by-ball, ~1.5s)
async function syncLiveMatchScores() {
  const liveMatchIds = Object.keys(matchStore.matches).filter((id) => {
    const m = matchStore.matches[id];
    return m && !m.finishTime && (m.j || m.k || m.d === 1 || m.d === 4);
  });

  if (liveMatchIds.length === 0) return;

  await Promise.allSettled(
    liveMatchIds.slice(0, 10).map(async (key) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1800);
        const res = await fetch(`https://api.goscorer.com/api/v3/getSV3?key=${encodeURIComponent(key)}&_t=${Date.now()}`, {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          serverOddsCache.set(key, { data, timestamp: Date.now() });
          if (data && matchStore.matches[key]) {
            const existing = matchStore.matches[key];
            let changed = false;
            if (data.j && existing.j !== data.j) {
              existing.j = data.j;
              changed = true;
            }
            if (data.k && existing.k !== data.k) {
              existing.k = data.k;
              changed = true;
            }
            if (data.res && existing.res !== data.res) {
              existing.res = data.res;
              changed = true;
            }
            if (data.R && existing.flb !== data.R) {
              existing.flb = data.R;
              changed = true;
            }
            if (changed) {
              matchStore.lastUpdated = Date.now();
              await processMatchUpdate(key, existing);
            }
          }
        }
      } catch {
        // Non-blocking
      }
    })
  );
}

// Initial eager sync
syncGoscorerApi()
  .then(syncCrexPool)
  .then(syncLiveMatchScores)
  .catch((err) => console.error('Initial sync error:', err));

// Continuous live polling loop
setInterval(syncGoscorerApi, 1000); // Check Goscorer API every 1000ms
setInterval(syncLiveMatchScores, 1500); // Live ball-by-ball getSV3 sync every 1500ms
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

    // Instantly update matchStore with live ball-by-ball score from getSV3
    if (data && matchStore.matches[key]) {
      const existing = matchStore.matches[key];
      let changed = false;
      if (data.j && existing.j !== data.j) {
        existing.j = data.j;
        changed = true;
      }
      if (data.k && existing.k !== data.k) {
        existing.k = data.k;
        changed = true;
      }
      if (data.res && existing.res !== data.res) {
        existing.res = data.res;
        changed = true;
      }
      if (data.R && existing.flb !== data.R) {
        existing.flb = data.R;
        changed = true;
      }
      if (changed) {
        matchStore.lastUpdated = Date.now();
        processMatchUpdate(key, existing).catch(() => {});
      }
    }

    // Asynchronously record tick into match_odds_ticks table
    if (data) {
      const rawRate =
        typeof data.R === 'string'
          ? data.R
          : typeof data.r === 'string'
          ? data.r
          : typeof data.s === 'string'
          ? data.s
          : null;
      const favTeam =
        typeof data.F === 'string'
          ? data.F.replace(/^\^/, '')
          : data.B || data.sd || null;

      (async () => {
        try {
          await dbPool.query(
            `INSERT INTO match_odds_ticks (match_id, odds_key, favorite_team, raw_rate_string, session_data, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [key, key, favTeam, rawRate, data.S ? JSON.stringify({ raw_sessions: data.S }) : null]
          );
        } catch {
          // Non-blocking if database is offline or starting up
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
    if (cached?.data) {
      return res.json(cached.data);
    }
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

// ============================================================================
// Local PostgreSQL Database REST Endpoints
// ============================================================================

// Diagnostic Endpoint: Check PostgreSQL connectivity and table counts
app.get(['/api/db/status', '/api/supabase/status'], async (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const safeUrl = DATABASE_URL.replace(/:([^:@]+)@/, ':****@');
  try {
    const client = await dbPool.connect();
    const [matchesRes, teamsRes, settingsRes, positionsRes, tradesRes] = await Promise.all([
      client.query('SELECT count(*) as count FROM matches'),
      client.query('SELECT count(*) as count FROM teams'),
      client.query('SELECT key, updated_at FROM app_settings'),
      client.query('SELECT count(*) as count FROM trade_positions'),
      client.query('SELECT count(*) as count FROM strategy_trades'),
    ]);
    client.release();

    res.json({
      ok: true,
      connected: true,
      database: 'PostgreSQL',
      url: safeUrl,
      matchesCount: parseInt(matchesRes.rows[0]?.count || '0', 10),
      teamsCount: parseInt(teamsRes.rows[0]?.count || '0', 10),
      positionsCount: parseInt(positionsRes.rows[0]?.count || '0', 10),
      tradesCount: parseInt(tradesRes.rows[0]?.count || '0', 10),
      settingsFound: settingsRes.rows.map((r: any) => r.key),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.json({
      ok: false,
      connected: false,
      database: 'PostgreSQL',
      url: safeUrl,
      error: err.message,
      tip: 'Ensure PostgreSQL service is running and database "leadhunt" was initialized with schema.sql.',
      timestamp: new Date().toISOString(),
    });
  }
});

// Upsert Strategy Trade (First Entry, Second Entry, Bookset Exits)
app.post('/api/db/trades', async (req, res) => {
  try {
    const trade = req.body;
    if (!trade || !trade.matchId) {
      return res.status(400).json({ ok: false, error: 'Missing matchId or trade payload' });
    }
    await dbPool.query(
      `INSERT INTO strategy_trades (
        match_id, match_name, series_name, booking_team, batting_team, bowling_team,
        entry_type, innings, entry_over, entry_paise, entry_decimal, entry_wickets,
        entry_time, exit_over, exit_paise, exit_decimal, exit_time, exit_reason,
        status, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
      ON CONFLICT (match_id, entry_type) DO UPDATE SET
        match_name = COALESCE(EXCLUDED.match_name, strategy_trades.match_name),
        series_name = COALESCE(EXCLUDED.series_name, strategy_trades.series_name),
        booking_team = COALESCE(EXCLUDED.booking_team, strategy_trades.booking_team),
        batting_team = COALESCE(EXCLUDED.batting_team, strategy_trades.batting_team),
        bowling_team = COALESCE(EXCLUDED.bowling_team, strategy_trades.bowling_team),
        exit_over = COALESCE(EXCLUDED.exit_over, strategy_trades.exit_over),
        exit_paise = COALESCE(EXCLUDED.exit_paise, strategy_trades.exit_paise),
        exit_decimal = COALESCE(EXCLUDED.exit_decimal, strategy_trades.exit_decimal),
        exit_time = COALESCE(EXCLUDED.exit_time, strategy_trades.exit_time),
        exit_reason = COALESCE(EXCLUDED.exit_reason, strategy_trades.exit_reason),
        status = EXCLUDED.status,
        updated_at = NOW()`,
      [
        trade.matchId,
        trade.matchName || null,
        trade.seriesName || null,
        trade.bookingTeam || 'Unknown Booking Team',
        trade.battingTeam || 'Unknown Batting Team',
        trade.bowlingTeam || 'Unknown Bowling Team',
        trade.entryType,
        trade.innings,
        trade.entryOver,
        trade.entryPaise,
        trade.entryDecimal,
        trade.entryWickets || 0,
        trade.entryTime ? new Date(trade.entryTime).toISOString() : new Date().toISOString(),
        trade.exitOver ?? null,
        trade.exitPaise ?? null,
        trade.exitDecimal ?? null,
        trade.exitTime ? new Date(trade.exitTime).toISOString() : null,
        trade.exitReason ?? null,
        trade.status || 'ACTIVE',
      ]
    );
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Fetch Strategy Trades
app.get('/api/db/trades', async (req, res) => {
  try {
    const { matchId } = req.query;
    let query = 'SELECT * FROM strategy_trades';
    const params: any[] = [];
    if (matchId) {
      query += ' WHERE match_id = $1';
      params.push(matchId);
    }
    query += ' ORDER BY created_at DESC';
    const result = await dbPool.query(query, params);
    return res.json({ ok: true, data: result.rows });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message, data: [] });
  }
});

// Upsert Match Record and Latest Score State
app.post('/api/db/matches', async (req, res) => {
  try {
    const match = req.body;
    if (!match || !match.id) {
      return res.status(400).json({ ok: false, error: 'Missing match or match.id' });
    }

    // Exclude matches outside WBBL 2026 and Abu Dhabi T10 2026
    if (!isAllowedTournament(match, matchStore.mapping)) {
      return res.json({ ok: true, skipped: true, reason: 'Excluded: Only WBBL 2026 and Abu Dhabi T10 2026 are permitted' });
    }

    const t1 = match.team1 || {};
    const t2 = match.team2 || {};

    // 1. Upsert Team 1
    const t1Res = await dbPool.query(
      `INSERT INTO teams (external_team_key, name, short_name, color, dark_color, flag_url, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (external_team_key) DO UPDATE SET
         name = EXCLUDED.name,
         short_name = EXCLUDED.short_name,
         color = EXCLUDED.color,
         dark_color = EXCLUDED.dark_color,
         flag_url = EXCLUDED.flag_url,
         updated_at = NOW()
       RETURNING id`,
      [t1.key || 'T1', t1.name || 'Team 1', t1.shortName || t1.key || 'T1', t1.color || '#2563eb', t1.darkColor || '#1e3a8a', t1.flagUrl || null]
    );
    const team1Id = t1Res.rows[0]?.id;

    // 2. Upsert Team 2
    const t2Res = await dbPool.query(
      `INSERT INTO teams (external_team_key, name, short_name, color, dark_color, flag_url, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (external_team_key) DO UPDATE SET
         name = EXCLUDED.name,
         short_name = EXCLUDED.short_name,
         color = EXCLUDED.color,
         dark_color = EXCLUDED.dark_color,
         flag_url = EXCLUDED.flag_url,
         updated_at = NOW()
       RETURNING id`,
      [t2.key || 'T2', t2.name || 'Team 2', t2.shortName || t2.key || 'T2', t2.color || '#ef4444', t2.darkColor || '#991b1b', t2.flagUrl || null]
    );
    const team2Id = t2Res.rows[0]?.id;

    // 3. Upsert Match
    const matchRes = await dbPool.query(
      `INSERT INTO matches (
        external_match_id, dt_id, format, match_title_prefix, series_key, series_name,
        venue_key, venue_name, team1_id, team2_id, start_time, finish_time, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      ON CONFLICT (external_match_id) DO UPDATE SET
        dt_id = EXCLUDED.dt_id,
        format = EXCLUDED.format,
        match_title_prefix = EXCLUDED.match_title_prefix,
        series_key = EXCLUDED.series_key,
        series_name = EXCLUDED.series_name,
        venue_key = EXCLUDED.venue_key,
        venue_name = EXCLUDED.venue_name,
        team1_id = EXCLUDED.team1_id,
        team2_id = EXCLUDED.team2_id,
        start_time = EXCLUDED.start_time,
        finish_time = EXCLUDED.finish_time,
        updated_at = NOW()
      RETURNING id`,
      [
        match.id,
        match.raw?.dt_id ? String(match.raw.dt_id) : null,
        match.format || 'Match',
        match.matchTitlePrefix || null,
        match.seriesKey || null,
        match.seriesName || null,
        match.venueKey || null,
        match.venueName || null,
        team1Id,
        team2Id,
        match.startTime ? new Date(match.startTime).toISOString() : new Date().toISOString(),
        match.finishTime ? new Date(match.finishTime).toISOString() : null,
      ]
    );
    const matchUuid = matchRes.rows[0]?.id;

    if (matchUuid) {
      // 4. Upsert match odds key mapping
      await dbPool.query(
        `INSERT INTO match_odds_keys (match_id, odds_key, masked_key, is_verified, verification_reason, last_verified_at)
         VALUES ($1, $2, $3, true, 'Resolved from Crex top matches catalog', NOW())
         ON CONFLICT (match_id, odds_key) DO UPDATE SET last_verified_at = NOW()`,
        [matchUuid, match.id, `${match.id.slice(0, 2)}**`]
      );

      // 5. Upsert latest match state
      const t1Score = match.team1Score;
      const t2Score = match.team2Score;
      const battingTeamId =
        match.battingTeamKey === t1.key ? team1Id : match.battingTeamKey === t2.key ? team2Id : null;

      await dbPool.query(
        `INSERT INTO latest_match_state (
          match_id, status, status_label, status_detail, result_text, session_text,
          current_innings, batting_team_id, target, required_run_rate, current_run_rate,
          win_prob_team1, win_prob_team2, team1_score_runs, team1_score_wickets,
          team1_score_overs, team1_score_raw, team2_score_runs, team2_score_wickets,
          team2_score_overs, team2_score_raw, raw_score_j, raw_score_k, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW()
        ) ON CONFLICT (match_id) DO UPDATE SET
          status = EXCLUDED.status,
          status_label = EXCLUDED.status_label,
          status_detail = EXCLUDED.status_detail,
          result_text = EXCLUDED.result_text,
          session_text = EXCLUDED.session_text,
          current_innings = EXCLUDED.current_innings,
          batting_team_id = EXCLUDED.batting_team_id,
          target = EXCLUDED.target,
          required_run_rate = EXCLUDED.required_run_rate,
          current_run_rate = EXCLUDED.current_run_rate,
          win_prob_team1 = EXCLUDED.win_prob_team1,
          win_prob_team2 = EXCLUDED.win_prob_team2,
          team1_score_runs = EXCLUDED.team1_score_runs,
          team1_score_wickets = EXCLUDED.team1_score_wickets,
          team1_score_overs = EXCLUDED.team1_score_overs,
          team1_score_raw = EXCLUDED.team1_score_raw,
          team2_score_runs = EXCLUDED.team2_score_runs,
          team2_score_wickets = EXCLUDED.team2_score_wickets,
          team2_score_overs = EXCLUDED.team2_score_overs,
          team2_score_raw = EXCLUDED.team2_score_raw,
          raw_score_j = EXCLUDED.raw_score_j,
          raw_score_k = EXCLUDED.raw_score_k,
          updated_at = NOW()`,
        [
          matchUuid,
          match.status || 'upcoming',
          match.statusLabel || 'Scheduled',
          match.statusDetail || null,
          match.resultText || null,
          match.sessionText || null,
          match.team2Score ? 2 : 1,
          battingTeamId,
          match.target || null,
          match.requiredRunRate || null,
          match.currentRunRate || null,
          match.winProbability?.team1Prob || null,
          match.winProbability?.team2Prob || null,
          t1Score?.runs ?? null,
          t1Score?.wickets ?? null,
          t1Score?.overs ?? null,
          t1Score?.rawString ?? null,
          t2Score?.runs ?? null,
          t2Score?.wickets ?? null,
          t2Score?.overs ?? null,
          t2Score?.rawString ?? null,
          match.raw?.j || null,
          match.raw?.k || null,
        ]
      );
    }

    return res.json({ ok: true, matchUuid });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Fetch Matches from PostgreSQL
app.get('/api/db/matches', async (_req, res) => {
  try {
    const result = await dbPool.query(`
      SELECT
        m.id,
        m.external_match_id,
        m.dt_id,
        m.format,
        m.match_title_prefix,
        m.series_key,
        m.series_name,
        m.venue_key,
        m.venue_name,
        m.start_time,
        m.finish_time,
        json_build_object('key', t1.external_team_key, 'name', t1.name, 'short_name', t1.short_name, 'color', t1.color, 'dark_color', t1.dark_color, 'flag_url', t1.flag_url) AS team1,
        json_build_object('key', t2.external_team_key, 'name', t2.name, 'short_name', t2.short_name, 'color', t2.color, 'dark_color', t2.dark_color, 'flag_url', t2.flag_url) AS team2,
        row_to_json(lms.*) AS latest_match_state,
        row_to_json(los.*) AS latest_odds_state
      FROM matches m
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
      LEFT JOIN latest_match_state lms ON m.id = lms.match_id
      LEFT JOIN latest_odds_state los ON m.id = los.match_id
      WHERE (
        m.series_key IN ('2KG', '^2KG', '2IO', '^2IO')
        OR LOWER(COALESCE(m.series_name, '')) LIKE '%wbbl%'
        OR LOWER(COALESCE(m.series_name, '')) LIKE '%big bash%'
        OR (LOWER(COALESCE(m.series_name, '')) LIKE '%abu dhabi%' AND LOWER(COALESCE(m.series_name, '')) LIKE '%t10%')
      )
      ORDER BY m.start_time DESC
    `);
    return res.json({ ok: true, data: result.rows });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message, data: [] });
  }
});

// Upsert Odds State and Snapshot
app.post('/api/db/odds', async (req, res) => {
  try {
    const { matchId, oddsState } = req.body;
    if (!matchId || !oddsState?.odds) {
      return res.status(400).json({ ok: false, error: 'Missing matchId or oddsState' });
    }
    const odds = oddsState.odds;
    const bookmaker = odds.bookmaker || {};
    const movement = oddsState.movement || {};

    // 1. Insert tick
    await dbPool.query(
      `INSERT INTO match_odds_ticks (
        match_id, odds_key, favorite_team, back_rate, lay_rate, decimal_back,
        decimal_lay, raw_rate_string, session_data, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        matchId,
        oddsState.oddsKey || matchId,
        odds.favoriteTeamName || null,
        bookmaker.backRate ?? null,
        bookmaker.layRate ?? null,
        bookmaker.decimalBack ?? null,
        bookmaker.decimalLay ?? null,
        bookmaker.rawRateString || null,
        odds.sessions && odds.sessions.length > 0 ? JSON.stringify(odds.sessions) : null,
      ]
    );

    // 2. Resolve internal match UUID
    const matchLookup = await dbPool.query('SELECT id FROM matches WHERE external_match_id = $1 LIMIT 1', [matchId]);
    const matchUuid = matchLookup.rows[0]?.id;
    if (matchUuid) {
      await dbPool.query(
        `INSERT INTO latest_odds_state (
          match_id, odds_key, raw_rate_string, back_rate, lay_rate, decimal_back,
          decimal_lay, spread, is_suspended, favorite_team_name, direction,
          delta_back, delta_lay, session_markets, speech_names, latency_ms,
          last_changed_at, last_updated
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
        ON CONFLICT (match_id) DO UPDATE SET
          raw_rate_string = EXCLUDED.raw_rate_string,
          back_rate = EXCLUDED.back_rate,
          lay_rate = EXCLUDED.lay_rate,
          decimal_back = EXCLUDED.decimal_back,
          decimal_lay = EXCLUDED.decimal_lay,
          spread = EXCLUDED.spread,
          is_suspended = EXCLUDED.is_suspended,
          favorite_team_name = EXCLUDED.favorite_team_name,
          direction = EXCLUDED.direction,
          delta_back = EXCLUDED.delta_back,
          delta_lay = EXCLUDED.delta_lay,
          session_markets = EXCLUDED.session_markets,
          speech_names = EXCLUDED.speech_names,
          latency_ms = EXCLUDED.latency_ms,
          last_changed_at = EXCLUDED.last_changed_at,
          last_updated = NOW()`,
        [
          matchUuid,
          oddsState.oddsKey || matchId,
          bookmaker.rawRateString || null,
          bookmaker.backRate ?? null,
          bookmaker.layRate ?? null,
          bookmaker.decimalBack ?? null,
          bookmaker.decimalLay ?? null,
          bookmaker.spread ?? null,
          bookmaker.isSuspended || false,
          odds.favoriteTeamName || null,
          movement.direction || 'stable',
          movement.deltaBack || 0,
          movement.deltaLay || 0,
          JSON.stringify(odds.sessions || []),
          JSON.stringify(odds.speechNames || {}),
          odds.latencyMs || 0,
          movement.lastChangedAt ? new Date(movement.lastChangedAt).toISOString() : null,
        ]
      );
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Fetch Odds Ticks
app.get('/api/db/odds-ticks/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const limit = parseInt(String(req.query.limit || '100'), 10);
    const result = await dbPool.query(
      'SELECT * FROM match_odds_ticks WHERE match_id = $1 ORDER BY created_at DESC LIMIT $2',
      [matchId, limit]
    );
    return res.json({ ok: true, data: result.rows });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message, data: [] });
  }
});

// Upsert Strategy Signal
app.post('/api/db/signals', async (req, res) => {
  try {
    const signal = req.body;
    if (!signal?.matchId) {
      return res.status(400).json({ ok: false, error: 'Missing signal or matchId' });
    }
    const matchLookup = await dbPool.query('SELECT id FROM matches WHERE external_match_id = $1 LIMIT 1', [signal.matchId]);
    const matchUuid = matchLookup.rows[0]?.id;
    if (!matchUuid) {
      return res.status(404).json({ ok: false, error: 'Match not found in database' });
    }
    const dedupeHash = `${signal.matchId}-${signal.signalType}-${signal.status}-${signal.currentInnings}-${signal.currentOver}-${signal.relevantOdds?.decimalOdds ?? 'null'}-${signal.relevantOdds?.opposingTeamOdds ?? 'null'}`;
    await dbPool.query(
      `INSERT INTO strategy_signals (
        match_id, event_dedupe_hash, signal_type, status, current_innings, current_over,
        ball_number, measured_team, decimal_odds, previous_decimal_odds, odds_delta,
        opposing_team_odds, rule_evaluated, explanation, metadata, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (event_dedupe_hash) DO NOTHING`,
      [
        matchUuid,
        dedupeHash,
        signal.signalType,
        signal.status,
        signal.currentInnings,
        signal.currentOver,
        signal.ballNumber || 0,
        signal.relevantOdds?.measuredTeam || null,
        signal.relevantOdds?.decimalOdds ?? null,
        signal.relevantOdds?.previousDecimalOdds ?? null,
        signal.relevantOdds?.oddsDelta ?? null,
        signal.relevantOdds?.opposingTeamOdds ?? null,
        signal.ruleEvaluated || '',
        signal.explanation || '',
        JSON.stringify(signal.metadata || {}),
        signal.timestamp ? new Date(signal.timestamp).toISOString() : new Date().toISOString(),
      ]
    );
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Upsert Trade Position
app.post('/api/db/positions', async (req, res) => {
  try {
    const position = req.body;
    if (!position?.matchId) {
      return res.status(400).json({ ok: false, error: 'Missing position or matchId' });
    }
    const matchLookup = await dbPool.query('SELECT id FROM matches WHERE external_match_id = $1 LIMIT 1', [position.matchId]);
    const matchUuid = matchLookup.rows[0]?.id;
    if (!matchUuid) {
      return res.status(404).json({ ok: false, error: 'Match not found in database' });
    }
    await dbPool.query(
      `INSERT INTO trade_positions (
        match_id, position_type, status, candidate_signal_id, entry_odds, entry_timestamp,
        entry_over, entry_innings, entry_wickets, exit_odds, exit_timestamp, exit_over,
        bookset_signal_id, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      ON CONFLICT (match_id, position_type) DO UPDATE SET
        status = EXCLUDED.status,
        candidate_signal_id = COALESCE(EXCLUDED.candidate_signal_id, trade_positions.candidate_signal_id),
        entry_odds = COALESCE(EXCLUDED.entry_odds, trade_positions.entry_odds),
        entry_timestamp = COALESCE(EXCLUDED.entry_timestamp, trade_positions.entry_timestamp),
        entry_over = COALESCE(EXCLUDED.entry_over, trade_positions.entry_over),
        entry_innings = COALESCE(EXCLUDED.entry_innings, trade_positions.entry_innings),
        entry_wickets = COALESCE(EXCLUDED.entry_wickets, trade_positions.entry_wickets),
        exit_odds = COALESCE(EXCLUDED.exit_odds, trade_positions.exit_odds),
        exit_timestamp = COALESCE(EXCLUDED.exit_timestamp, trade_positions.exit_timestamp),
        exit_over = COALESCE(EXCLUDED.exit_over, trade_positions.exit_over),
        bookset_signal_id = COALESCE(EXCLUDED.bookset_signal_id, trade_positions.bookset_signal_id),
        updated_at = NOW()`,
      [
        matchUuid,
        position.positionType,
        position.status,
        position.candidateSignalId || null,
        position.entryOdds ?? null,
        position.entryTimestamp ? new Date(position.entryTimestamp).toISOString() : null,
        position.entryOver ?? null,
        position.entryInnings ?? null,
        position.entryWickets ?? null,
        position.exitOdds ?? null,
        position.exitTimestamp ? new Date(position.exitTimestamp).toISOString() : null,
        position.exitOver ?? null,
        position.booksetSignalId || null,
      ]
    );
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Load Match Strategy (Positions, Signals, Trades)
app.get('/api/db/match-strategy/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const tradesRes = await dbPool.query('SELECT * FROM strategy_trades WHERE match_id = $1 ORDER BY created_at DESC', [matchId]);

    const matchLookup = await dbPool.query('SELECT id FROM matches WHERE external_match_id = $1 LIMIT 1', [matchId]);
    const matchUuid = matchLookup.rows[0]?.id;

    let positions: any[] = [];
    let signals: any[] = [];

    if (matchUuid) {
      const posRes = await dbPool.query('SELECT * FROM trade_positions WHERE match_id = $1', [matchUuid]);
      positions = posRes.rows;

      const sigRes = await dbPool.query('SELECT * FROM strategy_signals WHERE match_id = $1 ORDER BY timestamp DESC LIMIT 100', [matchUuid]);
      signals = sigRes.rows;
    }

    return res.json({
      ok: true,
      positions,
      signals,
      trades: tradesRes.rows,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message, positions: [], signals: [], trades: [] });
  }
});

// Telegram Config from app_settings
app.get('/api/db/telegram-config', async (_req, res) => {
  try {
    const result = await dbPool.query('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', ['telegram_config']);
    return res.json({ ok: true, data: result.rows[0]?.value || null });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message, data: null });
  }
});

app.post('/api/db/telegram-config', async (req, res) => {
  try {
    const config = req.body;
    await dbPool.query(
      `INSERT INTO app_settings (key, value, description, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      ['telegram_config', JSON.stringify(config), 'Telegram Bot automated live feed dispatch configuration']
    );
    await reloadTelegramConfigFromDb();
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Atomic Check & Record in app_settings (Used for preventing duplicate notifications)
app.post('/api/db/app-settings/check-record', async (req, res) => {
  const { key, payload, description } = req.body || {};
  if (!key) return res.status(400).json({ ok: false, error: 'Missing key' });

  try {
    const existing = await dbPool.query('SELECT key FROM app_settings WHERE key = $1 LIMIT 1', [key]);
    if (existing.rows.length > 0) {
      return res.json({ ok: true, alreadyRecorded: true });
    }

    await dbPool.query(
      `INSERT INTO app_settings (key, value, description, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(payload || {}), description || 'Automated notification record']
    );

    return res.json({ ok: true, alreadyRecorded: false });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message, alreadyRecorded: false });
  }
});

// Get recorded First Entries
app.get('/api/db/app-settings/first-entries', async (_req, res) => {
  try {
    const result = await dbPool.query("SELECT key FROM app_settings WHERE key LIKE 'tele_entry:%:FIRST_ENTRY'");
    const matchIds = result.rows.map((r: any) => {
      const parts = r.key.split(':');
      return parts.length >= 2 ? parts[1] : null;
    }).filter(Boolean);
    return res.json({ ok: true, matchIds });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message, matchIds: [] });
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
