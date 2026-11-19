import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import pg from 'pg';
import dotenv from 'dotenv';
import { buildAdminAuthConfigFromEnv, createAdminAuth, AuthenticatedAdminRequest } from './server/adminAuth';
import {
  DEFAULT_TELEGRAM_SETTINGS,
  StoredTelegramSettings,
  buildSafeTelegramStatus,
  loadTelegramFromDb,
  resolveEffectiveTelegramToken,
  runOneTimeTelegramTokenMigration,
  saveTelegramToDb,
} from './server/telegramConfig';
import {
  createActionCooldownLimiter,
  sanitizeCountryCode,
} from './server/adminRateLimit';
import {
  AdminSiteSettings,
  DEFAULT_ADMIN_SITE_SETTINGS,
  READ_ONLY_REFRESH_INTERVALS,
  StrategyAlertsStatus,
  clearStrategyAlertsOverrideInDb,
  loadAdminSiteSettingsFromDb,
  loadStrategyAlertsStatusFromDb,
  sanitizeSeriesFilterList,
  saveAdminSiteSettingsToDb,
  saveStrategyAlertsOverrideToDb,
  toPublicSiteConfig,
} from './server/appSettingsConfig';
import { parseBookmakerRate, parseSessionMarkets, transformGetSV3Response } from './src/services/oddsApi';
import { parseInningsScore, isValidActiveSecondInningsScore } from './src/services/cricketApi';
import { resolveTeam, resolveSeries, resolveVenue } from './src/data/cricketMapping';
import { ParsedCricketMatch, ParsedInningsScore } from './src/types/cricket';
import { MatchOddsState } from './src/types/odds';
import {
  CricketStrategyEngine,
  PositionType,
  SerializedMatchStrategyState,
  StrategyPersistenceCoordinator,
  StrategySignal,
  StrategyStorageAdapter,
  StrategyTradeRecord,
  TradePosition,
  resolveExactTeamControl,
  normalizeTeamKey,
} from './src/services/strategy/index';

dotenv.config();

/**
 * Strategy Telegram Alerts Flag:
 * Env STRATEGY_ALERTS_ENABLED is the default; Admin -> Strategy can override it in
 * app_settings['strategy_alerts_config'] with immediate effect (no restart required).
 */
const ENV_STRATEGY_ALERTS_DEFAULT = process.env.STRATEGY_ALERTS_ENABLED === 'true';

let activeStrategyAlertsStatus: StrategyAlertsStatus = {
  enabled: ENV_STRATEGY_ALERTS_DEFAULT,
  source: 'env',
  envDefault: ENV_STRATEGY_ALERTS_DEFAULT,
  updatedAt: null,
};

/**
 * Dynamic Site Settings & Series Filter (stored in app_settings['public_site_config']).
 * Leave allowedSeriesFilter empty [] to track and serve EVERY live match the server sees.
 */
let activeSiteSettings: AdminSiteSettings = { ...DEFAULT_ADMIN_SITE_SETTINGS };
let ALLOWED_SERIES_FILTER: string[] = [];

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

// Server-side Admin Auth, Sessions, Rate Limiting, CSRF, CORS, and Audit Logging
const adminAuth = createAdminAuth(buildAdminAuthConfigFromEnv(process.env, dbPool));
adminAuth.logStartupStatus();

// Per-IP cap for public SSE (/api/live-stream) connections
const MAX_SSE_PER_IP = Math.max(1, parseInt(process.env.MAX_SSE_PER_IP || '20', 10) || 20);
const sseCountByIp = new Map<string, number>();

// Track timeline state across seconds and server restarts
const finalizedTimelineMatches = new Set<string>();
const startedTimelineMatches = new Set<string>();

async function ensureTimelineSchema(client: pg.PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS match_timeline_ticks (
      id BIGSERIAL PRIMARY KEY,
      match_id VARCHAR(64) NOT NULL,
      series_name VARCHAR(256),
      innings INT NOT NULL DEFAULT 1,
      overs NUMERIC(5, 1) NOT NULL DEFAULT 0.0,
      legal_ball_count INT NOT NULL DEFAULT 0,
      runs INT NOT NULL DEFAULT 0,
      wickets INT NOT NULL DEFAULT 0,
      batting_team VARCHAR(128),
      bowling_team VARCHAR(128),
      favorite_team VARCHAR(128),
      control VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
      back_rate NUMERIC(6, 2),
      lay_rate NUMERIC(6, 2),
      decimal_back NUMERIC(6, 2),
      decimal_lay NUMERIC(6, 2),
      control_team_odds NUMERIC(6, 2),
      raw_rate_string VARCHAR(64),
      session_data JSONB,
      match_status VARCHAR(32) NOT NULL DEFAULT 'live',
      result_text TEXT,
      is_new_ball BOOLEAN NOT NULL DEFAULT false,
      runs_on_ball INT NOT NULL DEFAULT 0,
      score_fetched_at TIMESTAMPTZ,
      odds_fetched_at TIMESTAMPTZ,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`ALTER TABLE match_timeline_ticks ADD COLUMN IF NOT EXISTS score_fetched_at TIMESTAMPTZ;`);
  await client.query(`ALTER TABLE match_timeline_ticks ADD COLUMN IF NOT EXISTS odds_fetched_at TIMESTAMPTZ;`);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_match_timeline_ticks_match_recorded
      ON match_timeline_ticks(match_id, recorded_at);
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_match_timeline_ticks_match_ball
      ON match_timeline_ticks(match_id, legal_ball_count);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS strategy_match_states (
      match_id VARCHAR(64) PRIMARY KEY,
      stage VARCHAR(64) NOT NULL DEFAULT 'WAITING_FOR_CONFIRMATION',
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Seed sets from existing timeline rows so restarts don't duplicate completed rows
  const completedRes = await client.query(
    `SELECT DISTINCT match_id FROM match_timeline_ticks WHERE match_status = 'completed'`
  );
  for (const row of completedRes.rows) {
    if (row.match_id) finalizedTimelineMatches.add(row.match_id);
  }
  const startedRes = await client.query(`SELECT DISTINCT match_id FROM match_timeline_ticks`);
  for (const row of startedRes.rows) {
    if (row.match_id) startedTimelineMatches.add(row.match_id);
  }
}

let isDbAvailable = false;
let dbSchemaReady = false;
let hasLoggedDbOffline = false;
let hasRehydratedOnBoot = false;
let leaderLockClient: pg.PoolClient | null = null;
let hasPgAdvisoryLock = false;
const STRATEGY_LEADER_LOCK_KEY = 84729103;

function isDbConnectionError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === '57P01' ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('Connection terminated unexpectedly')
  );
}

function releaseLeaderLockClient() {
  hasPgAdvisoryLock = false;
  if (leaderLockClient) {
    try {
      leaderLockClient.release(true);
    } catch {
      // Ignore cleanup error
    }
    leaderLockClient = null;
  }
}

async function acquireStrategyLeaderLock(): Promise<boolean> {
  if (!isDbAvailable) {
    // Fallback when DB is offline: only PM2 instance 0 (or standalone process) evaluates
    return !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
  }
  if (hasPgAdvisoryLock && leaderLockClient) {
    return true;
  }
  try {
    const client = await dbPool.connect();
    const res = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [
      STRATEGY_LEADER_LOCK_KEY,
    ]);
    if (res.rows[0]?.locked === true) {
      client.on('error', () => {
        releaseLeaderLockClient();
      });
      leaderLockClient = client;
      hasPgAdvisoryLock = true;
      return true;
    }
    client.release();
    hasPgAdvisoryLock = false;
    return false;
  } catch (err: any) {
    releaseLeaderLockClient();
    if (isDbConnectionError(err)) {
      isDbAvailable = false;
      return !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
    }
    return false;
  }
}

// Database connection verification test & schema initialization on server startup
async function testDbConnection(isRetry = false) {
  try {
    const client = await dbPool.connect();
    const res = await client.query('SELECT NOW() as now, current_database() as db_name');

    if (!dbSchemaReady) {
      await ensureTimelineSchema(client);
      await adminAuth.ensureAuthTables(client);
      await runOneTimeTelegramTokenMigration(client);
      dbSchemaReady = true;
    } else {
      await adminAuth.ensureAuthTables(client);
      await runOneTimeTelegramTokenMigration(client);
    }

    client.release();
    isDbAvailable = true;
    hasLoggedDbOffline = false;
    await reloadTelegramConfigFromDb();
    await reloadAppSettingsFromDb();
    logTelegramStartupStatusOnce();

    // Rehydrate strategy engine state from PostgreSQL without firing alerts or duplicates
    try {
      const rehydrateStats = await strategyCoordinator.rehydrateFromDatabase({
        preserveActiveMemory: hasRehydratedOnBoot || strategyCoordinator.engine.getAllMatchIds().length > 0,
      });
      hasRehydratedOnBoot = true;
      const flushStats = await strategyCoordinator.flushPendingSaves();
      console.log(
        `[Strategy Rehydration] matches=${rehydrateStats.matchesRestored} trades=${rehydrateStats.tradesRestored} positions=${rehydrateStats.positionsRestored} signals=${rehydrateStats.signalsRestored} flushedOutbox=${flushStats.flushed}`
      );
    } catch (rehydrateErr: any) {
      console.warn('[Strategy Rehydration Warning]', rehydrateErr?.message || rehydrateErr);
    }

    const safeUrl = DATABASE_URL.replace(/:([^:@]+)@/, ':****@');
    console.log(`\n======================================================`);
    console.log(`[PostgreSQL] ${isRetry ? 'Reconnection' : 'Connection'} SUCCESSFUL!`);
    console.log(`[PostgreSQL] Connected to: "${res.rows[0].db_name}" (${safeUrl})`);
    console.log(`[PostgreSQL] Series Filter: ${ALLOWED_SERIES_FILTER.length === 0 ? 'ALL LIVE MATCHES' : ALLOWED_SERIES_FILTER.join(', ')}`);
    console.log(`[PostgreSQL] Timeline Table: match_timeline_ticks READY`);
    console.log(
      `[Strategy Engine] Server-side 1s loop active | strategyAlerts=${activeStrategyAlertsStatus.enabled} (source=${activeStrategyAlertsStatus.source}, envDefault=${ENV_STRATEGY_ALERTS_DEFAULT})`
    );
    console.log(`[PostgreSQL] Server Time: ${res.rows[0].now}`);
    console.log(`======================================================\n`);
  } catch (err: any) {
    isDbAvailable = false;
    releaseLeaderLockClient();
    if (!hasLoggedDbOffline) {
      hasLoggedDbOffline = true;
      const safeUrl = DATABASE_URL.replace(/:([^:@]+)@/, ':****@');
      console.warn(`\n======================================================`);
      console.warn(`[PostgreSQL] Connection Warning: Could not connect to local PostgreSQL`);
      console.warn(`Target URL: ${safeUrl}`);
      console.warn(`Reason: ${err.message}`);
      console.warn(`Tip: Ensure PostgreSQL service is running on localhost:5432 and database "leadhunt" exists.`);
      console.warn(`The application will continue running (strategy evaluates in-memory & queues writes) and auto-retry every 15s.`);
      console.warn(`======================================================\n`);
    }
  }
}
testDbConnection(false);
setInterval(() => {
  if (!isDbAvailable) {
    void testDbConnection(true);
  }
}, 15000);

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

if (adminAuth.trustProxy) {
  app.set('trust proxy', 1);
}

// Security headers (HSTS enabled only when COOKIE_SECURE is true, keeping plain HTTP VPS reachable until HTTPS is ready)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts: adminAuth.cookieSecure,
  })
);

app.use(express.json({ limit: '256kb' }));

// Same-origin is always allowed; ALLOWED_ORIGINS controls additional cross-origin access only
app.use(adminAuth.corsMiddleware);

// Prevent search engine indexing of /admin routes at the HTTP header level
app.use(['/admin', '/admin/*'], (_req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});

const SERVER_STARTED_AT = Date.now();

// Per-action 10-second cooldown rate limiter for admin Telegram send & broadcast actions
const adminSendLimiter = createActionCooldownLimiter({ windowMs: 10_000 });

// Admin Authentication Endpoints
app.post('/api/admin/login', adminAuth.handleLogin);
app.post('/api/admin/logout', adminAuth.handleLogout);
app.get('/api/admin/me', adminAuth.handleMe);

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

// Backend Automated Telegram Broadcaster (Env-first token, zero hardcoded credentials)
const ENV_TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const ENV_TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

let dbSecretTelegramToken = '';
let hasLoggedTelegramStartupWarning = false;

let activeTelegramConfig: StoredTelegramSettings = {
  ...DEFAULT_TELEGRAM_SETTINGS,
  chatId: ENV_TELEGRAM_CHAT_ID,
};

function getEffectiveTelegramCredentials() {
  const resolved = resolveEffectiveTelegramToken(ENV_TELEGRAM_BOT_TOKEN, dbSecretTelegramToken);
  const chatId = (activeTelegramConfig.chatId || ENV_TELEGRAM_CHAT_ID || '').trim();
  return {
    ...resolved,
    chatId,
  };
}

function getSafeTelegramStatus() {
  return buildSafeTelegramStatus({
    envToken: ENV_TELEGRAM_BOT_TOKEN,
    envChatId: ENV_TELEGRAM_CHAT_ID,
    dbSecretToken: dbSecretTelegramToken,
    settings: activeTelegramConfig,
  });
}

function logTelegramStartupStatusOnce() {
  if (hasLoggedTelegramStartupWarning) return;
  hasLoggedTelegramStartupWarning = true;
  const status = getSafeTelegramStatus();
  if (!status.configured) {
    console.warn(
      `[Telegram] Not configured — set TELEGRAM_BOT_TOKEN in .env (or save a token in the Admin panel). Automated Telegram alerts remain disabled.`
    );
  } else {
    console.log(
      `[Telegram] Configured (source=${status.tokenSource}, token=****${status.tokenLast4}, enabled=${status.enabled})`
    );
  }
}

async function reloadTelegramConfigFromDb() {
  try {
    const { settings, dbSecretToken } = await loadTelegramFromDb(dbPool);
    dbSecretTelegramToken = dbSecretToken;
    if (settings) {
      activeTelegramConfig = {
        ...settings,
        chatId: settings.chatId || ENV_TELEGRAM_CHAT_ID,
      };
    }
  } catch {
    // Non-blocking if database is offline or starting up
  }
}

async function reloadAppSettingsFromDb() {
  try {
    const [loadedSite, loadedAlerts] = await Promise.all([
      loadAdminSiteSettingsFromDb(dbPool),
      loadStrategyAlertsStatusFromDb(dbPool, ENV_STRATEGY_ALERTS_DEFAULT),
    ]);
    if (loadedSite) {
      activeSiteSettings = loadedSite;
      ALLOWED_SERIES_FILTER = [...loadedSite.allowedSeriesFilter];
    }
    activeStrategyAlertsStatus = loadedAlerts;
    if (typeof strategyCoordinator !== 'undefined') {
      strategyCoordinator.setStrategyAlertsEnabled(loadedAlerts.enabled);
    }
  } catch {
    // Non-blocking if database is offline or starting up
  }
}

