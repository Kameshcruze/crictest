import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import {
  createAdminAuth,
  ADMIN_SESSION_COOKIE_NAME,
  AuthenticatedAdminRequest,
} from '../../../../server/adminAuth';
import {
  DEFAULT_TELEGRAM_SETTINGS,
  TELEGRAM_CONFIG_DB_KEY,
  TELEGRAM_TOKEN_SECRET_DB_KEY,
  buildSafeTelegramStatus,
  loadTelegramFromDb,
  resolveEffectiveTelegramToken,
  saveTelegramToDb,
  StoredTelegramSettings,
} from '../../../../server/telegramConfig';
import {
  createActionCooldownLimiter,
  sanitizeCountryCode,
} from '../../../../server/adminRateLimit';
import {
  DEFAULT_ADMIN_SITE_SETTINGS,
  PUBLIC_SITE_CONFIG_DB_KEY,
  READ_ONLY_REFRESH_INTERVALS,
  STRATEGY_ALERTS_CONFIG_DB_KEY,
  STRATEGY_FORMATS_CONFIG_DB_KEY,
  AdminSiteSettings,
  StrategyAlertsStatus,
  StrategyFormatsConfig,
  clearStrategyAlertsOverrideInDb,
  loadAdminSiteSettingsFromDb,
  loadStrategyAlertsStatusFromDb,
  loadStrategyFormatsFromDb,
  sanitizeSeriesFilterList,
  saveAdminSiteSettingsToDb,
  saveStrategyAlertsOverrideToDb,
  saveStrategyFormatsToDb,
  toPublicSiteConfig,
} from '../../../../server/appSettingsConfig';
import { DEFAULT_STRATEGY_CONFIG } from '../../strategy/config';
import {
  CricketStrategyEngine,
  DEFAULT_STRATEGY_ALLOWED_FORMATS,
  sanitizeCanonicalFormatList,
} from '../../strategy';

const TEST_USERNAME = 'opsadmin';
const TEST_PASSWORD = 'Phase3AdminPassword!2026';
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);
const TEST_SESSION_SECRET = 'phase3-session-secret-0123456789abcdef0123456789abcdef';