// Initial config hydration and background periodic refresh every 30s
Promise.all([reloadTelegramConfigFromDb(), reloadAppSettingsFromDb()]).finally(() => {
  // If DB was offline on startup, still log once after 3s so operators see Telegram status clearly
  setTimeout(logTelegramStartupStatusOnce, 3000);
});
setInterval(() => {
  void reloadTelegramConfigFromDb();
  void reloadAppSettingsFromDb();
}, 30000);

async function sendTelegramBroadcast(htmlText: string) {
  const creds = getEffectiveTelegramCredentials();
  if (!creds.configured || !creds.token || !creds.chatId || !activeTelegramConfig.enabled) {
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: creds.chatId,
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    void adminAuth.recordAdminAudit(
      'TELEGRAM_BROADCAST',
      'telegram',
      { ok: res.ok, status: res.status, messageLength: htmlText.length },
      'server'
    );
    return res.ok;
  } catch (e: any) {
    console.error('Telegram broadcast error:', e.message);
    void adminAuth.recordAdminAudit(
      'TELEGRAM_BROADCAST_ERROR',
      'telegram',
      { error: e.message || 'Unknown error', messageLength: htmlText.length },
      'server'
    );
    return false;
  }
}

// Fast in-memory caches & in-flight guards to prevent duplicate DB/Telegram dispatches
const sentOverBroadcastCache = new Set<string>();
const inFlightOverBroadcasts = new Set<string>();
const inFlightConclusions = new Set<string>();

/**
 * Checks in PostgreSQL app_settings if an over update has ALREADY been sent.
 * Uses a single atomic INSERT ... ON CONFLICT (key) DO NOTHING RETURNING key
 * so concurrent ticks or restarts can never dispatch a duplicate over alert.
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

  // 1. Fast in-memory filter + in-flight concurrency guard
  if (sentOverBroadcastCache.has(dbKey) || inFlightOverBroadcasts.has(dbKey)) {
    return false;
  }
  inFlightOverBroadcasts.add(dbKey);

  try {
    const payload = {
      matchId,
      inningIndex,
      completedOver,
      ...details,
      sentAt: new Date().toISOString(),
    };
    const insertRes = await dbPool.query(
      `INSERT INTO app_settings (key, value, description, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [dbKey, JSON.stringify(payload), `Telegram over ${completedOver} broadcast record for match ${matchId}`]
    );

    sentOverBroadcastCache.add(dbKey);
    return insertRes.rows.length > 0;
  } catch {
    sentOverBroadcastCache.add(dbKey);
    return true;
  } finally {
    inFlightOverBroadcasts.delete(dbKey);
  }
}

/**
 * Checks in PostgreSQL app_settings if a match conclusion notification has ALREADY been sent.
 * Uses a single atomic INSERT ... ON CONFLICT (key) DO NOTHING RETURNING key
 * so concurrent ticks or restarts send exactly ONE Telegram message per match result.
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

  // 1. Fast in-memory filter + in-flight concurrency guard
  if (
    finishedNotifiedMatches.has(dbKey) ||
    finishedNotifiedMatches.has(matchId) ||
    inFlightConclusions.has(dbKey)
  ) {
    return false;
  }
  inFlightConclusions.add(dbKey);

  try {
    const payload = {
      matchId,
      ...details,
      sentAt: new Date().toISOString(),
    };
    const insertRes = await dbPool.query(
      `INSERT INTO app_settings (key, value, description, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [dbKey, JSON.stringify(payload), `Telegram match concluded notification record for match ${matchId}`]
    );

    finishedNotifiedMatches.add(dbKey);
    finishedNotifiedMatches.add(matchId);
    return insertRes.rows.length > 0;
  } catch {
    finishedNotifiedMatches.add(dbKey);
    finishedNotifiedMatches.add(matchId);
    return true;
  } finally {
    inFlightConclusions.delete(dbKey);
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
      oversDecimal: 0,
      completedOvers: 0,
      ballsInOver: 0,
      legalBallCount: 0,
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
      oversDecimal: 0,
      completedOvers: 0,
      ballsInOver: 0,
      legalBallCount: 0,
      isOverComplete: false,
      runRate: 0,
    };
  }
  const runs = parseInt(match[1], 10) || 0;
  const wickets = match[2] !== undefined ? parseInt(match[2], 10) : 0;
  const oversStr = match[3] || '0';
  const oversDecimal = parseFloat(oversStr) || 0;
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
    oversDecimal,
    completedOvers,
    ballsInOver,
    legalBallCount: totalBalls,
    isOverComplete,
    runRate,
  };
}

let isGoscorerRunning = false;
let isCrexRunning = false;
let isLiveOddsRunning = false;
let isTimelineLoopRunning = false;

/**
 * Configurable Series Filter matcher (shared by live filtering & Admin preview-series).
 * If filterList is empty [], permits EVERY live match the server sees.
 */
function matchesSeriesFilter(
  item: any,
  filterList: string[],
  mapping?: { series?: any[] }
): boolean {
  if (!item) return false;
  if (filterList.length === 0) return true;

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

  const combined = `${rawQ.toLowerCase()} ${seriesName} ${mappedSeriesName} ${fName} ${fo}`.toLowerCase();
  return filterList.some((entry) => {
    const norm = entry.trim().toLowerCase();
    return norm.length > 0 && combined.includes(norm);
  });
}

function isAllowedTournament(item: any, mapping?: { series?: any[] }): boolean {
  return matchesSeriesFilter(item, ALLOWED_SERIES_FILTER, mapping);
}

// Per-match fetch timestamps, score-change timestamps, ball/run snapshots, and missed tick counters
const scoreFetchedAtByMatch = new Map<string, Date>();
const scoreChangedAtByMatch = new Map<string, Date>();
const scoreSourceByMatch = new Map<string, 'getSV3' | 'goscorer' | 'crex'>();
const lastObservedRawScoresByMatch = new Map<string, { j: string; k: string }>();
const oddsFetchedAtByMatch = new Map<string, Date>();
const missedTicksByMatch: Record<string, number> = {};
const warnedInconsistentMatches = new Set<string>();
const lastTimelineSnapshot: Record<
  string,
  { innings: number; legalBallCount: number; runs: number }
> = {};
const lastLatestStateSyncAt = new Map<string, number>();

function recordScoreObservation(
  matchId: string,
  jRaw: unknown,
  kRaw: unknown,
  fetchedAt: Date,
  source: 'getSV3' | 'goscorer' | 'crex'
) {
  scoreFetchedAtByMatch.set(matchId, fetchedAt);
  const j = typeof jRaw === 'string' ? jRaw.trim() : '';
  const k = typeof kRaw === 'string' ? kRaw.trim() : '';
  const prev = lastObservedRawScoresByMatch.get(matchId);
  if (!prev || prev.j !== j || prev.k !== k) {
    lastObservedRawScoresByMatch.set(matchId, { j, k });
    scoreChangedAtByMatch.set(matchId, fetchedAt);
    scoreSourceByMatch.set(matchId, source);
  }
}

function incrementMissedTick(matchId: string) {
  missedTicksByMatch[matchId] = (missedTicksByMatch[matchId] || 0) + 1;
}

function resolveSeriesNameFromMapping(item: any): string {
  const rawQ = String(item.q || item.seriesKey || '').replace(/^\^/, '');
  if (item.sfullname) return String(item.sfullname);
  if (item.sname) return String(item.sname);
  if (item.seriesName) return String(item.seriesName);
  const seriesArr = matchStore.mapping?.series;
  if (Array.isArray(seriesArr)) {
    const found = seriesArr.find(
      (s: any) =>
        s.f_key === rawQ ||
        s.f_key === item.q ||
        String(s.f_key).toUpperCase() === rawQ.toUpperCase()
    );
    if (found?.n || found?.sn) return String(found.n || found.sn);
  }
  return resolveSeries(rawQ || item.q) || rawQ || 'Cricket';
}

function resolveFullTeamInfo(key?: string, fallbackName?: string, fallbackShort?: string) {
  const teamsArr = matchStore.mapping?.teams;
  const cleanKey = key ? String(key).replace(/^\^/, '') : '';
  const mappedStatic = resolveTeam(key);
  let mappedDynamic: any = null;
  if (Array.isArray(teamsArr) && key) {
    mappedDynamic = teamsArr.find(
      (t: any) => t.f_key === key || t.f_key === cleanKey || t.key === key
    );
  }
  const name =
    (fallbackName && fallbackName.trim() && fallbackName !== key ? fallbackName.trim() : '') ||
    mappedDynamic?.n ||
    (mappedStatic.name !== mappedStatic.key ? mappedStatic.name : '') ||
    fallbackShort ||
    cleanKey ||
    'Team';
  const shortName =
    fallbackShort ||
    mappedDynamic?.sn ||
    mappedStatic.shortName ||
    name.slice(0, 3).toUpperCase();
  const color = mappedDynamic?.uc || mappedStatic.color || '#2563eb';
  const darkColor = mappedDynamic?.dc || mappedStatic.darkColor || '#1e3a8a';
  return { key: key || cleanKey || shortName, name, shortName, color, darkColor };
}

function isMatchFinishedItem(item: any): boolean {
  if (!item) return false;
  const resText = String(item.res || item.soResult || '').toLowerCase();
  return (
    Boolean(item.finishTime) ||
    item.d === 2 ||
    resText.includes('won by') ||
    /\bwon\b/.test(resText) ||
    resText.includes('drawn') ||
    resText.includes('tied') ||
    resText.includes('abandoned') ||
    resText.includes('no result')
  );
}

function isMatchLiveItem(item: any): boolean {
  if (!item || isMatchFinishedItem(item)) return false;
  return Boolean(item.j || item.k || item.d === 1 || item.d === 4);
}

/**
 * Unifies match score parsing, change detection, over completion broadcasts,
 * wicket alerts, and match conclusions across all data sources (Goscorer & Crex pool).
 */
async function processMatchUpdate(id: string, item: any): Promise<boolean> {
  // Enforce series filter if configured
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
      activeTelegramConfig.enabled &&
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
      activeTelegramConfig.enabled &&
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

  // Check for match conclusion (Server-authoritative, atomically DB-deduplicated)
  if (
    isFinished &&
    !finishedNotifiedMatches.has(id) &&
    !finishedNotifiedMatches.has(`tele_concluded:${id}`)
  ) {
    if (activeTelegramConfig.enabled && activeTelegramConfig.notifyResults) {
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
    } else {
      // Telegram or result alerts disabled when this match concluded: mark in-memory so enabling later won't blast old results
      finishedNotifiedMatches.add(id);
      finishedNotifiedMatches.add(`tele_concluded:${id}`);
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
      const fetchedAt = new Date();
      let hasChange = false;

      for (const [id, m] of Object.entries(data)) {
        if (!isAllowedTournament(m, matchStore.mapping)) {
          if (matchStore.matches[id]) {
            delete matchStore.matches[id];
            hasChange = true;
          }
          continue;
        }
        const rawItem = m as any;
        recordScoreObservation(
          id,
          rawItem?.j ?? matchStore.matches[id]?.j,
          rawItem?.k ?? matchStore.matches[id]?.k,
          fetchedAt,
          'goscorer'
        );
        const changed = await processMatchUpdate(id, m);
        if (changed) hasChange = true;
      }

      // Prune any existing matches if a series filter is active
      if (ALLOWED_SERIES_FILTER.length > 0) {
        for (const [id, m] of Object.entries(matchStore.matches)) {
          if (!isAllowedTournament(m, matchStore.mapping)) {
            delete matchStore.matches[id];
            hasChange = true;
          }
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
    } else {
      const liveIds = Object.keys(matchStore.matches).filter((id) => isMatchLiveItem(matchStore.matches[id]));
      for (const id of liveIds) incrementMissedTick(id);
      console.warn(
        `[Goscorer Fetch Error] status=${res.status} active_live_matches=${liveIds.join(',') || 'none'}`
      );
    }
  } catch (err: any) {
    const liveIds = Object.keys(matchStore.matches).filter((id) => isMatchLiveItem(matchStore.matches[id]));
    for (const id of liveIds) incrementMissedTick(id);
    console.warn(
      `[Goscorer Fetch Error] error=${err?.message || err} active_live_matches=${liveIds.join(',') || 'none'}`
    );
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
            const crexFetchedAt = new Date();
            for (const [id, m] of Object.entries(parsed.desktopTopMatchesRaw)) {
              if (!isAllowedTournament(m, matchStore.mapping)) {
                if (matchStore.matches[id]) {
                  delete matchStore.matches[id];
                  hasChange = true;
                }
                continue;
              }
              const rawItem = m as any;
              recordScoreObservation(
                id,
                rawItem?.j ?? matchStore.matches[id]?.j,
                rawItem?.k ?? matchStore.matches[id]?.k,
                crexFetchedAt,
                'crex'
              );
              const changed = await processMatchUpdate(id, m);
              if (changed) hasChange = true;
            }
          }

          // Prune non-allowed matches if series filter is active
          if (ALLOWED_SERIES_FILTER.length > 0) {
            for (const [mId, mObj] of Object.entries(matchStore.matches)) {
              if (!isAllowedTournament(mObj, matchStore.mapping)) {
                delete matchStore.matches[mId];
                hasChange = true;
              }
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
  } catch (err: any) {
    const liveIds = Object.keys(matchStore.matches).filter((id) => isMatchLiveItem(matchStore.matches[id]));
    for (const id of liveIds) incrementMissedTick(id);
    console.warn(
      `[Crex Pool Fetch Error] error=${err?.message || err} active_live_matches=${liveIds.join(',') || 'none'}`
    );
  } finally {
    isCrexRunning = false;
  }
}

// 3. Ultra-fast Live Match Score & Odds Sync directly from getSV3 (ball-by-ball, 1s)
async function syncLiveMatchScores() {
  if (isLiveOddsRunning) return;
  isLiveOddsRunning = true;

  try {
    const liveMatchIds = Object.keys(matchStore.matches).filter((id) =>
      isMatchLiveItem(matchStore.matches[id])
    );

    if (liveMatchIds.length === 0) return;

    await Promise.allSettled(
      liveMatchIds.slice(0, 20).map(async (key) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 1800);
          const res = await fetch(
            `https://api.goscorer.com/api/v3/getSV3?key=${encodeURIComponent(key)}&_t=${Date.now()}`,
            {
              headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                Pragma: 'no-cache',
              },
              signal: controller.signal,
            }
          );
          clearTimeout(timeout);
          if (res.ok) {
            const data = await res.json();
            const now = new Date();
            serverOddsCache.set(key, { data, timestamp: now.getTime() });
            oddsFetchedAtByMatch.set(key, now);

            if (data && matchStore.matches[key]) {
              const existing = matchStore.matches[key];
              let changed = false;
              const nextJ = data.j || existing.j;
              const nextK = data.k || existing.k;
              if (data.j || data.k || data.res) {
                recordScoreObservation(key, nextJ, nextK, now, 'getSV3');
              }
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
          } else {
            incrementMissedTick(key);
            console.warn(
              `[getSV3 Fetch Error] match_id=${key} status=${res.status} missed=${missedTicksByMatch[key]}`
            );
          }
        } catch (err: any) {
          incrementMissedTick(key);
          console.warn(
            `[getSV3 Fetch Error] match_id=${key} error=${err?.message || err} missed=${missedTicksByMatch[key]}`
          );
        }
      })
    );
  } finally {
    isLiveOddsRunning = false;
  }
}

/**
 * Resolves team control ('BATTING' | 'BOWLING' | 'UNKNOWN'), keys, and favorite info
 * from raw.F + raw.cl using STRICT exact normalized key / exact team-name matching ONLY.
 * No substring matching, no empty string matches, and no winProbability fallback.
 */
function resolveControlForMatch(
  _item: any,
  oddsData: any,
  battingTeamKey: string,
  battingTeamName: string,
  battingShort: string,
  bowlingTeamKey: string,
  bowlingTeamName: string,
  bowlingShort: string
): {
  control: 'BATTING' | 'BOWLING' | 'UNKNOWN';
  favoriteTeam: string | null;
  controlTeamKey: string | null;
  battingTeamKey: string;
  rawF: string | null;
} {
  if (!oddsData) {
    return {
      control: 'UNKNOWN',
      favoriteTeam: null,
      controlTeamKey: null,
      battingTeamKey: String(battingTeamKey || '').replace(/^\^/, '').trim(),
      rawF: null,
    };
  }

  const speechNames =
    oddsData?.speech_names && typeof oddsData.speech_names === 'object' ? oddsData.speech_names : {};
  const exact = resolveExactTeamControl({
    rawF: oddsData?.F,
    clList: Array.isArray(oddsData?.cl) ? oddsData.cl : undefined,
    speechNames,
    battingTeamKey,
    battingTeamName,
    battingTeamShortName: battingShort,
    bowlingTeamKey,
    bowlingTeamName,
    bowlingTeamShortName: bowlingShort,
  });

  return {
    control: exact.teamInControl,
    favoriteTeam: exact.controlTeamName || null,
    controlTeamKey: exact.controlTeamKey || null,
    battingTeamKey: exact.battingTeamKey,
    rawF: exact.rawF,
  };
}

/**
 * Updates latest_* snapshot tables (teams, matches, match_odds_keys, latest_match_state, latest_odds_state)
 * directly from the server so fast-read queries remain fresh even with zero browsers open.
 */