function createInMemoryAdminApp(opts: { envToken?: string; nowFn?: () => number } = {}) {
  const settingsRows = new Map<string, any>();
  const auditLogs: Array<{ id: number; at: string; ip: string; action: string; target: string | null; details: any }> = [];
  let auditIdSeq = 1;

  const mockDb = {
    async query(sql: string, params: any[] = []) {
      const text = sql.trim();

      if (text.startsWith('INSERT INTO admin_audit_log')) {
        auditLogs.unshift({
          id: auditIdSeq++,
          at: new Date().toISOString(),
          ip: params[0],
          action: params[1],
          target: params[2],
          details: JSON.parse(params[3]),
        });
        return { rows: [] };
      }

      if (text.startsWith('SELECT id, at, ip, action, target, details FROM admin_audit_log')) {
        let rows = [...auditLogs];
        if (text.includes('WHERE action = $1')) {
          rows = rows.filter((r) => r.action === params[0]).slice(0, params[1]);
        } else {
          rows = rows.slice(0, params[0]);
        }
        return { rows };
      }

      if (text.startsWith('SELECT value FROM app_settings WHERE key = $1')) {
        const key = params[0];
        if (settingsRows.has(key)) {
          return { rows: [{ value: settingsRows.get(key) }] };
        }
        return { rows: [] };
      }

      if (text.startsWith('SELECT value, updated_at FROM app_settings WHERE key = $1')) {
        const key = params[0];
        if (settingsRows.has(key)) {
          return { rows: [{ value: settingsRows.get(key), updated_at: new Date() }] };
        }
        return { rows: [] };
      }

      if (text.startsWith('SELECT key, value FROM app_settings WHERE key = ANY')) {
        const keys: string[] = params[0] || [];
        return {
          rows: keys
            .filter((k) => settingsRows.has(k))
            .map((k) => ({ key: k, value: settingsRows.get(k) })),
        };
      }

      if (text.startsWith('INSERT INTO app_settings')) {
        const [key, jsonValue] = params;
        settingsRows.set(key, JSON.parse(jsonValue));
        return { rows: [{ key }] };
      }

      if (text.startsWith('DELETE FROM app_settings WHERE key = $1')) {
        settingsRows.delete(params[0]);
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  const auth = createAdminAuth({
    adminUsername: TEST_USERNAME,
    adminPasswordHash: TEST_PASSWORD_HASH,
    sessionSecret: TEST_SESSION_SECRET,
    cookieSecure: false,
    dbPool: mockDb,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  const envToken = opts.envToken ?? '';
  const envStrategyAlertsDefault = false;
  let activeSettings: StoredTelegramSettings = { ...DEFAULT_TELEGRAM_SETTINGS, chatId: '-100555111222' };
  let dbSecretToken = '';
  let activeSiteSettings: AdminSiteSettings = { ...DEFAULT_ADMIN_SITE_SETTINGS };
  let activeStrategyAlerts: StrategyAlertsStatus = {
    enabled: envStrategyAlertsDefault,
    source: 'env',
    envDefault: envStrategyAlertsDefault,
    updatedAt: null,
  };
  let activeStrategyFormats: StrategyFormatsConfig = {
    allowedFormats: [...DEFAULT_STRATEGY_ALLOWED_FORMATS],
    updatedAt: null,
  };
  const liveStrategyEngine = new CricketStrategyEngine();
  const liveMatches = [
    { id: 'M1', title: 'IND vs AUS', seriesName: 'IPL 2026', format: 'T20', status: 'live' },
    { id: 'M2', title: 'SYS vs MEL', seriesName: 'Big Bash League', format: 'T20', status: 'live' },
  ];
  const limiter = createActionCooldownLimiter({ windowMs: 10_000, now: opts.nowFn });

  const app = express();
  app.use(express.json());
  app.use(auth.corsMiddleware);

  app.use(['/admin', '/admin/*'], (_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
  });

  app.post('/api/admin/login', auth.handleLogin);
  app.post('/api/admin/logout', auth.handleLogout);
  app.get('/api/admin/me', auth.handleMe);

  app.get('/api/admin/overview', auth.requireAdmin, (_req, res) => {
    const telegram = buildSafeTelegramStatus({
      envToken,
      envChatId: '',
      dbSecretToken,
      settings: activeSettings,
    });
    res.json({
      ok: true,
      server: { uptimeSec: 42, sseClientsCount: 2, activeSessionsCount: auth.getActiveSessionCount() },
      matches: { total: 1, live: 1 },
      db: { connected: true, matchesCount: 1, teamsCount: 2, positionsCount: 0, tradesCount: 0 },
      strategy: { alertsEnabled: false, leaderActive: true, trackedStatesCount: 1 },
      telegram,
    });
  });

  app.get('/api/admin/telegram', auth.requireAdmin, async (_req, res) => {
    const loaded = await loadTelegramFromDb(mockDb);
    if (loaded.settings) activeSettings = loaded.settings;
    dbSecretToken = loaded.dbSecretToken;
    res.json({
      ok: true,
      data: buildSafeTelegramStatus({
        envToken,
        envChatId: '',
        dbSecretToken,
        settings: activeSettings,
      }),
    });
  });

  app.post('/api/admin/telegram', auth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
    const patch = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const saved = await saveTelegramToDb(mockDb, activeSettings, patch);
    activeSettings = saved.settings;
    const loaded = await loadTelegramFromDb(mockDb);
    dbSecretToken = loaded.dbSecretToken;
    await auth.recordAdminAudit(
      'TELEGRAM_CONFIG_UPDATE',
      'telegram_config',
      { ...patch, tokenUpdated: saved.tokenUpdated, tokenCleared: saved.tokenCleared },
      req.adminUser?.ip || '127.0.0.1'
    );
    res.json({
      ok: true,
      data: buildSafeTelegramStatus({
        envToken,
        envChatId: '',
        dbSecretToken,
        settings: activeSettings,
      }),
    });
  });

  app.post(
    '/api/admin/telegram/test',
    auth.requireAdmin,
    limiter.middleware('telegram:test', 'Telegram test message'),
    async (req: AuthenticatedAdminRequest, res) => {
      const resolved = resolveEffectiveTelegramToken(envToken, dbSecretToken);
      if (!resolved.configured) {
        return res.status(400).json({ ok: false, status: 'not configured', error: 'Not configured' });
      }
      await auth.recordAdminAudit(
        'TELEGRAM_TEST',
        '/api/admin/telegram/test',
        { ok: true, tokenSource: resolved.source },
        req.adminUser?.ip || '127.0.0.1'
      );
      return res.json({ ok: true, tokenSource: resolved.source });
    }
  );

  app.post(
    '/api/admin/telegram/broadcast',
    auth.requireAdmin,
    limiter.middleware('telegram:broadcast', 'Telegram broadcast'),
    async (req: AuthenticatedAdminRequest, res) => {
      const body = req.body || {};
      if (body.confirm !== true) {
        return res.status(400).json({ ok: false, error: 'Explicit confirmation required' });
      }
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) {
        return res.status(400).json({ ok: false, error: 'Message text required' });
      }
      const resolved = resolveEffectiveTelegramToken(envToken, dbSecretToken);
      if (!resolved.configured) {
        return res.status(400).json({ ok: false, status: 'not configured', error: 'Not configured' });
      }
      await auth.recordAdminAudit(
        'TELEGRAM_MANUAL_BROADCAST',
        '/api/admin/telegram/broadcast',
        { ok: true, messageLength: text.length, tokenSource: resolved.source },
        req.adminUser?.ip || '127.0.0.1'
      );
      return res.json({ ok: true, delivered: true });
    }
  );

  app.get('/api/public/config', (_req, res) => {
    res.json({
      ok: true,
      ...toPublicSiteConfig(activeSiteSettings),
      strategyAllowedFormats: activeStrategyFormats.allowedFormats,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/admin/settings', auth.requireAdmin, async (_req, res) => {
    const loaded = await loadAdminSiteSettingsFromDb(mockDb);
    if (loaded) activeSiteSettings = loaded;
    res.json({
      ok: true,
      data: activeSiteSettings,
      refreshIntervals: READ_ONLY_REFRESH_INTERVALS,
      liveMatchesCount: liveMatches.length,
    });
  });

  app.post('/api/admin/settings/preview-series', auth.requireAdmin, (req, res) => {
    const rawList = req.body?.allowedSeriesFilter;
    if (!Array.isArray(rawList)) {
      return res.status(400).json({ ok: false, error: 'allowedSeriesFilter must be an array' });
    }
    const candidate = sanitizeSeriesFilterList(rawList);
    const excludedLive = liveMatches.filter((m) => {
      if (candidate.length === 0) return false;
      const hay = `${m.seriesName} ${m.title} ${m.format}`.toLowerCase();
      return !candidate.some((f) => hay.includes(f.toLowerCase()));
    });
    return res.json({
      ok: true,
      allowedSeriesFilter: candidate,
      totalLive: liveMatches.length,
      includedLive: liveMatches.length - excludedLive.length,
      excludedLive,
    });
  });

  app.post('/api/admin/settings', auth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    if (
      body.defaultCountryCode !== undefined &&
      (typeof body.defaultCountryCode !== 'string' || !/^[a-zA-Z]{2,6}$/.test(body.defaultCountryCode.trim()))
    ) {
      return res.status(400).json({ ok: false, error: 'Invalid defaultCountryCode' });
    }
    activeSiteSettings = await saveAdminSiteSettingsToDb(mockDb, activeSiteSettings, body);
    await auth.recordAdminAudit(
      'ADMIN_SETTINGS_UPDATE',
      PUBLIC_SITE_CONFIG_DB_KEY,
      activeSiteSettings as unknown as Record<string, unknown>,
      req.adminUser?.ip || '127.0.0.1'
    );
    return res.json({
      ok: true,
      data: activeSiteSettings,
      refreshIntervals: READ_ONLY_REFRESH_INTERVALS,
    });
  });

  app.post('/api/admin/strategy/alerts', auth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    if (body.resetToEnvDefault === true) {
      activeStrategyAlerts = await clearStrategyAlertsOverrideInDb(mockDb, envStrategyAlertsDefault);
      await auth.recordAdminAudit(
        'STRATEGY_ALERTS_TOGGLE',
        STRATEGY_ALERTS_CONFIG_DB_KEY,
        { action: 'reset_to_env_default', enabled: activeStrategyAlerts.enabled, source: activeStrategyAlerts.source },
        req.adminUser?.ip || '127.0.0.1'
      );
      return res.json({ ok: true, strategyAlerts: activeStrategyAlerts });
    }
    if (typeof body.enabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'enabled (boolean) is required' });
    }
    if (body.enabled === true && body.confirm !== true) {
      return res.status(400).json({ ok: false, error: 'Explicit confirmation required' });
    }
    activeStrategyAlerts = await saveStrategyAlertsOverrideToDb(mockDb, body.enabled, envStrategyAlertsDefault);
    await auth.recordAdminAudit(
      'STRATEGY_ALERTS_TOGGLE',
      STRATEGY_ALERTS_CONFIG_DB_KEY,
      { enabled: activeStrategyAlerts.enabled, source: activeStrategyAlerts.source },
      req.adminUser?.ip || '127.0.0.1'
    );
    return res.json({ ok: true, strategyAlerts: activeStrategyAlerts });
  });

  app.post('/api/admin/strategy/formats', auth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    if (!Array.isArray(body.allowedFormats)) {
      return res.status(400).json({ ok: false, error: 'allowedFormats must be an array' });
    }
    if (body.confirm !== true) {
      return res.status(400).json({ ok: false, error: 'Explicit confirmation required' });
    }
    const previous = [...activeStrategyFormats.allowedFormats];
    const sanitized = sanitizeCanonicalFormatList(body.allowedFormats, []);
    activeStrategyFormats = await saveStrategyFormatsToDb(mockDb, sanitized);
    liveStrategyEngine.setAllowedFormats(activeStrategyFormats.allowedFormats);
    await auth.recordAdminAudit(
      'STRATEGY_FORMATS_UPDATE',
      STRATEGY_FORMATS_CONFIG_DB_KEY,
      { previous, allowedFormats: activeStrategyFormats.allowedFormats },
      req.adminUser?.ip || '127.0.0.1'
    );
    return res.json({
      ok: true,
      strategyAllowedFormats: activeStrategyFormats.allowedFormats,
      updatedAt: activeStrategyFormats.updatedAt,
    });
  });

  app.get('/api/admin/strategy/rules', auth.requireAdmin, async (_req, res) => {
    activeStrategyAlerts = await loadStrategyAlertsStatusFromDb(mockDb, envStrategyAlertsDefault);
    activeStrategyFormats = await loadStrategyFormatsFromDb(mockDb);
    res.json({
      ok: true,
      rules: DEFAULT_STRATEGY_CONFIG,
      strategyAlerts: activeStrategyAlerts,
      strategyAlertsEnabled: activeStrategyAlerts.enabled,
      strategyAllowedFormats: activeStrategyFormats.allowedFormats,
      strategyFormatsUpdatedAt: activeStrategyFormats.updatedAt,
      matches: liveMatches,
    });
  });

  app.post('/api/strategy/:matchId/override-entry', auth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
    await auth.recordAdminAudit('STRATEGY_OVERRIDE_ENTRY', req.params.matchId, req.body || {}, req.adminUser?.ip || '127.0.0.1');
    res.json({ ok: true, matchId: req.params.matchId });
  });

  app.post('/api/strategy/:matchId/override-exit', auth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
    await auth.recordAdminAudit('STRATEGY_OVERRIDE_EXIT', req.params.matchId, req.body || {}, req.adminUser?.ip || '127.0.0.1');
    res.json({ ok: true, matchId: req.params.matchId });
  });

  app.post('/api/strategy/:matchId/reset', auth.requireAdmin, async (req: AuthenticatedAdminRequest, res) => {
    await auth.recordAdminAudit('STRATEGY_RESET', req.params.matchId, {}, req.adminUser?.ip || '127.0.0.1');
    res.json({ ok: true, matchId: req.params.matchId });
  });

  app.get('/api/admin/diagnostics/odds', auth.requireAdmin, (_req, res) => {
    res.json({
      ok: true,
      totalMatches: 1,
      cachedOddsCount: 1,
      items: [{ matchId: 'M1', title: 'IND vs AUS', cached: true, oddsStatus: 'READY' }],
    });
  });

  app.post('/api/admin/diagnostics/raw-top-matches', auth.requireAdmin, (req, res) => {
    const rawCc = req.body?.cc;
    if (rawCc !== undefined && (typeof rawCc !== 'string' || !/^[a-zA-Z]{2,6}$/.test(rawCc.trim()))) {
      return res.status(400).json({ ok: false, error: 'Invalid country code' });
    }
    const safeCc = sanitizeCountryCode(rawCc, 'IN');
    return res.json({ ok: true, cc: safeCc, matches: { M1: { b: 'IND', c: 'AUS' } } });
  });

  app.get('/api/admin/audit-log', auth.requireAdmin, async (req, res) => {
    const actionFilter = typeof req.query.action === 'string' && req.query.action.trim() ? req.query.action.trim() : null;
    const query = actionFilter
      ? 'SELECT id, at, ip, action, target, details FROM admin_audit_log WHERE action = $1 ORDER BY at DESC LIMIT $2'
      : 'SELECT id, at, ip, action, target, details FROM admin_audit_log ORDER BY at DESC LIMIT $1';
    const result = await mockDb.query(query, actionFilter ? [actionFilter, 50] : [50]);
    res.json({ ok: true, source: 'postgres', entries: result.rows });
  });

  app.get('/admin', (_req, res) => {
    res.send('<!doctype html><html><body>Admin SPA</body></html>');
  });

  return { app, auditLogs, settingsRows, liveStrategyEngine };
}