async function syncLatestStateToDb(
  matchId: string,
  item: any,
  meta: {
    seriesName: string;
    team1: { key: string; name: string; shortName: string; color: string; darkColor: string };
    team2: { key: string; name: string; shortName: string; color: string; darkColor: string };
    innings: number;
    score1: ReturnType<typeof parseScore>;
    score2: ReturnType<typeof parseScore>;
    hasInn1: boolean;
    hasInn2: boolean;
    matchStatus: string;
    resultText: string | null;
    bookmaker: ReturnType<typeof parseBookmakerRate>;
    sessions: ReturnType<typeof parseSessionMarkets>;
    favoriteTeam: string | null;
    speechNames: Record<string, string>;
    oddsData: any;
  }
) {
  const t1Res = await dbPool.query(
    `INSERT INTO teams (external_team_key, name, short_name, color, dark_color, flag_url, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (external_team_key) DO UPDATE SET
       name = EXCLUDED.name,
       short_name = EXCLUDED.short_name,
       color = EXCLUDED.color,
       dark_color = EXCLUDED.dark_color,
       updated_at = NOW()
     RETURNING id`,
    [meta.team1.key, meta.team1.name, meta.team1.shortName, meta.team1.color, meta.team1.darkColor, item.team1flag || null]
  );
  const team1Id = t1Res.rows[0]?.id;

  const t2Res = await dbPool.query(
    `INSERT INTO teams (external_team_key, name, short_name, color, dark_color, flag_url, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (external_team_key) DO UPDATE SET
       name = EXCLUDED.name,
       short_name = EXCLUDED.short_name,
       color = EXCLUDED.color,
       dark_color = EXCLUDED.dark_color,
       updated_at = NOW()
     RETURNING id`,
    [meta.team2.key, meta.team2.name, meta.team2.shortName, meta.team2.color, meta.team2.darkColor, item.team2flag || null]
  );
  const team2Id = t2Res.rows[0]?.id;

  const venueName = item.vname || resolveVenue(item.v) || null;
  const parsedStartNum = Number(item.ti ?? item.tiMs ?? item.t);
  const startTimeIso =
    !isNaN(parsedStartNum) && parsedStartNum > 0
      ? new Date(parsedStartNum).toISOString()
      : new Date().toISOString();
  const parsedFinishNum = Number(item.finishTime);
  const finishTimeIso =
    item.finishTime && !isNaN(parsedFinishNum) && parsedFinishNum > 0
      ? new Date(parsedFinishNum).toISOString()
      : null;

  const matchRes = await dbPool.query(
    `INSERT INTO matches (
      external_match_id, dt_id, format, match_title_prefix, series_key, series_name,
      venue_key, venue_name, team1_id, team2_id, start_time, finish_time, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
    ON CONFLICT (external_match_id) DO UPDATE SET
      dt_id = COALESCE(EXCLUDED.dt_id, matches.dt_id),
      format = EXCLUDED.format,
      match_title_prefix = COALESCE(EXCLUDED.match_title_prefix, matches.match_title_prefix),
      series_key = COALESCE(EXCLUDED.series_key, matches.series_key),
      series_name = COALESCE(EXCLUDED.series_name, matches.series_name),
      venue_key = COALESCE(EXCLUDED.venue_key, matches.venue_key),
      venue_name = COALESCE(EXCLUDED.venue_name, matches.venue_name),
      team1_id = COALESCE(EXCLUDED.team1_id, matches.team1_id),
      team2_id = COALESCE(EXCLUDED.team2_id, matches.team2_id),
      finish_time = COALESCE(EXCLUDED.finish_time, matches.finish_time),
      updated_at = NOW()
    RETURNING id`,
    [
      matchId,
      item.dt_id ? String(item.dt_id) : null,
      item.fo || item.t || 'Match',
      item.matchNums ? `${item.matchNums} ${item.fo || 'Match'}` : item.fo || null,
      item.q ? String(item.q) : null,
      meta.seriesName,
      item.v ? String(item.v) : null,
      venueName,
      team1Id,
      team2Id,
      startTimeIso,
      finishTimeIso,
    ]
  );
  const matchUuid = matchRes.rows[0]?.id;
  if (!matchUuid) return;

  await dbPool.query(
    `INSERT INTO match_odds_keys (match_id, odds_key, masked_key, is_verified, verification_reason, last_verified_at)
     VALUES ($1, $2, $3, true, 'Synced by server 1s loop', NOW())
     ON CONFLICT (match_id, odds_key) DO UPDATE SET last_verified_at = NOW()`,
    [matchUuid, matchId, `${matchId.slice(0, 2)}**`]
  );

  const battingTeamId = meta.innings === 2 ? team2Id : team1Id;
  const activeRunRate = meta.innings === 2 ? meta.score2.runRate : meta.score1.runRate;
  const statusLabel =
    meta.matchStatus === 'completed'
      ? 'Finished'
      : meta.matchStatus === 'live'
      ? 'LIVE'
      : 'Scheduled';

  await dbPool.query(
    `INSERT INTO latest_match_state (
      match_id, status, status_label, status_detail, result_text, session_text,
      current_innings, batting_team_id, current_run_rate,
      team1_score_runs, team1_score_wickets, team1_score_overs, team1_score_raw,
      team2_score_runs, team2_score_wickets, team2_score_overs, team2_score_raw,
      raw_score_j, raw_score_k, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW()
    ) ON CONFLICT (match_id) DO UPDATE SET
      status = EXCLUDED.status,
      status_label = EXCLUDED.status_label,
      status_detail = EXCLUDED.status_detail,
      result_text = EXCLUDED.result_text,
      session_text = EXCLUDED.session_text,
      current_innings = EXCLUDED.current_innings,
      batting_team_id = EXCLUDED.batting_team_id,
      current_run_rate = EXCLUDED.current_run_rate,
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
      meta.matchStatus,
      statusLabel,
      item.res || item.soResult || null,
      meta.resultText,
      item.sessionText || null,
      meta.innings,
      battingTeamId,
      activeRunRate,
      meta.hasInn1 ? meta.score1.runs : null,
      meta.hasInn1 ? meta.score1.wickets : null,
      meta.hasInn1 ? meta.score1.oversDecimal : null,
      item.j || null,
      meta.hasInn2 ? meta.score2.runs : null,
      meta.hasInn2 ? meta.score2.wickets : null,
      meta.hasInn2 ? meta.score2.oversDecimal : null,
      item.k || null,
      item.j || null,
      item.k || null,
    ]
  );

  if (meta.oddsData) {
    await dbPool.query(
      `INSERT INTO latest_odds_state (
        match_id, odds_key, raw_rate_string, back_rate, lay_rate, decimal_back,
        decimal_lay, spread, is_suspended, favorite_team_name, session_markets,
        speech_names, last_updated
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      ON CONFLICT (match_id) DO UPDATE SET
        raw_rate_string = EXCLUDED.raw_rate_string,
        back_rate = EXCLUDED.back_rate,
        lay_rate = EXCLUDED.lay_rate,
        decimal_back = EXCLUDED.decimal_back,
        decimal_lay = EXCLUDED.decimal_lay,
        spread = EXCLUDED.spread,
        is_suspended = EXCLUDED.is_suspended,
        favorite_team_name = EXCLUDED.favorite_team_name,
        session_markets = EXCLUDED.session_markets,
        speech_names = EXCLUDED.speech_names,
        last_updated = NOW()`,
      [
        matchUuid,
        matchId,
        meta.bookmaker.rawRateString || null,
        meta.bookmaker.backRate ?? null,
        meta.bookmaker.layRate ?? null,
        meta.bookmaker.decimalBack ?? null,
        meta.bookmaker.decimalLay ?? null,
        meta.bookmaker.spread ?? null,
        meta.bookmaker.isSuspended,
        meta.favoriteTeam,
        JSON.stringify(meta.sessions || []),
        JSON.stringify(meta.speechNames || {}),
      ]
    );
  }
}

// Live parsed odds cache per matchId (shared with strategy engine and SSE clients)
const serverParsedOddsCache = new Map<string, MatchOddsState>();

function mapTradeRow(row: any): StrategyTradeRecord {
  const bookingTeamStr = String(row.booking_team || '');
  const isManual = /^\[?MANUAL\]?/i.test(bookingTeamStr);
  return {
    id: String(row.id),
    matchId: row.match_id,
    matchName: row.match_name || undefined,
    seriesName: row.series_name || undefined,
    bookingTeam: row.booking_team,
    battingTeam: row.batting_team,
    bowlingTeam: row.bowling_team,
    entryType: row.entry_type,
    innings: Number(row.innings),
    entryOver: Number(row.entry_over),
    entryPaise: Number(row.entry_paise),
    entryDecimal: Number(row.entry_decimal),
    entryWickets: Number(row.entry_wickets || 0),
    entryTime: new Date(row.entry_time),
    exitOver: row.exit_over !== null && row.exit_over !== undefined ? Number(row.exit_over) : undefined,
    exitPaise: row.exit_paise !== null && row.exit_paise !== undefined ? Number(row.exit_paise) : undefined,
    exitDecimal:
      row.exit_decimal !== null && row.exit_decimal !== undefined ? Number(row.exit_decimal) : undefined,
    exitTime: row.exit_time ? new Date(row.exit_time) : undefined,
    exitReason: row.exit_reason || undefined,
    status: row.status,
    isManual,
    source: isManual ? 'MANUAL' : 'AUTO',
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapPositionRow(p: any, externalMatchId?: string): TradePosition {
  return {
    id: String(p.id),
    matchId: externalMatchId || p.external_match_id || p.match_id,
    positionType: p.position_type,
    status: p.status,
    candidateSignalId: p.candidate_signal_id || undefined,
    entryOdds: p.entry_odds !== null && p.entry_odds !== undefined ? Number(p.entry_odds) : undefined,
    entryTimestamp: p.entry_timestamp ? new Date(p.entry_timestamp) : undefined,
    entryOver: p.entry_over !== null && p.entry_over !== undefined ? Number(p.entry_over) : undefined,
    entryInnings: p.entry_innings !== null && p.entry_innings !== undefined ? Number(p.entry_innings) : undefined,
    entryWickets: p.entry_wickets !== null && p.entry_wickets !== undefined ? Number(p.entry_wickets) : undefined,
    exitOdds: p.exit_odds !== null && p.exit_odds !== undefined ? Number(p.exit_odds) : undefined,
    exitTimestamp: p.exit_timestamp ? new Date(p.exit_timestamp) : undefined,
    exitOver: p.exit_over !== null && p.exit_over !== undefined ? Number(p.exit_over) : undefined,
    booksetSignalId: p.bookset_signal_id || undefined,
  };
}

function mapSignalRow(s: any, externalMatchId?: string): StrategySignal {
  return {
    id: String(s.id),
    signalType: s.signal_type,
    matchId: externalMatchId || s.external_match_id || s.match_id,
    timestamp: new Date(s.timestamp),
    currentInnings: Number(s.current_innings),
    currentOver: Number(s.current_over),
    ballNumber: Number(s.ball_number || 0),
    relevantOdds: {
      measuredTeam: s.measured_team || '',
      decimalOdds: s.decimal_odds !== null && s.decimal_odds !== undefined ? Number(s.decimal_odds) : null,
      previousDecimalOdds:
        s.previous_decimal_odds !== null && s.previous_decimal_odds !== undefined
          ? Number(s.previous_decimal_odds)
          : null,
      oddsDelta: s.odds_delta !== null && s.odds_delta !== undefined ? Number(s.odds_delta) : null,
      opposingTeamOdds:
        s.opposing_team_odds !== null && s.opposing_team_odds !== undefined
          ? Number(s.opposing_team_odds)
          : null,
    },
    ruleEvaluated: s.rule_evaluated || '',
    status: s.status,
    explanation: s.explanation || '',
    metadata: s.metadata || {},
  };
}

async function ensureMatchUuidForStrategy(
  externalMatchId: string,
  contextMatch?: ParsedCricketMatch
): Promise<string | null> {
  const existing = await dbPool.query(
    'SELECT id FROM matches WHERE external_match_id = $1 LIMIT 1',
    [externalMatchId]
  );
  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const rawItem = matchStore.matches[externalMatchId];
  if (!contextMatch && !rawItem) {
    return null;
  }

  const t1 = contextMatch?.team1 || resolveFullTeamInfo(rawItem?.b, rawItem?.t1Name || rawItem?.team1, rawItem?.t1Sname);
  const t2 = contextMatch?.team2 || resolveFullTeamInfo(rawItem?.c, rawItem?.t2Name || rawItem?.team2, rawItem?.t2Sname);

  const t1Res = await dbPool.query(
    `INSERT INTO teams (external_team_key, name, short_name, color, dark_color, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (external_team_key) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
     RETURNING id`,
    [t1.key || 'T1', t1.name || 'Team 1', t1.shortName || 'T1', t1.color || '#2563eb', t1.darkColor || '#1e3a8a']
  );
  const t2Res = await dbPool.query(
    `INSERT INTO teams (external_team_key, name, short_name, color, dark_color, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (external_team_key) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
     RETURNING id`,
    [t2.key || 'T2', t2.name || 'Team 2', t2.shortName || 'T2', t2.color || '#ef4444', t2.darkColor || '#991b1b']
  );

  const format = contextMatch?.format || rawItem?.fo || 'Match';
  const seriesName = contextMatch?.seriesName || (rawItem ? resolveSeriesNameFromMapping(rawItem) : 'Cricket');
  const rawStartNum = Number(rawItem?.ti ?? rawItem?.tiMs ?? rawItem?.t);
  const startTimeIso = contextMatch?.startTime
    ? new Date(contextMatch.startTime).toISOString()
    : !isNaN(rawStartNum) && rawStartNum > 0
    ? new Date(rawStartNum).toISOString()
    : new Date().toISOString();

  const matchRes = await dbPool.query(
    `INSERT INTO matches (
       external_match_id, format, series_name, team1_id, team2_id, start_time, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (external_match_id) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [externalMatchId, format, seriesName, t1Res.rows[0]?.id, t2Res.rows[0]?.id, startTimeIso]
  );
  return matchRes.rows[0]?.id || null;
}

async function upsertTradeIdempotent(trade: StrategyTradeRecord): Promise<void> {
  await dbPool.query(
    `INSERT INTO strategy_trades (
      match_id, match_name, series_name, booking_team, batting_team, bowling_team,
      entry_type, innings, entry_over, entry_paise, entry_decimal, entry_wickets,
      entry_time, exit_over, exit_paise, exit_decimal, exit_time, exit_reason,
      status, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
    ON CONFLICT (match_id, entry_type) DO UPDATE SET
      match_name = COALESCE(strategy_trades.match_name, EXCLUDED.match_name),
      series_name = COALESCE(strategy_trades.series_name, EXCLUDED.series_name),
      booking_team = COALESCE(NULLIF(strategy_trades.booking_team, ''), EXCLUDED.booking_team),
      batting_team = COALESCE(NULLIF(strategy_trades.batting_team, ''), EXCLUDED.batting_team),
      bowling_team = COALESCE(NULLIF(strategy_trades.bowling_team, ''), EXCLUDED.bowling_team),
      exit_over = CASE
        WHEN strategy_trades.status = 'BOOKSET_COMPLETED' THEN strategy_trades.exit_over
        ELSE COALESCE(EXCLUDED.exit_over, strategy_trades.exit_over)
      END,
      exit_paise = CASE
        WHEN strategy_trades.status = 'BOOKSET_COMPLETED' THEN strategy_trades.exit_paise
        ELSE COALESCE(EXCLUDED.exit_paise, strategy_trades.exit_paise)
      END,
      exit_decimal = CASE
        WHEN strategy_trades.status = 'BOOKSET_COMPLETED' THEN strategy_trades.exit_decimal
        ELSE COALESCE(EXCLUDED.exit_decimal, strategy_trades.exit_decimal)
      END,
      exit_time = CASE
        WHEN strategy_trades.status = 'BOOKSET_COMPLETED' THEN strategy_trades.exit_time
        ELSE COALESCE(EXCLUDED.exit_time, strategy_trades.exit_time)
      END,
      exit_reason = CASE
        WHEN strategy_trades.status = 'BOOKSET_COMPLETED' THEN strategy_trades.exit_reason
        ELSE COALESCE(EXCLUDED.exit_reason, strategy_trades.exit_reason)
      END,
      status = CASE
        WHEN strategy_trades.status = 'BOOKSET_COMPLETED' THEN 'BOOKSET_COMPLETED'
        ELSE EXCLUDED.status
      END,
      updated_at = NOW()
    WHERE strategy_trades.status IS DISTINCT FROM 'BOOKSET_COMPLETED'
      AND (
        EXCLUDED.status = 'BOOKSET_COMPLETED'
        OR strategy_trades.match_name IS NULL
      )`,
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
}

const pgStrategyStorageAdapter: StrategyStorageAdapter = {
  async loadAllSnapshots(): Promise<SerializedMatchStrategyState[]> {
    const res = await dbPool.query(`SELECT state FROM strategy_match_states`);
    return res.rows.map((r: any) => r.state as SerializedMatchStrategyState).filter(Boolean);
  },

  async loadAllTrades(): Promise<StrategyTradeRecord[]> {
    const res = await dbPool.query(`SELECT * FROM strategy_trades ORDER BY created_at ASC`);
    return res.rows.map(mapTradeRow);
  },

  async loadAllPositions(): Promise<TradePosition[]> {
    const res = await dbPool.query(
      `SELECT tp.*, m.external_match_id
       FROM trade_positions tp
       JOIN matches m ON tp.match_id = m.id`
    );
    return res.rows.map((r: any) => mapPositionRow(r, r.external_match_id));
  },

  async loadRecentSignals(limit = 2000): Promise<StrategySignal[]> {
    const res = await dbPool.query(
      `SELECT ss.*, m.external_match_id
       FROM strategy_signals ss
       JOIN matches m ON ss.match_id = m.id
       ORDER BY ss.timestamp DESC
       LIMIT $1`,
      [limit]
    );
    return res.rows.map((r: any) => mapSignalRow(r, r.external_match_id));
  },

  async upsertTrade(trade: StrategyTradeRecord): Promise<void> {
    await upsertTradeIdempotent(trade);
  },

  async upsertPosition(position: TradePosition, context?: { match?: ParsedCricketMatch }): Promise<void> {
    const matchUuid = await ensureMatchUuidForStrategy(position.matchId, context?.match);
    if (!matchUuid) {
      throw new Error(`Match UUID unavailable for position ${position.matchId}`);
    }
    await dbPool.query(
      `INSERT INTO trade_positions (
        match_id, position_type, status, candidate_signal_id, entry_odds, entry_timestamp,
        entry_over, entry_innings, entry_wickets, exit_odds, exit_timestamp, exit_over,
        bookset_signal_id, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      ON CONFLICT (match_id, position_type) DO UPDATE SET
        status = CASE
          WHEN trade_positions.status = 'RECORDED_EXIT' THEN 'RECORDED_EXIT'
          ELSE EXCLUDED.status
        END,
        candidate_signal_id = COALESCE(trade_positions.candidate_signal_id, EXCLUDED.candidate_signal_id),
        entry_odds = COALESCE(trade_positions.entry_odds, EXCLUDED.entry_odds),
        entry_timestamp = COALESCE(trade_positions.entry_timestamp, EXCLUDED.entry_timestamp),
        entry_over = COALESCE(trade_positions.entry_over, EXCLUDED.entry_over),
        entry_innings = COALESCE(trade_positions.entry_innings, EXCLUDED.entry_innings),
        entry_wickets = COALESCE(trade_positions.entry_wickets, EXCLUDED.entry_wickets),
        exit_odds = COALESCE(trade_positions.exit_odds, EXCLUDED.exit_odds),
        exit_timestamp = COALESCE(trade_positions.exit_timestamp, EXCLUDED.exit_timestamp),
        exit_over = COALESCE(trade_positions.exit_over, EXCLUDED.exit_over),
        bookset_signal_id = COALESCE(trade_positions.bookset_signal_id, EXCLUDED.bookset_signal_id),
        updated_at = NOW()
      WHERE trade_positions.status IS DISTINCT FROM 'RECORDED_EXIT'`,
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
  },

  async insertSignal(
    signal: StrategySignal,
    dedupeHash: string,
    context?: { match?: ParsedCricketMatch }
  ): Promise<void> {
    const matchUuid = await ensureMatchUuidForStrategy(signal.matchId, context?.match);
    if (!matchUuid) {
      throw new Error(`Match UUID unavailable for signal ${signal.matchId}`);
    }
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
  },

  async upsertSnapshot(snapshot: SerializedMatchStrategyState): Promise<void> {
    await dbPool.query(
      `INSERT INTO strategy_match_states (match_id, stage, state, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (match_id) DO UPDATE SET
         stage = EXCLUDED.stage,
         state = EXCLUDED.state,
         updated_at = NOW()`,
      [snapshot.matchId, snapshot.stage, JSON.stringify(snapshot)]
    );
  },

  async deleteMatchStrategy(matchId: string): Promise<void> {
    await dbPool.query('DELETE FROM strategy_match_states WHERE match_id = $1', [matchId]);
    await dbPool.query('DELETE FROM strategy_trades WHERE match_id = $1', [matchId]);
    const matchLookup = await dbPool.query('SELECT id FROM matches WHERE external_match_id = $1 LIMIT 1', [matchId]);
    const matchUuid = matchLookup.rows[0]?.id;
    if (matchUuid) {
      await dbPool.query('DELETE FROM trade_positions WHERE match_id = $1', [matchUuid]);
      await dbPool.query('DELETE FROM strategy_signals WHERE match_id = $1', [matchUuid]);
    }
  },
};

const strategyCoordinator = new StrategyPersistenceCoordinator({
  engine: new CricketStrategyEngine(),
  storage: pgStrategyStorageAdapter,
  strategyAlertsEnabled: activeStrategyAlertsStatus.enabled,
  onStrategyAlert: async ({ kind, trade, match }) => {
    if (!activeStrategyAlertsStatus.enabled) return;
    if (!activeTelegramConfig.enabled || !activeTelegramConfig.notifyStrategyEntries) return;

    const dbKey = `tele_strategy:${trade.matchId}:${trade.entryType}:${trade.status}`;
    try {
      const existing = await dbPool.query('SELECT key FROM app_settings WHERE key = $1 LIMIT 1', [dbKey]);
      if (existing.rows.length > 0) return;

      await dbPool.query(
        `INSERT INTO app_settings (key, value, description, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO NOTHING`,
        [
          dbKey,
          JSON.stringify({ matchId: trade.matchId, entryType: trade.entryType, status: trade.status, sentAt: new Date().toISOString() }),
          `Strategy ${trade.entryType} ${kind} alert`,
        ]
      );
    } catch {
      // Non-blocking if DB unavailable
    }

    const label = match
      ? `${match.team1.shortName} vs ${match.team2.shortName}`
      : trade.matchName || trade.matchId;
    const msg =
      kind === 'ENTRY'
        ? `🎯 <b>${trade.entryType === 'FIRST_ENTRY' ? 'FIRST ENTRY' : 'SECOND ENTRY'} RECORDED</b>\n` +
          `🏏 <b>${label}</b>\n` +
          `🔹 Booking: <b>${trade.bookingTeam}</b>\n` +
          `💰 Entry: <b>${trade.entryPaise} paise</b> (${trade.entryDecimal.toFixed(2)}) @ ${trade.entryOver} ov (Inn ${trade.innings})`
        : `✅ <b>BOOKSET EXIT RECORDED (${trade.entryType})</b>\n` +
          `🏏 <b>${label}</b>\n` +
          `💰 Exit: <b>${trade.exitPaise ?? ''} paise</b> (${trade.exitDecimal?.toFixed(2) ?? ''}) @ ${trade.exitOver ?? ''} ov\n` +
          `📌 Reason: <code>${trade.exitReason || 'BOOKSET'}</code>`;

    await sendTelegramBroadcast(msg);
  },
});

function buildServerInningsScore(
  parsed: ReturnType<typeof parseScore>,
  rawStr: string | undefined,
  inningIndex: number,
  teamCode: string
): ParsedInningsScore | undefined {
  if (!rawStr || !String(rawStr).trim()) return undefined;
  const validated = parseInningsScore(String(rawStr), inningIndex);
  if (!validated) return undefined;
  if (
    inningIndex === 2 &&
    !(
      validated.overs > 0 ||
      validated.totalBalls > 0 ||
      validated.completedOvers > 0 ||
      validated.ballsInOver > 0
    )
  ) {
    return undefined;
  }
  return {
    inningIndex,
    runs: validated.runs,
    wickets: validated.wickets,
    overs: validated.overs,
    completedOvers: validated.completedOvers,
    ballsInOver: validated.ballsInOver,
    totalBalls: parsed.legalBallCount > 0 ? parsed.legalBallCount : validated.totalBalls,
    runRate: validated.runRate || parsed.runRate,
    rawString: String(rawStr),
    teamCode,
  };
}

function buildSnapshotForEvaluation(
  matchId: string,
  item: any,
  meta: {
    seriesName: string;
    team1: { key: string; name: string; shortName: string; color: string; darkColor: string };
    team2: { key: string; name: string; shortName: string; color: string; darkColor: string };
    innings: number;
    score1: ReturnType<typeof parseScore>;
    score2: ReturnType<typeof parseScore>;
    hasInn1: boolean;
    hasInn2: boolean;
    matchStatus: 'live' | 'completed' | 'upcoming';
    resultText: string | null;
    oddsData: any;
    oddsFetchedAt: Date | null;
    isFinished: boolean;
  }
): {
  parsedMatch: ParsedCricketMatch;
  parsedOddsState: MatchOddsState;
  isStale: boolean;
} {
  const inn1 = meta.hasInn1
    ? buildServerInningsScore(meta.score1, item.j, 1, meta.team1.shortName)
    : undefined;
  const inn2 = meta.hasInn2
    ? buildServerInningsScore(meta.score2, item.k, 2, meta.team2.shortName)
    : undefined;
  const inningsList: ParsedInningsScore[] = [];
  if (inn1) inningsList.push(inn1);
  if (inn2) inningsList.push(inn2);

  const parsedMatch: ParsedCricketMatch = {
    id: matchId,
    team1: {
      key: meta.team1.key,
      name: meta.team1.name,
      shortName: meta.team1.shortName,
      color: meta.team1.color,
      darkColor: meta.team1.darkColor,
      flagUrl: item.team1flag || undefined,
    },
    team2: {
      key: meta.team2.key,
      name: meta.team2.name,
      shortName: meta.team2.shortName,
      color: meta.team2.color,
      darkColor: meta.team2.darkColor,
      flagUrl: item.team2flag || undefined,
    },
    seriesName: meta.seriesName,
    seriesKey: item.q ? String(item.q) : '',
    venueName: item.vname || resolveVenue(item.v) || 'Stadium',
    venueKey: item.v ? String(item.v) : '',
    format: String(item.fo || item.t || 'Match'),
    matchTitlePrefix: item.matchNums ? `${item.matchNums} ${item.fo || 'Match'}` : item.fo || undefined,
    innings: inningsList,
    team1Score: inn1,
    team2Score: inn2,
    status: meta.isFinished ? 'completed' : 'live',
    statusLabel: meta.resultText || (meta.isFinished ? 'Finished' : 'Live'),
    resultText: meta.resultText || undefined,
    sessionText: typeof item.s === 'string' ? item.s : undefined,
    startTime: (() => {
      const n = Number(item.ti ?? item.tiMs ?? item.t);
      return !isNaN(n) && n > 0 ? new Date(n) : new Date();
    })(),
    finishTime: (() => {
      const n = Number(item.finishTime);
      return item.finishTime && !isNaN(n) && n > 0 ? new Date(n) : undefined;
    })(),
    currentRunRate: meta.innings === 2 ? meta.score2.runRate : meta.score1.runRate,
    battingTeamKey: meta.innings === 2 ? meta.team2.key : meta.team1.key,
    odds: item.flb,
    raw: item,
  };

  const prevParsedOddsState = serverParsedOddsCache.get(matchId);
  // Strictly require a real getSV3 odds payload; never fall back to item.flb
  const hasGetSV3Odds = Boolean(meta.oddsData);
  const parsedOdds = hasGetSV3Odds ? transformGetSV3Response(matchId, meta.oddsData, 0) : null;
  if (parsedOdds && meta.oddsFetchedAt) {
    parsedOdds.timestamp = meta.oddsFetchedAt;
  }

  const prevBookmaker = prevParsedOddsState?.odds?.bookmaker || null;
  let movement = prevParsedOddsState?.movement || {
    direction: 'stable' as const,
    deltaBack: 0,
    deltaLay: 0,
  };
  if (
    parsedOdds &&
    prevBookmaker &&
    prevBookmaker.backRate !== null &&
    parsedOdds.bookmaker.backRate !== null
  ) {
    const deltaBack = parsedOdds.bookmaker.backRate - prevBookmaker.backRate;
    const deltaLay =
      (parsedOdds.bookmaker.layRate ?? parsedOdds.bookmaker.backRate) -
      (prevBookmaker.layRate ?? prevBookmaker.backRate);
    const direction = deltaBack > 0 ? 'up' : deltaBack < 0 ? 'down' : 'stable';
    if (direction !== 'stable' || deltaBack !== 0 || deltaLay !== 0) {
      movement = {
        direction,
        deltaBack,
        deltaLay,
        lastChangedAt: new Date(),
      };
    }
  }

  const parsedOddsState: MatchOddsState = {
    matchId,
    oddsKey: matchId,
    maskedKey: matchId.length > 2 ? `${matchId.slice(0, 2)}${'*'.repeat(matchId.length - 2)}` : matchId,
    status: parsedOdds && !parsedOdds.bookmaker.isSuspended ? 'success' : 'unavailable',
    odds: parsedOdds,
    previousOdds: prevParsedOddsState?.odds || null,
    movement,
    recordsCount: (prevParsedOddsState?.recordsCount || 0) + (hasGetSV3Odds ? 1 : 0),
    lastUpdated: meta.oddsFetchedAt || new Date(),
    oddsFetchedAt: hasGetSV3Odds ? meta.oddsFetchedAt : null,
    oddsSource: hasGetSV3Odds ? 'getSV3' : 'none',
    consistency: {
      isConsistent: true,
      status: hasGetSV3Odds ? 'verified' : 'unverified',
      reason: hasGetSV3Odds ? 'Server 1s getSV3 snapshot' : 'No getSV3 snapshot available',
    },
  };

  if (parsedOdds) {
    serverParsedOddsCache.set(matchId, parsedOddsState);
  }

  const isStale =
    !hasGetSV3Odds || !meta.oddsFetchedAt || Date.now() - meta.oddsFetchedAt.getTime() > 15000;

  return { parsedMatch, parsedOddsState, isStale };
}

function getSerializedOddsMap(): Record<string, MatchOddsState> {
  const out: Record<string, MatchOddsState> = {};
  for (const [id, st] of serverParsedOddsCache.entries()) {
    out[id] = st;
  }
  return out;
}

/**
 * Phase 1 & 2: Append-Only 1-Second Server Timeline Persistence + Unified Server Strategy Loop
 * Uses the exact same per-second score & odds snapshot for both match_timeline_ticks and strategy evaluation.
 * Leader-locked via PostgreSQL advisory lock (and NODE_APP_INSTANCE fallback when offline).
 */
async function persistLiveTimelineTicks() {
  if (isTimelineLoopRunning) return;
  isTimelineLoopRunning = true;

  try {
    const isLeader = await acquireStrategyLeaderLock();
    if (!isLeader) return;

    // Ensure initial DB state rehydration completes before running any strategy tick when DB is up
    if (isDbAvailable && !hasRehydratedOnBoot) {
      try {
        await strategyCoordinator.rehydrateFromDatabase({
          preserveActiveMemory: strategyCoordinator.engine.getAllMatchIds().length > 0,
        });
        hasRehydratedOnBoot = true;
      } catch (err: any) {
        console.warn('[Strategy Boot Rehydration Warning]', err?.message || err);
      }
    }

    // Flush any queued offline trades/positions/signals/states when DB is available
    if (isDbAvailable && strategyCoordinator.getPendingCounts().total > 0) {
      await strategyCoordinator.flushPendingSaves();
    }

    const entries = Object.entries(matchStore.matches);
    if (entries.length === 0) return;

    let anyLiveEvaluated = false;

    await Promise.allSettled(
      entries.map(async ([matchId, item]) => {
        try {
          if (!item || !isAllowedTournament(item, matchStore.mapping)) return;

          const isFinished = isMatchFinishedItem(item);
          const isLive = isMatchLiveItem(item);

          // Skip upcoming matches that haven't started, and skip matches already finalized in timeline
          if (isFinished) {
            if (finalizedTimelineMatches.has(matchId)) return;
            if (!startedTimelineMatches.has(matchId) && !lastTimelineSnapshot[matchId]) return;
          } else if (!isLive) {
            return;
          }

          anyLiveEvaluated = true;

          const team1 = resolveFullTeamInfo(item.b, item.t1Name || item.team1, item.t1Sname);
          const team2 = resolveFullTeamInfo(item.c, item.t2Name || item.team2, item.t2Sname);
          const seriesName = resolveSeriesNameFromMapping(item);

          // Strict innings detection: item.k only starts 2nd innings if it parses as a real score AND overs/balls > 0
          const hasInn1 = Boolean(parseInningsScore(item.j, 1));
          const hasInn2 = Boolean(isValidActiveSecondInningsScore(item.k));
          const innings = hasInn2 ? 2 : 1;

          const score1 = parseScore(item.j);
          const score2 = parseScore(item.k);
          const activeScore = innings === 2 ? score2 : score1;

          const battingTeamObj = innings === 2 ? team2 : team1;
          const bowlingTeamObj = innings === 2 ? team1 : team2;

          // Log a warning once per match if team order or innings metadata looks inconsistent
          if (!warnedInconsistentMatches.has(matchId)) {
            const kTrimmed = typeof item.k === 'string' ? item.k.trim() : '';
            const relFkeyNorm = item.relevant_team_fkey ? normalizeTeamKey(String(item.relevant_team_fkey)) : '';
            const batNorm = normalizeTeamKey(battingTeamObj.key);
            const t1Norm = normalizeTeamKey(team1.key);
            const t2Norm = normalizeTeamKey(team2.key);
            const issues: string[] = [];
            if (hasInn2 && !hasInn1) issues.push(`hasInn2=true but item.j invalid ("${item.j ?? ''}")`);
            if (!t1Norm || !t2Norm || t1Norm === t2Norm) issues.push(`suspicious team keys t1="${team1.key}" t2="${team2.key}"`);
            if (relFkeyNorm && batNorm && relFkeyNorm !== batNorm) {
              issues.push(`relevant_team_fkey="${item.relevant_team_fkey}" disagrees with innings=${innings} battingTeam="${battingTeamObj.key}"`);
            }
            if (!hasInn2 && kTrimmed && kTrimmed !== '-' && !/^yet to bat$/i.test(kTrimmed) && !/^0\/0\(0(?:\.0)?\)$/.test(kTrimmed)) {
              const kParsed = parseInningsScore(kTrimmed, 2);
              if (!kParsed || (kParsed.overs === 0 && kParsed.totalBalls === 0 && kParsed.runs > 0)) {
                issues.push(`unusual item.k="${kTrimmed}" treated as Inn 1`);
              }
            }
            if (issues.length > 0) {
              warnedInconsistentMatches.add(matchId);
              console.warn(
                `[Team/Innings Metadata Warning] match_id=${matchId} (${team1.shortName} vs ${team2.shortName}) innings=${innings} item.b="${item.b}" item.c="${item.c}" item.j="${item.j ?? ''}" item.k="${item.k ?? ''}": ${issues.join('; ')}`
              );
            }
          }

          const cachedOdds = serverOddsCache.get(matchId);
          const oddsData = cachedOdds?.data || null;
          // Strictly use getSV3 odds snapshot; do NOT fall back to item.flb for control or control_team_odds
          const bookmaker = oddsData ? parseBookmakerRate(oddsData.R ?? oddsData.r) : parseBookmakerRate(null);
          const sessions = parseSessionMarkets(oddsData?.Z, oddsData?.D);
          const speechNames =
            oddsData?.speech_names && typeof oddsData.speech_names === 'object'
              ? oddsData.speech_names
              : {};

          const { control, favoriteTeam } = resolveControlForMatch(
            item,
            oddsData,
            battingTeamObj.key,
            battingTeamObj.name,
            battingTeamObj.shortName,
            bowlingTeamObj.key,
            bowlingTeamObj.name,
            bowlingTeamObj.shortName
          );

          const controlTeamOdds = bookmaker.backRate ?? null;
          const matchStatus: 'live' | 'completed' = isFinished ? 'completed' : 'live';
          const resultText = item.res || item.soResult || null;

          // Determine is_new_ball and runs_on_ball by comparing against previous tracked snapshot
          const prev = lastTimelineSnapshot[matchId];
          let isNewBall = false;
          let runsOnBall = 0;

          if (!prev) {
            isNewBall = activeScore.legalBallCount > 0 || activeScore.runs > 0;
            runsOnBall = activeScore.legalBallCount <= 1 ? activeScore.runs : 0;
          } else if (innings !== prev.innings) {
            isNewBall = true;
            runsOnBall = activeScore.legalBallCount <= 1 ? activeScore.runs : 0;
          } else {
            isNewBall = activeScore.legalBallCount !== prev.legalBallCount;
            if (isNewBall || activeScore.runs !== prev.runs) {
              runsOnBall = Math.max(0, activeScore.runs - prev.runs);
            }
          }

          const scoreFetchedAt = scoreFetchedAtByMatch.get(matchId) || null;
          const scoreChangedAt = scoreChangedAtByMatch.get(matchId) || scoreFetchedAt;
          const scoreSource = scoreSourceByMatch.get(matchId);
          const oddsFetchedAt = oddsFetchedAtByMatch.get(matchId) || null;
          const sameGetSV3ScorePacket = Boolean(
            scoreSource === 'getSV3' &&
              scoreChangedAt &&
              oddsFetchedAt &&
              scoreChangedAt.getTime() === oddsFetchedAt.getTime()
          );

          // Build the unified per-second snapshot shared with the Strategy Engine
          const { parsedMatch, parsedOddsState, isStale } = buildSnapshotForEvaluation(matchId, item, {
            seriesName,
            team1,
            team2,
            innings,
            score1,
            score2,
            hasInn1,
            hasInn2,
            matchStatus,
            resultText,
            oddsData,
            oddsFetchedAt,
            isFinished,
          });

          // 1. Append-only INSERT into match_timeline_ticks when DB is available
          if (!isDbAvailable) {
            incrementMissedTick(matchId);
          } else {
            try {
              await dbPool.query(
                `INSERT INTO match_timeline_ticks (
                  match_id, series_name, innings, overs, legal_ball_count, runs, wickets,
                  batting_team, bowling_team, favorite_team, control,
                  back_rate, lay_rate, decimal_back, decimal_lay, control_team_odds,
                  raw_rate_string, session_data, match_status, result_text,
                  is_new_ball, runs_on_ball, score_fetched_at, odds_fetched_at, recorded_at
                ) VALUES (
                  $1, $2, $3, $4, $5, $6, $7,
                  $8, $9, $10, $11,
                  $12, $13, $14, $15, $16,
                  $17, $18, $19, $20,
                  $21, $22, $23, $24, NOW()
                )`,
                [
                  matchId,
                  seriesName,
                  innings,
                  activeScore.oversDecimal,
                  activeScore.legalBallCount,
                  activeScore.runs,
                  activeScore.wickets,
                  battingTeamObj.name,
                  bowlingTeamObj.name,
                  favoriteTeam,
                  control,
                  bookmaker.backRate ?? null,
                  bookmaker.layRate ?? null,
                  bookmaker.decimalBack ?? null,
                  bookmaker.decimalLay ?? null,
                  controlTeamOdds,
                  bookmaker.rawRateString || null,
                  sessions.length > 0 ? JSON.stringify(sessions) : null,
                  matchStatus,
                  resultText,
                  isNewBall,
                  runsOnBall,
                  scoreFetchedAt ? scoreFetchedAt.toISOString() : null,
                  oddsFetchedAt ? oddsFetchedAt.toISOString() : null,
                ]
              );

              startedTimelineMatches.add(matchId);
              lastTimelineSnapshot[matchId] = {
                innings,
                legalBallCount: activeScore.legalBallCount,
                runs: activeScore.runs,
              };

              if (isFinished) {
                finalizedTimelineMatches.add(matchId);
              }

              // Keep latest_match_state & latest_odds_state updated from server
              const nowMs = Date.now();
              const lastSyncMs = lastLatestStateSyncAt.get(matchId) || 0;
              if (isNewBall || isFinished || nowMs - lastSyncMs >= 2000) {
                lastLatestStateSyncAt.set(matchId, nowMs);
                try {
                  await syncLatestStateToDb(matchId, item, {
                    seriesName,
                    team1,
                    team2,
                    innings,
                    score1,
                    score2,
                    hasInn1,
                    hasInn2,
                    matchStatus,
                    resultText,
                    bookmaker,
                    sessions,
                    favoriteTeam,
                    speechNames,
                    oddsData,
                  });
                } catch (latestErr: any) {
                  if (isDbConnectionError(latestErr)) {
                    if (isDbAvailable) {
                      isDbAvailable = false;
                      releaseLeaderLockClient();
                      hasLoggedDbOffline = true;
                      console.warn(
                        `[PostgreSQL] Lost connection during latest-state sync (${latestErr?.message || latestErr}). Retrying every 15s.`
                      );
                    }
                  } else {
                    console.error(
                      `[LatestState Sync Error] match_id=${matchId} error=${latestErr?.message || latestErr}`
                    );
                  }
                }
              }
            } catch (err: any) {
              incrementMissedTick(matchId);
              if (isDbConnectionError(err)) {
                if (isDbAvailable) {
                  isDbAvailable = false;
                  releaseLeaderLockClient();
                  hasLoggedDbOffline = true;
                  console.warn(
                    `[PostgreSQL] Lost connection during timeline insert (${err?.message || err}). Retrying every 15s.`
                  );
                }
              } else {
                console.error(
                  `[Timeline Insert Error] match_id=${matchId} missed=${missedTicksByMatch[matchId]} error=${err?.message || err}`
                );
              }
            }
          }

          // 2. Run Strategy Evaluation ONCE per match per second on the EXACT same snapshot
          // (runs in memory and queues failed DB writes to outbox even if PostgreSQL is unreachable)
          if (isLive) {
            await strategyCoordinator.evaluateMatchSnapshot(parsedMatch, parsedOddsState, {
              isStale,
              scoreFetchedAt,
              scoreChangedAt,
              oddsFetchedAt,
              oddsSource: oddsData ? 'getSV3' : 'none',
              sameGetSV3ScorePacket,
              dbAvailable: isDbAvailable,
            });
          }
        } catch (err: any) {
          incrementMissedTick(matchId);
          console.error(
            `[Server 1s Loop Error] match_id=${matchId} missed=${missedTicksByMatch[matchId]} error=${err?.message || err}`
          );
        }
      })
    );

    if (anyLiveEvaluated && sseClients.size > 0) {
      broadcastToClients({
        type: 'update',
        matches: matchStore.matches,
        oddsByMatch: getSerializedOddsMap(),
        strategyStates: strategyCoordinator.engine.getAllSerializedStates(),
        timestamp: new Date().toISOString(),
      });
    }
  } finally {
    isTimelineLoopRunning = false;
  }
}

// Initial eager sync
syncGoscorerApi()
  .then(syncCrexPool)
  .then(syncLiveMatchScores)
  .catch((err) => console.error('Initial sync error:', err));

// Continuous live polling loops (24/7 independent of any open browser)
setInterval(syncGoscorerApi, 1000);         // Check Goscorer top matches every 1000ms
setInterval(syncLiveMatchScores, 1000);     // Live ball-by-ball getSV3 score & odds every 1000ms
setInterval(syncCrexPool, 2500);            // Sync Crex fixtures pool & mapping every 2.5s
setInterval(persistLiveTimelineTicks, 1000); // Append-only 1-second timeline DB saver + strategy loop

// SSE Live Stream: Instant zero-latency push to connected clients (read-only UI hydration, capped per IP)
app.get('/api/live-stream', (req, res) => {
  const clientIp = adminAuth.getClientIp(req);
  const currentConnections = sseCountByIp.get(clientIp) || 0;
  if (currentConnections >= MAX_SSE_PER_IP) {
    return res.status(429).json({
      ok: false,
      error: 'Too many simultaneous live stream connections from this IP',
    });
  }
  sseCountByIp.set(clientIp, currentConnections + 1);

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
      oddsByMatch: getSerializedOddsMap(),
      strategyStates: strategyCoordinator.engine.getAllSerializedStates(),
      timestamp: new Date().toISOString(),
    })}\n\n`
  );

  sseClients.add(res);

  // Keep-alive heartbeat every 10s
  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 10000);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    sseClients.delete(res);
    const remaining = (sseCountByIp.get(clientIp) || 1) - 1;
    if (remaining <= 0) {
      sseCountByIp.delete(clientIp);
    } else {
      sseCountByIp.set(clientIp, remaining);
    }
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
});

// High-speed endpoint: Responds immediately from memory in < 1ms
app.all(['/api/top-matches', '/api/v2/getTopMatches'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const safeCc = sanitizeCountryCode(req.body?.cc ?? req.query?.cc, 'IN');

  if (Object.keys(matchStore.matches).length === 0) {
    await Promise.all([syncGoscorerApi(safeCc), syncCrexPool()]);
  }

  res.json({
    matches: matchStore.matches,
    mapping: matchStore.mapping,
    totalCount: Object.keys(matchStore.matches).length,
    timestamp: new Date(matchStore.lastUpdated || Date.now()).toISOString(),
  });
});

// Server-maintained odds cache (populated every 1s by syncLiveMatchScores)
const serverOddsCache = new Map<string, { data: any; timestamp: number }>();

// Match-specific Odds Endpoint (Public read-only cache — never writes to DB or triggers upstream fetches on anonymous hits)
app.get(['/api/odds', '/api/v3/getSV3'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const key = String(req.query.key || '').trim();

  if (!key) {
    return res.status(400).json({ ok: false, error: 'Missing match key parameter' });
  }

  // Input validation
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    return res.status(400).json({ ok: false, error: 'Invalid match key format' });
  }

  const cached = serverOddsCache.get(key);
  if (cached?.data) {
    return res.json(cached.data);
  }

  return res.status(404).json({
    ok: false,
    cached: false,
    error: 'Odds snapshot not cached yet for this match',
  });
});

// 24/7 Webhook / Cron Endpoint (Protected by CRON_SECRET via X-Cron-Secret, Bearer token, or ?secret=)
app.all(['/api/cron', '/api/telegram/cron'], adminAuth.requireCronSecret, async (req, res) => {
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

  void adminAuth.recordAdminAudit(
    'CRON_EXECUTED',
    req.path,
    { liveMatchesCount: liveItems.length, telegramSent: sent },
    adminAuth.getClientIp(req)
  );

  res.json({
    ok: true,
    status: 'cron_executed',
    timestamp: new Date().toISOString(),
    liveMatchesCount: liveItems.length,
    telegramSent: sent,
  });
});

// Admin Telegram Test Endpoint (uses server-configured token & chatId, rate-limited 1 per 10s)
app.post(
  '/api/admin/telegram/test',
  adminAuth.requireAdmin,
  adminSendLimiter.middleware('telegram:test', 'Telegram test message'),
  async (req: AuthenticatedAdminRequest, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    await reloadTelegramConfigFromDb();
    const creds = getEffectiveTelegramCredentials();

    if (!creds.configured || !creds.token) {
      return res.status(400).json({
        ok: false,
        status: 'not configured',
        error: 'Telegram bot token is not configured on the server',
      });
    }

    const targetChatId = (typeof req.body?.chatId === 'string' && req.body.chatId.trim()) || creds.chatId;
    if (!targetChatId) {
      return res.status(400).json({
        ok: false,
        error: 'Telegram chat ID is not configured',
      });
    }

    const customText = typeof req.body?.text === 'string' && req.body.text.trim() ? req.body.text.trim() : null;
    const timestamp = new Date().toISOString();
    const text =
      customText ||
      `🏏 <b>Crex Live Scorer — Admin Test Message</b>\n\n` +
        `✅ Server-side Telegram delivery is working.\n` +
        `🔐 Token source: <code>${creds.source}</code> (****${creds.tokenLast4})\n` +
        `⏰ <i>${timestamp}</i>`;

    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      const data = await tgRes.json();
      void adminAuth.recordAdminAudit(
        'TELEGRAM_TEST',
        '/api/admin/telegram/test',
        { ok: tgRes.ok, status: tgRes.status, tokenSource: creds.source, chatIdSuffix: targetChatId.slice(-4) },
        req.adminUser?.ip || adminAuth.getClientIp(req)
      );
      return res.status(tgRes.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// Admin Manual Broadcast Endpoint (Admin only, requires confirm: true, rate-limited 1 per 10s, logged to admin_audit_log)
app.post(
  '/api/admin/telegram/broadcast',
  adminAuth.requireAdmin,
  adminSendLimiter.middleware('telegram:broadcast', 'Telegram broadcast'),
  async (req: AuthenticatedAdminRequest, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';

    if (body.confirm !== true) {
      return res.status(400).json({
        ok: false,
        error: 'Explicit confirmation (confirm: true) is required to send a broadcast',
      });
    }

    if (!text) {
      return res.status(400).json({ ok: false, error: 'Broadcast message text is required' });
    }

    if (text.length > 4000) {
      return res.status(400).json({ ok: false, error: 'Broadcast message must be 4000 characters or fewer' });
    }

    await reloadTelegramConfigFromDb();
    const creds = getEffectiveTelegramCredentials();

    if (!creds.configured || !creds.token) {
      return res.status(400).json({
        ok: false,
        status: 'not configured',
        error: 'Telegram bot token is not configured on the server',
      });
    }

    const targetChatId = (typeof body.chatId === 'string' && body.chatId.trim()) || creds.chatId;
    if (!targetChatId) {
      return res.status(400).json({ ok: false, error: 'Telegram chat ID is not configured' });
    }

    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      const data = await tgRes.json();
      void adminAuth.recordAdminAudit(
        'TELEGRAM_MANUAL_BROADCAST',
        '/api/admin/telegram/broadcast',
        {
          ok: tgRes.ok,
          status: tgRes.status,
          tokenSource: creds.source,
          messageLength: text.length,
          chatIdSuffix: targetChatId.slice(-4),
        },
        req.adminUser?.ip || adminAuth.getClientIp(req)
      );
      return res.status(tgRes.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// Telegram Bot Dispatch Proxy (Admin only, server-configured token only, rate-limited 1 per 10s)
app.post(
  '/api/telegram/send',
  adminAuth.requireAdmin,
  adminSendLimiter.middleware('telegram:send', 'Telegram send'),
  async (req: AuthenticatedAdminRequest, res) => {
    const { chatId, text } = req.body || {};
    await reloadTelegramConfigFromDb();
    const creds = getEffectiveTelegramCredentials();

    if (!creds.configured || !creds.token) {
      return res.status(400).json({ ok: false, error: 'Telegram bot token is not configured on the server' });
    }

    const targetChatId = (typeof chatId === 'string' && chatId.trim()) || creds.chatId;
    if (!targetChatId) {
      return res.status(400).json({ ok: false, error: 'Telegram chat ID is not configured' });
    }

    if (!text) {
      return res.status(400).json({ ok: false, error: 'Missing message text' });
    }

    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      const data = await tgRes.json();
      void adminAuth.recordAdminAudit(
        'TELEGRAM_SEND',
        '/api/telegram/send',
        { ok: tgRes.ok, status: tgRes.status, messageLength: String(text).length },
        req.adminUser?.ip || adminAuth.getClientIp(req)
      );
      return res.status(tgRes.status).json(data);
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// Endpoint to test an over completion alert directly (Admin only, server-configured token only, rate-limited 1 per 10s)
app.post(
  '/api/telegram/test-over',
  adminAuth.requireAdmin,
  adminSendLimiter.middleware('telegram:test-over', 'Telegram over test'),
  async (req: AuthenticatedAdminRequest, res) => {
  const { chatId, matchId } = req.body || {};
  await reloadTelegramConfigFromDb();
  const creds = getEffectiveTelegramCredentials();

  if (!creds.configured || !creds.token) {
    return res.status(400).json({ ok: false, error: 'Telegram bot token is not configured on the server' });
  }

  const targetChatId = (typeof chatId === 'string' && chatId.trim()) || creds.chatId;
  if (!targetChatId) {
    return res.status(400).json({ ok: false, error: 'Telegram chat ID is not configured' });
  }

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
    const tgRes = await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: testMsg,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await tgRes.json();
    void adminAuth.recordAdminAudit(
      'TELEGRAM_TEST_OVER',
      matchId ? String(matchId) : 'sample',
      { ok: tgRes.ok, status: tgRes.status },
      req.adminUser?.ip || adminAuth.getClientIp(req)
    );
    return res.status(tgRes.status).json(data);
  } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// Trigger initial connection greeting on boot (only when Telegram is configured & enabled)
setTimeout(() => {
  const creds = getEffectiveTelegramCredentials();
  if (creds.configured && creds.chatId && activeTelegramConfig.enabled) {
    void sendTelegramBroadcast(
      '🏏 <b>Crex Live Cricket Scorer Connected!</b>\n\n' +
        '✅ Backend automated live cricket feed is now active.\n' +
        '📢 Real-time wickets, match conclusions, and live scoreboards will be broadcasted here automatically.'
    );
  }
}, 2500);

// ============================================================================
// Local PostgreSQL Database REST Endpoints
// ============================================================================

// Diagnostic Endpoint: Check PostgreSQL connectivity and table counts (Admin only)
app.get(['/api/db/status', '/api/supabase/status'], adminAuth.requireAdmin, async (_req, res) => {
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

// Upsert Strategy Trade (First Entry, Second Entry, Bookset Exits - idempotent, Admin only)
app.post('/api/db/trades', adminAuth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
  try {
    const trade = req.body;
    if (!trade || !trade.matchId) {
      return res.status(400).json({ ok: false, error: 'Missing matchId or trade payload' });
    }
    await upsertTradeIdempotent(trade);
    void adminAuth.recordAdminAudit(
      'DB_WRITE_TRADE',
      String(trade.matchId),
      { entryType: trade.entryType, status: trade.status },
      req.adminUser?.ip || adminAuth.getClientIp(req)
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

// Upsert Match Record and Latest Score State (Admin only)
app.post('/api/db/matches', adminAuth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
  try {
    const match = req.body;
    if (!match || !match.id) {
      return res.status(400).json({ ok: false, error: 'Missing match or match.id' });
    }

    // Enforce optional ALLOWED_SERIES_FILTER when configured
    if (!isAllowedTournament(match, matchStore.mapping)) {
      return res.json({ ok: true, skipped: true, reason: 'Excluded by ALLOWED_SERIES_FILTER' });
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

    void adminAuth.recordAdminAudit(
      'DB_WRITE_MATCH',
      String(match.id),
      { format: match.format, status: match.status },
      req.adminUser?.ip || adminAuth.getClientIp(req)
    );
    return res.json({ ok: true, matchUuid });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Fetch Matches from PostgreSQL
app.get('/api/db/matches', async (_req, res) => {
  try {
    let whereClause = '';
    const params: any[] = [];

    if (ALLOWED_SERIES_FILTER.length > 0) {
      const patterns = ALLOWED_SERIES_FILTER.map((s) => `%${s.trim().toLowerCase()}%`);
      whereClause = `
        WHERE (
          LOWER(COALESCE(m.series_key, '')) = ANY($1::text[])
          OR LOWER(COALESCE(m.series_name, '')) LIKE ANY($2::text[])
        )
      `;
      params.push(
        ALLOWED_SERIES_FILTER.map((s) => s.trim().toLowerCase()),
        patterns
      );
    }

    const result = await dbPool.query(
      `
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
      ${whereClause}
      ORDER BY m.start_time DESC
      `,
      params
    );
    return res.json({ ok: true, data: result.rows });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message, data: [] });
  }
});

// Upsert Odds State and Snapshot (Admin only)
app.post('/api/db/odds', adminAuth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
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
    void adminAuth.recordAdminAudit(
      'DB_WRITE_ODDS',
      String(matchId),
      { oddsKey: oddsState.oddsKey || matchId },
      req.adminUser?.ip || adminAuth.getClientIp(req)
    );
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

// Fetch Append-Only Timeline Ticks for a Match (1-second & ball-by-ball history)
app.get('/api/db/timeline/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const ballsOnly = req.query.ballsOnly === 'true' || req.query.ballsOnly === '1';
    const order = String(req.query.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '10000'), 10) || 10000, 1), 50000);

    const whereBalls = ballsOnly ? 'AND is_new_ball = true' : '';
    const result = await dbPool.query(
      `SELECT * FROM match_timeline_ticks
       WHERE match_id = $1 ${whereBalls}
       ORDER BY recorded_at ${order}, id ${order}
       LIMIT $2`,
      [matchId, limit]
    );

    return res.json({
      ok: true,
      matchId,
      missedTicks: missedTicksByMatch[matchId] || 0,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      matchId: req.params.matchId,
      missedTicks: missedTicksByMatch[req.params.matchId] || 0,
      error: err.message,
      data: [],
    });
  }
});

// Upsert Strategy Signal (idempotent via event_dedupe_hash, Admin only)
app.post('/api/db/signals', adminAuth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
  try {
    const signal = req.body as StrategySignal;
    if (!signal?.matchId) {
      return res.status(400).json({ ok: false, error: 'Missing signal or matchId' });
    }
    const dedupeHash = `${signal.matchId}:${signal.signalType}:${signal.status}:${signal.currentInnings}:${signal.currentOver}:${signal.ballNumber || 0}:${signal.relevantOdds?.decimalOdds ?? 'null'}:${signal.relevantOdds?.opposingTeamOdds ?? 'null'}`.slice(0, 160);
    await pgStrategyStorageAdapter.insertSignal(signal, dedupeHash);
    void adminAuth.recordAdminAudit(
      'DB_WRITE_SIGNAL',
      String(signal.matchId),
      { signalType: signal.signalType, status: signal.status },
      req.adminUser?.ip || adminAuth.getClientIp(req)
    );
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Upsert Trade Position (idempotent, Admin only)
app.post('/api/db/positions', adminAuth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
  try {
    const position = req.body as TradePosition;
    if (!position?.matchId) {
      return res.status(400).json({ ok: false, error: 'Missing position or matchId' });
    }
    await pgStrategyStorageAdapter.upsertPosition(position);
    void adminAuth.recordAdminAudit(
      'DB_WRITE_POSITION',
      String(position.matchId),
      { positionType: position.positionType, status: position.status },
      req.adminUser?.ip || adminAuth.getClientIp(req)
    );
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Load Match Strategy (Positions, Signals, Trades, and Authoritative Strategy State)
app.get('/api/db/match-strategy/:matchId', async (req, res) => {
  const { matchId } = req.params;
  const memState = strategyCoordinator.engine.hasState(matchId)
    ? strategyCoordinator.engine.serializeState(matchId)
    : null;

  try {
    const tradesRes = await dbPool.query(
      'SELECT * FROM strategy_trades WHERE match_id = $1 ORDER BY created_at DESC',
      [matchId]
    );
    const snapRes = await dbPool.query(
      'SELECT state FROM strategy_match_states WHERE match_id = $1 LIMIT 1',
      [matchId]
    );

    const matchLookup = await dbPool.query(
      'SELECT id FROM matches WHERE external_match_id = $1 LIMIT 1',
      [matchId]
    );
    const matchUuid = matchLookup.rows[0]?.id;

    let positions: any[] = [];
    let signals: any[] = [];

    if (matchUuid) {
      const posRes = await dbPool.query('SELECT * FROM trade_positions WHERE match_id = $1', [
        matchUuid,
      ]);
      positions = posRes.rows;

      const sigRes = await dbPool.query(
        'SELECT * FROM strategy_signals WHERE match_id = $1 ORDER BY timestamp DESC LIMIT 2000',
        [matchUuid]
      );
      signals = sigRes.rows;
    }

    return res.json({
      ok: true,
      positions,
      signals,
      trades: tradesRes.rows,
      strategyState: memState || snapRes.rows[0]?.state || null,
    });
  } catch (err: any) {
    // Offline fallback: return authoritative in-memory state if DB is temporarily unreachable
    return res.status(memState ? 200 : 500).json({
      ok: Boolean(memState),
      error: memState ? undefined : err.message,
      positions: [],
      signals: [],
      trades: [],
      strategyState: memState,
    });
  }
});

// Authoritative Server Strategy States & Diagnostics
app.get('/api/strategy/state', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.json({
    ok: true,
    strategyAlertsEnabled: activeStrategyAlertsStatus.enabled,
    leaderActive: hasPgAdvisoryLock || !isDbAvailable,
    pendingOutbox: strategyCoordinator.getPendingCounts(),
    states: strategyCoordinator.engine.getAllSerializedStates(),
    timestamp: new Date().toISOString(),
  });
});

// Public Read-Only Site Defaults & Maintenance Banner (zero secrets)
app.get('/api/public/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.json({
    ok: true,
    ...toPublicSiteConfig(activeSiteSettings),
    timestamp: new Date().toISOString(),
  });
});

// Server-Saved Manual Override: Entry (Admin only)
app.post('/api/strategy/:matchId/override-entry', adminAuth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
  const { matchId } = req.params;
  const body = req.body || {};
  const positionType = (body.positionType === 'SECOND_ENTRY' ? 'SECOND_ENTRY' : 'FIRST_ENTRY') as PositionType;
  const entryOdds = Number(body.entryOdds);
  if (!matchId || !entryOdds || isNaN(entryOdds) || entryOdds <= 1) {
    return res.status(400).json({ ok: false, error: 'Valid matchId and entryOdds (> 1.0) required' });
  }

  const rawItem = matchStore.matches[matchId];
  const t1 = rawItem ? resolveFullTeamInfo(rawItem.b, rawItem.t1Name || rawItem.team1, rawItem.t1Sname) : null;
  const t2 = rawItem ? resolveFullTeamInfo(rawItem.c, rawItem.t2Name || rawItem.team2, rawItem.t2Sname) : null;
  const fallbackMatchName = t1 && t2 ? `${t1.shortName} vs ${t2.shortName}` : undefined;
  const fallbackSeriesName = rawItem ? resolveSeriesNameFromMapping(rawItem) : undefined;
  const innings = Number(body.innings) || (rawItem && isValidActiveSecondInningsScore(rawItem.k) ? 2 : 1);
  const fallbackBat = t1 && t2 ? (innings === 2 ? t2.name : t1.name) : 'Batting Team';
  const fallbackBowl = t1 && t2 ? (innings === 2 ? t1.name : t2.name) : 'Bowling Team';

  const state = await strategyCoordinator.recordManualEntry({
    matchId,
    positionType,
    entryOdds,
    innings,
    over: Number(body.over) || 0,
    wickets: Number(body.wickets) || 0,
    bookingTeam: body.bookingTeam || 'Manual Override',
    battingTeam: body.battingTeam || fallbackBat,
    bowlingTeam: body.bowlingTeam || fallbackBowl,
    matchName: body.matchName || fallbackMatchName,
    seriesName: body.seriesName || fallbackSeriesName,
    dbAvailable: isDbAvailable,
  });

  void adminAuth.recordAdminAudit(
    'STRATEGY_OVERRIDE_ENTRY',
    matchId,
    { positionType, entryOdds, innings, over: Number(body.over) || 0 },
    req.adminUser?.ip || adminAuth.getClientIp(req)
  );

  broadcastToClients({
    type: 'update',
    matches: matchStore.matches,
    oddsByMatch: getSerializedOddsMap(),
    strategyStates: strategyCoordinator.engine.getAllSerializedStates(),
    timestamp: new Date().toISOString(),
  });

  return res.json({ ok: true, state });
});

// Server-Saved Manual Override: Exit (Admin only)
app.post('/api/strategy/:matchId/override-exit', adminAuth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
  const { matchId } = req.params;
  const body = req.body || {};
  const positionType = (body.positionType === 'SECOND_ENTRY' ? 'SECOND_ENTRY' : 'FIRST_ENTRY') as PositionType;
  const exitOdds = Number(body.exitOdds);
  if (!matchId || !exitOdds || isNaN(exitOdds) || exitOdds <= 1) {
    return res.status(400).json({ ok: false, error: 'Valid matchId and exitOdds (> 1.0) required' });
  }

  const state = await strategyCoordinator.recordManualExit({
    matchId,
    positionType,
    exitOdds,
    over: Number(body.over) || 0,
    exitReason: body.exitReason,
    dbAvailable: isDbAvailable,
  });

  void adminAuth.recordAdminAudit(
    'STRATEGY_OVERRIDE_EXIT',
    matchId,
    { positionType, exitOdds, over: Number(body.over) || 0, exitReason: body.exitReason || null },
    req.adminUser?.ip || adminAuth.getClientIp(req)
  );

  broadcastToClients({
    type: 'update',
    matches: matchStore.matches,
    oddsByMatch: getSerializedOddsMap(),
    strategyStates: strategyCoordinator.engine.getAllSerializedStates(),
    timestamp: new Date().toISOString(),
  });

  return res.json({ ok: true, state });
});

// Server-Saved Manual Override: Reset Match Strategy State (Admin only)
app.post('/api/strategy/:matchId/reset', adminAuth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
  const { matchId } = req.params;
  if (!matchId) {
    return res.status(400).json({ ok: false, error: 'Missing matchId' });
  }
  const state = await strategyCoordinator.resetMatch(matchId);

  void adminAuth.recordAdminAudit(
    'STRATEGY_RESET',
    matchId,
    {},
    req.adminUser?.ip || adminAuth.getClientIp(req)
  );

  broadcastToClients({
    type: 'update',
    matches: matchStore.matches,
    oddsByMatch: getSerializedOddsMap(),
    strategyStates: strategyCoordinator.engine.getAllSerializedStates(),
    timestamp: new Date().toISOString(),
  });

  return res.json({ ok: true, state });
});

// Masked Telegram Config & Status (Admin only — NEVER returns botToken, only last 4 chars & source)
app.get(['/api/db/telegram-config', '/api/admin/telegram'], adminAuth.requireAdmin, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    await reloadTelegramConfigFromDb();
    return res.json({ ok: true, data: getSafeTelegramStatus() });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message, data: null });
  }
});

app.post(['/api/db/telegram-config', '/api/admin/telegram'], adminAuth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    const patch = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const { tokenUpdated, tokenCleared } = await saveTelegramToDb(dbPool, activeTelegramConfig, patch);
    await reloadTelegramConfigFromDb();
    void adminAuth.recordAdminAudit(
      'TELEGRAM_CONFIG_UPDATE',
      'telegram_config',
      { ...patch, tokenUpdated, tokenCleared },
      req.adminUser?.ip || adminAuth.getClientIp(req)
    );
    return res.json({ ok: true, data: getSafeTelegramStatus() });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Atomic Check & Record in app_settings (Admin only)
app.post('/api/db/app-settings/check-record', adminAuth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
  const { key, payload, description } = req.body || {};
  if (!key) return res.status(400).json({ ok: false, error: 'Missing key' });

  try {
    const insertRes = await dbPool.query(
      `INSERT INTO app_settings (key, value, description, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [key, JSON.stringify(payload || {}), description || 'Automated notification record']
    );

    const alreadyRecorded = insertRes.rows.length === 0;
    void adminAuth.recordAdminAudit(
      'APP_SETTINGS_CHECK_RECORD',
      String(key),
      { alreadyRecorded },
      req.adminUser?.ip || adminAuth.getClientIp(req)
    );

    return res.json({ ok: true, alreadyRecorded });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message, alreadyRecorded: false });
  }
});

// Get recorded First Entries (Admin only)
app.get('/api/db/app-settings/first-entries', adminAuth.requireAdmin, async (_req, res) => {
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

// ============================================================================
// Admin Panel Endpoints (Phase 3 — All Admin-Only)
// ============================================================================

// Admin System Overview & Health
app.get('/api/admin/overview', adminAuth.requireAdmin, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  await reloadTelegramConfigFromDb();

  const allMatches = Object.entries(matchStore.matches);
  const liveMatchesCount = allMatches.filter(([, m]) => (m.j || m.k) && !m.finishTime).length;
  const strategyStates = strategyCoordinator.engine.getAllSerializedStates();

  let dbSummary = {
    connected: false,
    matchesCount: 0,
    teamsCount: 0,
    positionsCount: 0,
    tradesCount: 0,
    error: null as string | null,
  };

  try {
    const client = await dbPool.connect();
    const [mRes, tRes, pRes, trRes] = await Promise.all([
      client.query('SELECT count(*) AS count FROM matches'),
      client.query('SELECT count(*) AS count FROM teams'),
      client.query('SELECT count(*) AS count FROM trade_positions'),
      client.query('SELECT count(*) AS count FROM strategy_trades'),
    ]);
    client.release();
    dbSummary = {
      connected: true,
      matchesCount: parseInt(mRes.rows[0]?.count || '0', 10),
      teamsCount: parseInt(tRes.rows[0]?.count || '0', 10),
      positionsCount: parseInt(pRes.rows[0]?.count || '0', 10),
      tradesCount: parseInt(trRes.rows[0]?.count || '0', 10),
      error: null,
    };
  } catch (err: any) {
    dbSummary.error = err.message || 'Database unavailable';
  }

  return res.json({
    ok: true,
    server: {
      uptimeSec: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
      nodeEnv: process.env.NODE_ENV || 'development',
      cookieSecure: adminAuth.cookieSecure,
      trustProxy: adminAuth.trustProxy,
      sseClientsCount: sseClients.size,
      activeSessionsCount: adminAuth.getActiveSessionCount(),
      lastFeedSyncAt: matchStore.lastUpdated ? new Date(matchStore.lastUpdated).toISOString() : null,
    },
    matches: {
      total: allMatches.length,
      live: liveMatchesCount,
    },
    db: dbSummary,
    strategy: {
      alertsEnabled: activeStrategyAlertsStatus.enabled,
      alertsSource: activeStrategyAlertsStatus.source,
      alertsEnvDefault: activeStrategyAlertsStatus.envDefault,
      leaderActive: hasPgAdvisoryLock || !isDbAvailable,
      pendingOutbox: strategyCoordinator.getPendingCounts(),
      trackedStatesCount: Object.keys(strategyStates).length,
    },
    telegram: getSafeTelegramStatus(),
    timestamp: new Date().toISOString(),
  });
});

// Admin Site Settings (GET & POST — takes effect immediately without restart)
app.get('/api/admin/settings', adminAuth.requireAdmin, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  await reloadAppSettingsFromDb();
  const liveCount = Object.values(matchStore.matches).filter(
    (m: any) => (m.j || m.k || m.d === 1) && !m.finishTime && m.d !== 2
  ).length;
  return res.json({
    ok: true,
    data: activeSiteSettings,
    refreshIntervals: READ_ONLY_REFRESH_INTERVALS,
    liveMatchesCount: liveCount,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/admin/settings/preview-series', adminAuth.requireAdmin, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const rawList = req.body?.allowedSeriesFilter;
  if (!Array.isArray(rawList)) {
    return res.status(400).json({ ok: false, error: 'allowedSeriesFilter must be an array of strings' });
  }
  const candidateFilter = sanitizeSeriesFilterList(rawList);
  const excludedLive: Array<{ id: string; title: string; seriesName: string; format: string }> = [];
  let totalLive = 0;
  let includedLive = 0;

  for (const [id, raw] of Object.entries(matchStore.matches)) {
    const isFinished = Boolean(raw.finishTime || raw.d === 2);
    const isLive = !isFinished && Boolean(raw.j || raw.k || raw.d === 1);
    if (!isLive) continue;
    totalLive++;

    if (matchesSeriesFilter(raw, candidateFilter, matchStore.mapping)) {
      includedLive++;
    } else {
      const t1 = resolveFullTeamInfo(raw.b, raw.t1Name || raw.team1, raw.t1Sname);
      const t2 = resolveFullTeamInfo(raw.c, raw.t2Name || raw.team2, raw.t2Sname);
      excludedLive.push({
        id,
        title: `${t1.shortName} vs ${t2.shortName}`,
        seriesName: resolveSeriesNameFromMapping(raw),
        format: raw.fo || raw.t || 'Match',
      });
    }
  }

  return res.json({
    ok: true,
    allowedSeriesFilter: candidateFilter,
    totalLive,
    includedLive,
    excludedLive,
  });
});

app.post('/api/admin/settings', adminAuth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

  if (
    body.defaultCountryCode !== undefined &&
    (typeof body.defaultCountryCode !== 'string' || !/^[a-zA-Z]{2,6}$/.test(body.defaultCountryCode.trim()))
  ) {
    return res.status(400).json({ ok: false, error: 'defaultCountryCode must be 2 to 6 letters (e.g. IN)' });
  }

  if (body.allowedSeriesFilter !== undefined && !Array.isArray(body.allowedSeriesFilter)) {
    return res.status(400).json({ ok: false, error: 'allowedSeriesFilter must be an array of strings' });
  }

  const prevFilter = [...ALLOWED_SERIES_FILTER];
  try {
    const saved = await saveAdminSiteSettingsToDb(dbPool, activeSiteSettings, body);
    activeSiteSettings = saved;
    ALLOWED_SERIES_FILTER = [...saved.allowedSeriesFilter];

    // Apply series filter changes immediately to in-memory matchStore without restart
    let prunedCount = 0;
    if (ALLOWED_SERIES_FILTER.length > 0) {
      for (const [id, m] of Object.entries(matchStore.matches)) {
        if (!isAllowedTournament(m, matchStore.mapping)) {
          delete matchStore.matches[id];
          prunedCount++;
        }
      }
    }

    const filterChanged = JSON.stringify(prevFilter) !== JSON.stringify(ALLOWED_SERIES_FILTER);
    if (filterChanged && (ALLOWED_SERIES_FILTER.length === 0 || prunedCount === 0)) {
      void syncGoscorerApi(activeSiteSettings.defaultCountryCode);
    }

    if (prunedCount > 0) {
      broadcastToClients({
        type: 'update',
        matches: matchStore.matches,
        oddsByMatch: getSerializedOddsMap(),
        strategyStates: strategyCoordinator.engine.getAllSerializedStates(),
        timestamp: new Date().toISOString(),
      });
    }

    void adminAuth.recordAdminAudit(
      'ADMIN_SETTINGS_UPDATE',
      'public_site_config',
      {
        defaultCountryCode: saved.defaultCountryCode,
        defaultSoundEnabled: saved.defaultSoundEnabled,
        allowedSeriesFilter: saved.allowedSeriesFilter,
        maintenanceBannerEnabled: saved.maintenanceBannerEnabled,
        maintenanceBannerLength: saved.maintenanceBannerText.length,
        prunedMatchesCount: prunedCount,
      },
      req.adminUser?.ip || adminAuth.getClientIp(req)
    );

    return res.json({
      ok: true,
      data: activeSiteSettings,
      refreshIntervals: READ_ONLY_REFRESH_INTERVALS,
      prunedMatchesCount: prunedCount,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Admin Master Strategy-Alerts Switch (DB override over env default; effective immediately without restart)
app.post('/api/admin/strategy/alerts', adminAuth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const previousEnabled = activeStrategyAlertsStatus.enabled;
  const previousSource = activeStrategyAlertsStatus.source;

  try {
    if (body.resetToEnvDefault === true) {
      const nextStatus = await clearStrategyAlertsOverrideInDb(dbPool, ENV_STRATEGY_ALERTS_DEFAULT);
      activeStrategyAlertsStatus = nextStatus;
      strategyCoordinator.setStrategyAlertsEnabled(nextStatus.enabled);

      void adminAuth.recordAdminAudit(
        'STRATEGY_ALERTS_TOGGLE',
        'strategy_alerts_config',
        {
          action: 'reset_to_env_default',
          previousEnabled,
          previousSource,
          enabled: nextStatus.enabled,
          source: nextStatus.source,
        },
        req.adminUser?.ip || adminAuth.getClientIp(req)
      );

      return res.json({ ok: true, strategyAlerts: nextStatus });
    }

    if (typeof body.enabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'enabled (boolean) is required' });
    }

    if (body.enabled === true && body.confirm !== true) {
      return res.status(400).json({
        ok: false,
        error: 'Explicit confirmation (confirm: true) is required to enable live strategy alerts',
      });
    }

    const nextStatus = await saveStrategyAlertsOverrideToDb(
      dbPool,
      body.enabled,
      ENV_STRATEGY_ALERTS_DEFAULT
    );
    activeStrategyAlertsStatus = nextStatus;
    strategyCoordinator.setStrategyAlertsEnabled(nextStatus.enabled);

    void adminAuth.recordAdminAudit(
      'STRATEGY_ALERTS_TOGGLE',
      'strategy_alerts_config',
      {
        previousEnabled,
        previousSource,
        enabled: nextStatus.enabled,
        source: nextStatus.source,
      },
      req.adminUser?.ip || adminAuth.getClientIp(req)
    );

    return res.json({ ok: true, strategyAlerts: nextStatus });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Admin Strategy Rules (Read-Only — Single Source of Truth directly from real engine config) + Active Match Strategy Snapshots
app.get('/api/admin/strategy/rules', adminAuth.requireAdmin, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  await reloadAppSettingsFromDb();
  const engineConfig = strategyCoordinator.engine.getConfig();
  const states = strategyCoordinator.engine.getAllSerializedStates();
  const oddsMap = getSerializedOddsMap();

  const matches = Object.entries(matchStore.matches).map(([id, raw]) => {
    const t1 = resolveFullTeamInfo(raw.b, raw.t1Name || raw.team1, raw.t1Sname);
    const t2 = resolveFullTeamInfo(raw.c, raw.t2Name || raw.team2, raw.t2Sname);
    const seriesName = resolveSeriesNameFromMapping(raw);
    const isFinished = Boolean(raw.finishTime || raw.d === 2);
    const isLive = !isFinished && Boolean(raw.j || raw.k || raw.d === 1);
    const odds = oddsMap[id];
    const inn1 = parseInningsScore(raw.j, 1);
    const inn2 = isValidActiveSecondInningsScore(raw.k);
    const activeScore = inn2 || inn1;
    const currentInnings = inn2 ? 2 : 1;

    return {
      id,
      title: `${t1.shortName} vs ${t2.shortName}`,
      team1: t1.shortName,
      team2: t2.shortName,
      team1Name: t1.name,
      team2Name: t2.name,
      seriesName,
      format: raw.fo || raw.t || 'Match',
      status: isFinished ? 'completed' : isLive ? 'live' : 'upcoming',
      innings: currentInnings,
      over: activeScore?.overs ?? 0,
      wickets: activeScore?.wickets ?? 0,
      score1: raw.j || null,
      score2: raw.k || null,
      decimalBack: odds?.odds?.bookmaker?.decimalBack ?? null,
      decimalLay: odds?.odds?.bookmaker?.decimalLay ?? null,
      favTeam: odds?.odds?.favoriteTeamName || odds?.odds?.favoriteTeamKey || null,
      state: states[id] || null,
    };
  });

  // Sort live first, then matches with strategy state
  matches.sort((a, b) => {
    const pA = a.status === 'live' ? 0 : a.state ? 1 : 2;
    const pB = b.status === 'live' ? 0 : b.state ? 1 : 2;
    return pA - pB;
  });

  return res.json({
    ok: true,
    rules: engineConfig,
    strategyAlerts: activeStrategyAlertsStatus,
    strategyAlertsEnabled: activeStrategyAlertsStatus.enabled,
    leaderActive: hasPgAdvisoryLock || !isDbAvailable,
    pendingOutbox: strategyCoordinator.getPendingCounts(),
    matches,
    states,
    timestamp: new Date().toISOString(),
  });
});

// Admin Diagnostics: Live Server-Side Odds Cache & Health per Match
app.get('/api/admin/diagnostics/odds', adminAuth.requireAdmin, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const now = Date.now();
  const oddsMap = getSerializedOddsMap();

  const items = Object.entries(matchStore.matches).map(([id, raw]) => {
    const t1 = resolveFullTeamInfo(raw.b, raw.t1Name || raw.team1, raw.t1Sname);
    const t2 = resolveFullTeamInfo(raw.c, raw.t2Name || raw.team2, raw.t2Sname);
    const cachedEntry = serverOddsCache.get(id);
    const odds = oddsMap[id];
    const isFinished = Boolean(raw.finishTime || raw.d === 2);
    const isLive = !isFinished && Boolean(raw.j || raw.k || raw.d === 1);
    const matchStatus: 'live' | 'upcoming' | 'completed' = isFinished
      ? 'completed'
      : isLive
      ? 'live'
      : 'upcoming';
    const rawStatus = odds?.status;
    const oddsStatus =
      rawStatus === 'success'
        ? 'READY'
        : rawStatus === 'error'
        ? 'ERROR'
        : rawStatus
        ? rawStatus.toUpperCase()
        : cachedEntry?.data
        ? 'READY'
        : 'LOADING';

    return {
      matchId: id,
      title: `${t1.shortName} vs ${t2.shortName}`,
      seriesName: resolveSeriesNameFromMapping(raw),
      format: raw.fo || raw.t || 'Match',
      matchStatus,
      score1: raw.j || null,
      score2: raw.k || null,
      cached: Boolean(cachedEntry?.data),
      cacheAgeMs: cachedEntry?.timestamp ? Math.max(0, now - cachedEntry.timestamp) : null,
      oddsStatus,
      lastSuccessAt: odds?.lastUpdated ? new Date(odds.lastUpdated).toISOString() : null,
      consecutiveMisses: 0,
      errorMessage: odds?.error || null,
      favTeam: odds?.odds?.favoriteTeamName || odds?.odds?.favoriteTeamKey || null,
      backRate: odds?.odds?.bookmaker?.backRate ?? null,
      layRate: odds?.odds?.bookmaker?.layRate ?? null,
      decimalBack: odds?.odds?.bookmaker?.decimalBack ?? null,
      decimalLay: odds?.odds?.bookmaker?.decimalLay ?? null,
      rawF: cachedEntry?.data?.F ?? null,
      rawFlb: raw.flb ?? null,
      rawSnapshot: cachedEntry?.data ?? null,
    };
  });

  const prio: Record<'live' | 'upcoming' | 'completed', number> = {
    live: 0,
    upcoming: 1,
    completed: 2,
  };
  items.sort((a, b) => prio[a.matchStatus] - prio[b.matchStatus]);

  return res.json({
    ok: true,
    totalMatches: items.length,
    cachedOddsCount: items.filter((i) => i.cached).length,
    items,
    timestamp: new Date().toISOString(),
  });
});

// Admin Diagnostics: API Raw Inspector (strict cc validation — NEVER fetches arbitrary URLs)
app.post('/api/admin/diagnostics/raw-top-matches', adminAuth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const rawCc = req.body?.cc;
  if (rawCc !== undefined && (typeof rawCc !== 'string' || !/^[a-zA-Z]{2,6}$/.test(rawCc.trim()))) {
    return res.status(400).json({ ok: false, error: 'Country code (cc) must be 2 to 6 letters (e.g. IN, UK, AU)' });
  }
  const safeCc = sanitizeCountryCode(rawCc, 'IN');
  const forceRefresh = req.body?.forceRefresh === true;
  const startedAt = Date.now();

  if (forceRefresh || Object.keys(matchStore.matches).length === 0) {
    await syncGoscorerApi(safeCc);
  }

  const latencyMs = Date.now() - startedAt;
  void adminAuth.recordAdminAudit(
    'DIAGNOSTICS_RAW_INSPECT',
    '/api/admin/diagnostics/raw-top-matches',
    { cc: safeCc, forceRefresh, count: Object.keys(matchStore.matches).length },
    req.adminUser?.ip || adminAuth.getClientIp(req)
  );

  return res.json({
    ok: true,
    cc: safeCc,
    latencyMs,
    totalCount: Object.keys(matchStore.matches).length,
    matches: matchStore.matches,
    timestamp: new Date(matchStore.lastUpdated || Date.now()).toISOString(),
  });
});

// Admin Audit Log (reads PostgreSQL admin_audit_log with in-memory fallback)
app.get('/api/admin/audit-log', adminAuth.requireAdmin, async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const rawLimit = parseInt(String(req.query.limit || '100'), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 250) : 100;
  const actionFilter = typeof req.query.action === 'string' && req.query.action.trim() ? req.query.action.trim() : null;

  try {
    const query = actionFilter
      ? `SELECT id, at, ip, action, target, details FROM admin_audit_log WHERE action = $1 ORDER BY at DESC LIMIT $2`
      : `SELECT id, at, ip, action, target, details FROM admin_audit_log ORDER BY at DESC LIMIT $1`;
    const params = actionFilter ? [actionFilter, limit] : [limit];
    const result = await dbPool.query(query, params);
    return res.json({
      ok: true,
      source: 'postgres',
      entries: result.rows.map((r: any) => ({
        id: r.id,
        at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
        ip: r.ip || 'unknown',
        action: r.action,
        target: r.target,
        details: r.details || {},
      })),
    });
  } catch {
    const memEntries = adminAuth
      .getRecentAuditEntries()
      .filter((e) => (!actionFilter ? true : e.action === actionFilter))
      .slice(0, limit);
    return res.json({
      ok: true,
      source: 'memory',
      entries: memEntries,
    });
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
    // Serve SPA index.html for all non-API routes (including /admin and /admin/*)
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ ok: false, error: 'API endpoint not found' });
      }
      if (req.path === '/admin' || req.path.startsWith('/admin/')) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
      return res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
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