async function withServer(app: express.Express, fn: (baseUrl: string) => Promise<void>) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function loginAndGetCookie(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'Expected Set-Cookie header');
  const pair = setCookie.split(';')[0];
  assert.ok(pair.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=`));
  return pair;
}

describe('Phase 3 Admin Endpoints, Rate Limits & Session Guards', () => {
  it('returns 401 without a valid session on EVERY Phase 3 admin endpoint', async () => {
    const { app } = createInMemoryAdminApp({ envToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890' });

    await withServer(app, async (baseUrl) => {
      const endpoints: Array<{ method: 'GET' | 'POST'; path: string; body?: any }> = [
        { method: 'GET', path: '/api/admin/overview' },
        { method: 'GET', path: '/api/admin/telegram' },
        { method: 'POST', path: '/api/admin/telegram', body: { enabled: true } },
        { method: 'POST', path: '/api/admin/telegram/test', body: {} },
        { method: 'POST', path: '/api/admin/telegram/broadcast', body: { text: 'Hi', confirm: true } },
        { method: 'GET', path: '/api/admin/settings' },
        { method: 'POST', path: '/api/admin/settings/preview-series', body: { allowedSeriesFilter: ['IPL'] } },
        { method: 'POST', path: '/api/admin/settings', body: { defaultCountryCode: 'AU' } },
        { method: 'POST', path: '/api/admin/strategy/alerts', body: { enabled: true, confirm: true } },
        { method: 'POST', path: '/api/admin/strategy/formats', body: { allowedFormats: ['T10', 'T20'], confirm: true } },
        { method: 'GET', path: '/api/admin/strategy/rules' },
        { method: 'POST', path: '/api/strategy/M1/override-entry', body: { entryOdds: 1.88 } },
        { method: 'POST', path: '/api/strategy/M1/override-exit', body: { exitOdds: 1.5 } },
        { method: 'POST', path: '/api/strategy/M1/reset', body: {} },
        { method: 'GET', path: '/api/admin/diagnostics/odds' },
        { method: 'POST', path: '/api/admin/diagnostics/raw-top-matches', body: { cc: 'IN' } },
        { method: 'GET', path: '/api/admin/audit-log' },
      ];

      for (const ep of endpoints) {
        const res = await fetch(`${baseUrl}${ep.path}`, {
          method: ep.method,
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: ep.method === 'POST' ? JSON.stringify(ep.body || {}) : undefined,
        });
        assert.equal(res.status, 401, `Expected 401 without session for ${ep.method} ${ep.path}`);
      }
    });
  });

  it('allows valid admin session to read overview, update telegram_config without exposing botToken, and inspect rules/diagnostics', async () => {
    const { app, settingsRows } = createInMemoryAdminApp({
      envToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
    });

    await withServer(app, async (baseUrl) => {
      const cookie = await loginAndGetCookie(baseUrl);
      const authHeaders = {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      };

      // Overview
      const overviewRes = await fetch(`${baseUrl}/api/admin/overview`, { headers: authHeaders });
      assert.equal(overviewRes.status, 200);
      const overview = (await overviewRes.json()) as any;
      assert.equal(overview.ok, true);
      assert.equal(overview.telegram.tokenSource, 'env');
      assert.equal(overview.telegram.tokenLast4, '7890');
      assert.equal('botToken' in overview.telegram, false);

      // Update telegram_config + write-only DB token
      const tgPostRes = await fetch(`${baseUrl}/api/admin/telegram`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          enabled: true,
          notifyWickets: true,
          notifyResults: true,
          notifyOverCompletion: false,
          notifyPeriodicDigest: true,
          notifyStrategyEntries: true,
          digestIntervalMinutes: 5,
          chatId: '-100999888777',
          botToken: '999888777:ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ9999',
        }),
      });
      assert.equal(tgPostRes.status, 200);
      const tgJson = (await tgPostRes.json()) as any;
      assert.equal(tgJson.data.enabled, true);
      assert.equal(tgJson.data.digestIntervalMinutes, 5);
      assert.equal(tgJson.data.chatId, '-100999888777');
      assert.equal(tgJson.data.tokenSource, 'env', 'env token must take priority over saved DB token');
      assert.equal(tgJson.data.hasDbToken, true);
      assert.equal('botToken' in tgJson.data, false);
      assert.equal('botToken' in settingsRows.get(TELEGRAM_CONFIG_DB_KEY), false);
      assert.ok(settingsRows.get(TELEGRAM_TOKEN_SECRET_DB_KEY)?.token);

      // Read-only strategy rules (Single Source of Truth from DEFAULT_STRATEGY_CONFIG)
      const rulesRes = await fetch(`${baseUrl}/api/admin/strategy/rules`, { headers: authHeaders });
      assert.equal(rulesRes.status, 200);
      const rulesJson = (await rulesRes.json()) as any;
      assert.equal(rulesJson.rules.firstEntry.minPaiseInclusive, 85);
      assert.equal(rulesJson.rules.secondEntry.maxBowlingPaiseExclusive, 65);
      assert.equal(rulesJson.rules.firstExitBelow55.maxBattingPaiseInclusive, 55);
      assert.equal(rulesJson.rules.bookset.minBowlingPaiseExclusive, 85);
      assert.equal(rulesJson.rules.abnormalActivity.fourMinPaise, 11);
      assert.equal(rulesJson.rules.abnormalActivity.sixMinPaise, 18);
      assert.equal(rulesJson.rules.entryWindows.firstInningsMaxOver, 10);
      assert.equal(rulesJson.rules.entryWindows.secondInningsMaxOver, 6);
      assert.equal(rulesJson.rules.wicketFilter.maxAllowedWicketsBeforeEntry, 3);
      assert.equal(rulesJson.strategyAlerts.enabled, false);
      assert.equal(rulesJson.strategyAlerts.source, 'env');

      // Diagnostics: odds & raw-top-matches strict cc validation (SSRF-safe)
      const oddsRes = await fetch(`${baseUrl}/api/admin/diagnostics/odds`, { headers: authHeaders });
      assert.equal(oddsRes.status, 200);
      const oddsJson = (await oddsRes.json()) as any;
      assert.equal(oddsJson.cachedOddsCount, 1);

      const badCcRes = await fetch(`${baseUrl}/api/admin/diagnostics/raw-top-matches`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ cc: 'http://169.254.169.254/latest/meta-data/' }),
      });
      assert.equal(badCcRes.status, 400);

      const goodCcRes = await fetch(`${baseUrl}/api/admin/diagnostics/raw-top-matches`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ cc: 'au' }),
      });
      assert.equal(goodCcRes.status, 200);
      const goodCcJson = (await goodCcRes.json()) as any;
      assert.equal(goodCcJson.cc, 'AU');

      // /admin sets X-Robots-Tag noindex
      const adminPageRes = await fetch(`${baseUrl}/admin`);
      assert.match(adminPageRes.headers.get('x-robots-tag') || '', /noindex/i);
    });
  });

  it('manages admin settings, series exclusion preview, public config, and master strategy alerts switch', async () => {
    const { app, auditLogs } = createInMemoryAdminApp();

    await withServer(app, async (baseUrl) => {
      // Public config works without auth and exposes zero secrets
      const pubInitialRes = await fetch(`${baseUrl}/api/public/config`);
      assert.equal(pubInitialRes.status, 200);
      const pubInitial = (await pubInitialRes.json()) as any;
      assert.equal(pubInitial.defaultCountryCode, 'IN');
      assert.equal(pubInitial.defaultSoundEnabled, true);
      assert.equal(pubInitial.maintenanceBannerEnabled, false);
      assert.equal('allowedSeriesFilter' in pubInitial, false);

      const cookie = await loginAndGetCookie(baseUrl);
      const authHeaders = {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      };

      // Preview series filter shows which currently live matches would be excluded
      const previewRes = await fetch(`${baseUrl}/api/admin/settings/preview-series`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ allowedSeriesFilter: ['IPL'] }),
      });
      assert.equal(previewRes.status, 200);
      const preview = (await previewRes.json()) as any;
      assert.equal(preview.totalLive, 2);
      assert.equal(preview.includedLive, 1);
      assert.equal(preview.excludedLive.length, 1);
      assert.equal(preview.excludedLive[0].id, 'M2');

      // Invalid defaultCountryCode rejected
      const badSettingsRes = await fetch(`${baseUrl}/api/admin/settings`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ defaultCountryCode: '12345' }),
      });
      assert.equal(badSettingsRes.status, 400);

      // Save valid admin settings
      const saveRes = await fetch(`${baseUrl}/api/admin/settings`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          defaultCountryCode: 'au',
          defaultSoundEnabled: false,
          allowedSeriesFilter: ['IPL'],
          maintenanceBannerEnabled: true,
          maintenanceBannerText: 'Feed upgrade in progress',
        }),
      });
      assert.equal(saveRes.status, 200);
      const saved = (await saveRes.json()) as any;
      assert.equal(saved.data.defaultCountryCode, 'AU');
      assert.equal(saved.data.defaultSoundEnabled, false);
      assert.deepEqual(saved.data.allowedSeriesFilter, ['IPL']);
      assert.equal(saved.data.maintenanceBannerEnabled, true);
      assert.equal(saved.data.maintenanceBannerText, 'Feed upgrade in progress');
      assert.equal(saved.refreshIntervals.goscorerPollMs, 1000);
      assert.ok(auditLogs.some((e) => e.action === 'ADMIN_SETTINGS_UPDATE'));

      // GET /api/public/config immediately reflects saved public defaults & banner
      const pubUpdatedRes = await fetch(`${baseUrl}/api/public/config`);
      assert.equal(pubUpdatedRes.status, 200);
      const pubUpdated = (await pubUpdatedRes.json()) as any;
      assert.equal(pubUpdated.defaultCountryCode, 'AU');
      assert.equal(pubUpdated.defaultSoundEnabled, false);
      assert.equal(pubUpdated.maintenanceBannerEnabled, true);
      assert.equal(pubUpdated.maintenanceBannerText, 'Feed upgrade in progress');

      // Master strategy alerts: turning ON without confirm: true must fail (400)
      const alertsUnconfirmed = await fetch(`${baseUrl}/api/admin/strategy/alerts`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ enabled: true }),
      });
      assert.equal(alertsUnconfirmed.status, 400);

      // Turning ON with confirm: true succeeds, sets source=db, and writes audit log
      const alertsOn = await fetch(`${baseUrl}/api/admin/strategy/alerts`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ enabled: true, confirm: true }),
      });
      assert.equal(alertsOn.status, 200);
      const alertsOnJson = (await alertsOn.json()) as any;
      assert.equal(alertsOnJson.strategyAlerts.enabled, true);
      assert.equal(alertsOnJson.strategyAlerts.source, 'db');
      assert.ok(auditLogs.some((e) => e.action === 'STRATEGY_ALERTS_TOGGLE'));

      // Turning OFF works immediately without confirm
      const alertsOff = await fetch(`${baseUrl}/api/admin/strategy/alerts`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ enabled: false }),
      });
      assert.equal(alertsOff.status, 200);
      const alertsOffJson = (await alertsOff.json()) as any;
      assert.equal(alertsOffJson.strategyAlerts.enabled, false);
      assert.equal(alertsOffJson.strategyAlerts.source, 'db');

      // Reset to env default restores source='env'
      const alertsReset = await fetch(`${baseUrl}/api/admin/strategy/alerts`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ resetToEnvDefault: true }),
      });
      assert.equal(alertsReset.status, 200);
      const alertsResetJson = (await alertsReset.json()) as any;
      assert.equal(alertsResetJson.strategyAlerts.enabled, false);
      assert.equal(alertsResetJson.strategyAlerts.source, 'env');
    });
  });

  it('updates strategy allowed formats immediately without restart (with confirm + audit) and publicVisibleFormats', async () => {
    const { app, auditLogs, liveStrategyEngine } = createInMemoryAdminApp();

    await withServer(app, async (baseUrl) => {
      const cookie = await loginAndGetCookie(baseUrl);
      const authHeaders = {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      };

      // Initially default T10 & T20 — an ODI match is NOT evaluable
      assert.deepEqual(liveStrategyEngine.getAllowedFormats(), ['T10', 'T20']);
      const odiTick1 = {
        id: 'LIVE_ODI_1',
        format: 'One Day',
        raw: { fo: 'One Day', t: 0 },
        status: 'live',
        battingTeamKey: 'T1',
        team1: { key: 'T1', name: 'Team 1', shortName: 'T1' },
        team2: { key: 'T2', name: 'Team 2', shortName: 'T2' },
        team1Score: { runs: 10, wickets: 0, overs: 1.0, completedOvers: 1, ballsInOver: 0 },
      } as any;
      const odiTick2 = {
        ...odiTick1,
        team1Score: { runs: 14, wickets: 0, overs: 1.1, completedOvers: 1, ballsInOver: 1 },
      };
      const oddsBefore = {
        matchId: 'LIVE_ODI_1',
        oddsKey: 'LIVE_ODI_1',
        status: 'success',
        recordsCount: 1,
        odds: {
          favoriteTeamKey: 'T2',
          favoriteTeamName: 'Team 2',
          bookmaker: { backRate: 98, layRate: 99, decimalBack: 1.98, decimalLay: 1.99, isSuspended: false },
          raw: { F: '^T2', R: '98+1' },
        },
      } as any;
      const oddsAfter = {
        matchId: 'LIVE_ODI_1',
        oddsKey: 'LIVE_ODI_1',
        status: 'success',
        recordsCount: 1,
        odds: {
          favoriteTeamKey: 'T1',
          favoriteTeamName: 'Team 1',
          bookmaker: { backRate: 90, layRate: 91, decimalBack: 1.90, decimalLay: 1.91, isSuspended: false },
          raw: { F: '^T1', R: '90+1' },
        },
      } as any;

      assert.equal(liveStrategyEngine.evaluateMatch(odiTick1, oddsBefore).length, 0);
      assert.equal(liveStrategyEngine.evaluateMatch(odiTick2, oddsAfter).length, 0);

      // Missing confirm: true rejected with 400
      const unconfirmedRes = await fetch(`${baseUrl}/api/admin/strategy/formats`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ allowedFormats: ['T10', 'T20', 'ODI'] }),
      });
      assert.equal(unconfirmedRes.status, 400);

      // Confirmed format update takes effect IMMEDIATELY without restart
      const confirmRes = await fetch(`${baseUrl}/api/admin/strategy/formats`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ allowedFormats: ['T10', 'T20', 'ODI'], confirm: true }),
      });
      assert.equal(confirmRes.status, 200);
      const confirmJson = (await confirmRes.json()) as any;
      assert.deepEqual(confirmJson.strategyAllowedFormats, ['T10', 'T20', 'ODI']);
      assert.deepEqual(liveStrategyEngine.getAllowedFormats(), ['T10', 'T20', 'ODI']);
      assert.ok(auditLogs.some((e) => e.action === 'STRATEGY_FORMATS_UPDATE'));

      // Live engine evaluates the ODI match immediately on the next tick
      liveStrategyEngine.evaluateMatch(odiTick1, oddsBefore);
      const evalAfterUpdate = liveStrategyEngine.evaluateMatch(odiTick2, oddsAfter);
      assert.ok(
        evalAfterUpdate.some((s) => s.signalType === 'BOOKING_TEAM_CONFIRMED'),
        'Expected ODI match to be evaluated immediately after admin format update'
      );

      // Save publicVisibleFormats via /api/admin/settings and confirm GET /api/public/config reflects both
      const pubVisRes = await fetch(`${baseUrl}/api/admin/settings`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ publicVisibleFormats: ['T10', 'T20'] }),
      });
      assert.equal(pubVisRes.status, 200);

      const pubCfgRes = await fetch(`${baseUrl}/api/public/config`);
      assert.equal(pubCfgRes.status, 200);
      const pubCfg = (await pubCfgRes.json()) as any;
      assert.deepEqual(pubCfg.publicVisibleFormats, ['T10', 'T20']);
      assert.deepEqual(pubCfg.strategyAllowedFormats, ['T10', 'T20', 'ODI']);
    });
  });

  it('enforces confirmation, 10-second rate limits (429), audit logging, and logout revocation', async () => {
    let fakeNow = 1_700_000_000_000;
    const { app, auditLogs } = createInMemoryAdminApp({
      envToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
      nowFn: () => fakeNow,
    });

    await withServer(app, async (baseUrl) => {
      const cookie = await loginAndGetCookie(baseUrl);
      const authHeaders = {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      };

      // Broadcast without confirm: true must fail (400)
      const unconfirmedRes = await fetch(`${baseUrl}/api/admin/telegram/broadcast`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ text: 'Hello channel' }),
      });
      assert.equal(unconfirmedRes.status, 400);

      // Advance clock slightly (400 consumed limiter bucket — advance 11s)
      fakeNow += 11_000;

      // Confirmed broadcast succeeds & writes to admin_audit_log
      const b1 = await fetch(`${baseUrl}/api/admin/telegram/broadcast`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ text: 'Match starts in 5 minutes', confirm: true }),
      });
      assert.equal(b1.status, 200);

      // Immediate second broadcast within 10s must return 429 + Retry-After
      fakeNow += 2_000;
      const b2 = await fetch(`${baseUrl}/api/admin/telegram/broadcast`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ text: 'Duplicate click', confirm: true }),
      });
      assert.equal(b2.status, 429);
      assert.ok(Number(b2.headers.get('retry-after')) >= 1);

      // After 10s window passes, broadcast works again
      fakeNow += 9_000;
      const b3 = await fetch(`${baseUrl}/api/admin/telegram/broadcast`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ text: 'Follow-up update', confirm: true }),
      });
      assert.equal(b3.status, 200);

      // Test message rate limit
      const t1 = await fetch(`${baseUrl}/api/admin/telegram/test`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      });
      assert.equal(t1.status, 200);
      const t2 = await fetch(`${baseUrl}/api/admin/telegram/test`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      });
      assert.equal(t2.status, 429);

      // Audit log endpoint returns recorded broadcast & test events
      const auditRes = await fetch(`${baseUrl}/api/admin/audit-log?action=TELEGRAM_MANUAL_BROADCAST`, {
        headers: authHeaders,
      });
      assert.equal(auditRes.status, 200);
      const auditJson = (await auditRes.json()) as any;
      assert.equal(auditJson.entries.length, 2);
      assert.ok(auditLogs.some((e) => e.action === 'TELEGRAM_TEST'));

      // Logout invalidates session immediately
      const logoutRes = await fetch(`${baseUrl}/api/admin/logout`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      });
      assert.equal(logoutRes.status, 200);

      const afterLogout = await fetch(`${baseUrl}/api/admin/overview`, { headers: authHeaders });
      assert.equal(afterLogout.status, 401);
    });
  });
});
