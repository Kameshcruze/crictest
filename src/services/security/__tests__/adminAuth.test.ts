import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import {
  createAdminAuth,
  scrubAuditDetails,
  ADMIN_SESSION_COOKIE_NAME,
} from '../../../../server/adminAuth';

const TEST_USERNAME = 'opsadmin';
const TEST_PASSWORD = 'SuperSecretPassword!2026';
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4); // fast rounds for unit tests
const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789abcdef';

interface MockSessionRow {
  sid: string;
  username: string;
  secret_fingerprint: string;
  ip: string;
  created_at: Date;
  expires_at: Date;
}

function createMockDbPool() {
  const sessions = new Map<string, MockSessionRow>();
  const auditLogs: Array<{ ip: string; action: string; target: string | null; details: any }> = [];

  const pool = {
    async query(sql: string, params: any[] = []) {
      const text = sql.trim();

      if (text.startsWith('CREATE TABLE IF NOT EXISTS')) {
        return { rows: [] };
      }

      if (text.startsWith('INSERT INTO admin_audit_log')) {
        auditLogs.push({
          ip: params[0],
          action: params[1],
          target: params[2],
          details: JSON.parse(params[3]),
        });
        return { rows: [] };
      }

      if (text.startsWith('INSERT INTO admin_sessions')) {
        const [sid, username, secretFingerprint, ip, createdAtMs, expiresAtMs] = params;
        sessions.set(sid, {
          sid,
          username,
          secret_fingerprint: secretFingerprint,
          ip,
          created_at: new Date(createdAtMs),
          expires_at: new Date(expiresAtMs),
        });
        return { rows: [] };
      }

      if (text.startsWith('DELETE FROM admin_sessions WHERE expires_at <= NOW() OR secret_fingerprint <> $1')) {
        const currentFp = params[0];
        const now = Date.now();
        for (const [sid, row] of sessions.entries()) {
          if (row.expires_at.getTime() <= now || row.secret_fingerprint !== currentFp) {
            sessions.delete(sid);
          }
        }
        return { rows: [] };
      }

      if (text.startsWith('DELETE FROM admin_sessions WHERE expires_at <= NOW()')) {
        const now = Date.now();
        for (const [sid, row] of sessions.entries()) {
          if (row.expires_at.getTime() <= now) {
            sessions.delete(sid);
          }
        }
        return { rows: [] };
      }

      if (text.startsWith('DELETE FROM admin_sessions WHERE sid = $1')) {
        sessions.delete(params[0]);
        return { rows: [] };
      }

      if (text.startsWith('SELECT sid, username, secret_fingerprint, ip, created_at, expires_at') && text.includes('WHERE sid = $1')) {
        const row = sessions.get(params[0]);
        return { rows: row ? [row] : [] };
      }

      if (text.startsWith('SELECT sid, username, secret_fingerprint, ip, created_at, expires_at')) {
        const currentFp = params[0];
        const now = Date.now();
        const rows = Array.from(sessions.values()).filter(
          (r) => r.expires_at.getTime() > now && r.secret_fingerprint === currentFp
        );
        return { rows };
      }

      return { rows: [] };
    },
  };

  return { pool, sessions, auditLogs };
}

async function withTestServer(
  auth: ReturnType<typeof createAdminAuth>,
  fn: (baseUrl: string, port: number) => Promise<void>
) {
  const app = express();
  if (auth.trustProxy) {
    app.set('trust proxy', 1);
  }
  app.use(express.json());
  app.use(auth.corsMiddleware);

  app.post('/api/admin/login', auth.handleLogin);
  app.post('/api/admin/logout', auth.handleLogout);
  app.get('/api/admin/me', auth.handleMe);

  app.get('/api/protected-read', auth.requireAdmin, (_req, res) => {
    res.json({ ok: true, secret: 'admin-only' });
  });
  app.post('/api/protected-write', auth.requireAdmin, (_req, res) => {
    res.json({ ok: true, mutated: true });
  });
  app.all('/api/cron', auth.requireCronSecret, (_req, res) => {
    res.json({ ok: true, cron: true });
  });
  app.get('/api/public', (_req, res) => {
    res.json({ ok: true, public: true });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    await fn(baseUrl, addr.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function extractCookiePair(setCookieHeader: string | null): string {
  assert.ok(setCookieHeader, 'Expected Set-Cookie header');
  const firstPart = setCookieHeader.split(';')[0];
  assert.ok(firstPart.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=`));
  return firstPart;
}

describe('Phase 1 Admin Auth & API Security', () => {
  it('disables admin login with 503 and logs warning when credentials or session secret are missing (no default fallback)', async () => {
    const cases = [
      { label: 'all missing', cfg: {} },
      {
        label: 'missing ADMIN_USERNAME',
        cfg: { adminPasswordHash: TEST_PASSWORD_HASH, sessionSecret: TEST_SESSION_SECRET },
      },
      {
        label: 'missing ADMIN_PASSWORD_HASH',
        cfg: { adminUsername: TEST_USERNAME, sessionSecret: TEST_SESSION_SECRET },
      },
      {
        label: 'plaintext ADMIN_PASSWORD_HASH (not bcrypt)',
        cfg: { adminUsername: TEST_USERNAME, adminPasswordHash: 'plaintext-pw', sessionSecret: TEST_SESSION_SECRET },
      },
      {
        label: 'missing SESSION_SECRET',
        cfg: { adminUsername: TEST_USERNAME, adminPasswordHash: TEST_PASSWORD_HASH },
      },
    ];

    for (const tc of cases) {
      const warnings: string[] = [];
      const auth = createAdminAuth({
        ...tc.cfg,
        logger: { log: () => {}, warn: (m: any) => warnings.push(String(m)), error: () => {} },
      });
      auth.logStartupStatus();

      assert.equal(auth.isConfigured, false, `Expected isConfigured=false for ${tc.label}`);
      assert.ok(
        warnings.some((w) => w.includes('DISABLED')),
        `Expected startup DISABLED warning for ${tc.label}`
      );

      await withTestServer(auth, async (baseUrl) => {
        const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
        });
        assert.equal(loginRes.status, 503, `Expected 503 for ${tc.label}`);
        const loginBody = (await loginRes.json()) as any;
        assert.match(loginBody.error, /not configured/i);

        const meRes = await fetch(`${baseUrl}/api/admin/me`);
        assert.equal(meRes.status, 200);
        const meBody = (await meRes.json()) as any;
        assert.equal(meBody.authenticated, false);
        assert.equal(meBody.configured, false);

        const protectedRes = await fetch(`${baseUrl}/api/protected-write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        });
        assert.equal(protectedRes.status, 401, `Protected route must fail closed for ${tc.label}`);
      });
    }
  });

  it('logs in with HttpOnly SameSite=Strict cookie, allows protected routes, and truly invalidates session on logout', async () => {
    const mockDb = createMockDbPool();
    const auth = createAdminAuth({
      adminUsername: TEST_USERNAME,
      adminPasswordHash: TEST_PASSWORD_HASH,
      sessionSecret: TEST_SESSION_SECRET,
      cookieSecure: true,
      dbPool: mockDb.pool,
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    await withTestServer(auth, async (baseUrl) => {
      // Unauthenticated protected call fails with 401
      const unauthRes = await fetch(`${baseUrl}/api/protected-read`);
      assert.equal(unauthRes.status, 401);

      // Login
      const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
      });
      assert.equal(loginRes.status, 200);
      const setCookie = loginRes.headers.get('set-cookie');
      assert.ok(setCookie);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Strict/i);
      assert.match(setCookie, /Secure/i);
      assert.match(setCookie, /Max-Age=43200/i);

      const cookiePair = extractCookiePair(setCookie);
      assert.equal(mockDb.sessions.size, 1);

      // /api/admin/me authenticates
      const meRes = await fetch(`${baseUrl}/api/admin/me`, {
        headers: { Cookie: cookiePair },
      });
      const meData = (await meRes.json()) as any;
      assert.equal(meData.authenticated, true);
      assert.equal(meData.username, TEST_USERNAME);

      // Protected write succeeds with cookie + CSRF header
      const writeRes = await fetch(`${baseUrl}/api/protected-write`, {
        method: 'POST',
        headers: { Cookie: cookiePair, 'X-Requested-With': 'XMLHttpRequest' },
      });
      assert.equal(writeRes.status, 200);

      // Logout destroys server-side session
      const logoutRes = await fetch(`${baseUrl}/api/admin/logout`, {
        method: 'POST',
        headers: { Cookie: cookiePair, 'X-Requested-With': 'XMLHttpRequest' },
      });
      assert.equal(logoutRes.status, 200);
      assert.equal(mockDb.sessions.size, 0);

      // Replaying the old cookie MUST be rejected (server-side invalidation)
      const replayMe = await fetch(`${baseUrl}/api/admin/me`, {
        headers: { Cookie: cookiePair },
      });
      assert.equal(((await replayMe.json()) as any).authenticated, false);

      const replayProtected = await fetch(`${baseUrl}/api/protected-read`, {
        headers: { Cookie: cookiePair },
      });
      assert.equal(replayProtected.status, 401);
    });
  });

  it('preserves sessions across restart with same SESSION_SECRET and drops all sessions when SESSION_SECRET changes', async () => {
    const mockDb = createMockDbPool();
    let cookiePair = '';

    // Boot 1: login and persist session to admin_sessions
    const authBoot1 = createAdminAuth({
      adminUsername: TEST_USERNAME,
      adminPasswordHash: TEST_PASSWORD_HASH,
      sessionSecret: TEST_SESSION_SECRET,
      cookieSecure: false,
      dbPool: mockDb.pool,
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });
    await authBoot1.ensureAuthTables();

    await withTestServer(authBoot1, async (baseUrl) => {
      const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
      });
      assert.equal(loginRes.status, 200);
      const setCookie = loginRes.headers.get('set-cookie') || '';
      assert.doesNotMatch(setCookie, /;\s*Secure/i); // COOKIE_SECURE=false for HTTP VPS
      cookiePair = extractCookiePair(setCookie);
    });

    // Boot 2: fresh instance, SAME SESSION_SECRET -> session MUST survive!
    const authBoot2 = createAdminAuth({
      adminUsername: TEST_USERNAME,
      adminPasswordHash: TEST_PASSWORD_HASH,
      sessionSecret: TEST_SESSION_SECRET,
      cookieSecure: false,
      dbPool: mockDb.pool,
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });
    await authBoot2.ensureAuthTables();

    await withTestServer(authBoot2, async (baseUrl) => {
      const protectedRes = await fetch(`${baseUrl}/api/protected-read`, {
        headers: { Cookie: cookiePair },
      });
      assert.equal(protectedRes.status, 200, 'Session must survive server restart when SESSION_SECRET is unchanged');
    });

    // Boot 3: fresh instance, ROTATED SESSION_SECRET -> all sessions MUST be dropped!
    const authBoot3 = createAdminAuth({
      adminUsername: TEST_USERNAME,
      adminPasswordHash: TEST_PASSWORD_HASH,
      sessionSecret: 'rotated-brand-new-secret-999999999999999999999999',
      cookieSecure: false,
      dbPool: mockDb.pool,
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });
    await authBoot3.ensureAuthTables();
    assert.equal(mockDb.sessions.size, 0, 'Changing SESSION_SECRET must purge existing sessions from DB');

    await withTestServer(authBoot3, async (baseUrl) => {
      const protectedRes = await fetch(`${baseUrl}/api/protected-read`, {
        headers: { Cookie: cookiePair },
      });
      assert.equal(protectedRes.status, 401);
    });
  });

  it('enforces generic login errors and 5-failure lockout per IP', async () => {
    const auth = createAdminAuth({
      adminUsername: TEST_USERNAME,
      adminPasswordHash: TEST_PASSWORD_HASH,
      sessionSecret: TEST_SESSION_SECRET,
      cookieSecure: false,
      trustProxy: true,
      maxLoginFailures: 5,
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    await withTestServer(auth, async (baseUrl) => {
      // Unknown user vs wrong password produce identical generic error
      const badUserRes = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Forwarded-For': '203.0.113.10',
        },
        body: JSON.stringify({ username: 'nonexistent', password: 'wrong' }),
      });
      assert.equal(badUserRes.status, 401);
      const badUserBody = (await badUserRes.json()) as any;

      const badPwRes = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Forwarded-For': '203.0.113.10',
        },
        body: JSON.stringify({ username: TEST_USERNAME, password: 'wrong' }),
      });
      assert.equal(badPwRes.status, 401);
      const badPwBody = (await badPwRes.json()) as any;
      assert.equal(badUserBody.error, badPwBody.error);
      assert.equal(badPwBody.error, 'Invalid credentials');

      // 3 more failures -> total 5 failures
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${baseUrl}/api/admin/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-Forwarded-For': '203.0.113.10',
          },
          body: JSON.stringify({ username: TEST_USERNAME, password: 'wrong' }),
        });
        assert.equal(res.status, 401);
      }

      // 6th attempt from same IP is locked out (429) even with valid password
      const lockedRes = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Forwarded-For': '203.0.113.10',
        },
        body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
      });
      assert.equal(lockedRes.status, 429);
      assert.ok(lockedRes.headers.get('retry-after'));

      // Different IP is NOT locked out
      const otherIpRes = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Forwarded-For': '203.0.113.99',
        },
        body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
      });
      assert.equal(otherIpRes.status, 200);
    });
  });

  it('requires X-Requested-With CSRF header on state-changing admin routes and enforces ADMIN_ALLOWED_IPS', async () => {
    const auth = createAdminAuth({
      adminUsername: TEST_USERNAME,
      adminPasswordHash: TEST_PASSWORD_HASH,
      sessionSecret: TEST_SESSION_SECRET,
      cookieSecure: false,
      trustProxy: true,
      adminAllowedIps: ['198.51.100.7'],
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    await withTestServer(auth, async (baseUrl) => {
      // Blocked IP gets 403
      const blockedIpRes = await fetch(`${baseUrl}/api/admin/me`, {
        headers: { 'X-Forwarded-For': '198.51.100.8' },
      });
      assert.equal(blockedIpRes.status, 403);

      // Allowed IP without CSRF header gets 403 on login
      const noCsrfLogin = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.7',
        },
        body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
      });
      assert.equal(noCsrfLogin.status, 403);

      // Allowed IP with CSRF header logs in cleanly
      const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Forwarded-For': '198.51.100.7',
        },
        body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
      });
      assert.equal(loginRes.status, 200);
      const cookiePair = extractCookiePair(loginRes.headers.get('set-cookie'));

      // Protected POST without X-Requested-With gets 403 even with valid session cookie
      const noCsrfWrite = await fetch(`${baseUrl}/api/protected-write`, {
        method: 'POST',
        headers: {
          Cookie: cookiePair,
          'X-Forwarded-For': '198.51.100.7',
        },
      });
      assert.equal(noCsrfWrite.status, 403);
    });
  });

  it('protects /api/cron with CRON_SECRET (rejects when unset or invalid)', async () => {
    // 1. Unset CRON_SECRET -> always 401
    const authNoCron = createAdminAuth({
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });
    await withTestServer(authNoCron, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/cron`);
      assert.equal(res.status, 401);
    });

    // 2. Configured CRON_SECRET -> accepts X-Cron-Secret, Bearer, or ?secret=
    const authCron = createAdminAuth({
      cronSecret: 'my-super-cron-secret',
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });
    await withTestServer(authCron, async (baseUrl) => {
      assert.equal((await fetch(`${baseUrl}/api/cron`)).status, 401);
      assert.equal(
        (await fetch(`${baseUrl}/api/cron`, { headers: { 'X-Cron-Secret': 'wrong' } })).status,
        401
      );
      assert.equal(
        (await fetch(`${baseUrl}/api/cron`, { headers: { 'X-Cron-Secret': 'my-super-cron-secret' } })).status,
        200
      );
      assert.equal(
        (await fetch(`${baseUrl}/api/cron`, { headers: { Authorization: 'Bearer my-super-cron-secret' } })).status,
        200
      );
      assert.equal(
        (await fetch(`${baseUrl}/api/cron?secret=my-super-cron-secret`)).status,
        200
      );
    });
  });

  it('allows same-origin requests even when ALLOWED_ORIGINS is empty and blocks foreign origins', async () => {
    const auth = createAdminAuth({
      allowedOrigins: [],
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    await withTestServer(auth, async (baseUrl, port) => {
      const sameOrigin = `http://127.0.0.1:${port}`;

      // Same-origin request works when ALLOWED_ORIGINS is empty
      const sameRes = await fetch(`${baseUrl}/api/public`, {
        headers: { Origin: sameOrigin },
      });
      assert.equal(sameRes.status, 200);
      assert.equal(sameRes.headers.get('access-control-allow-origin'), sameOrigin);

      // Foreign origin OPTIONS preflight is rejected (403) with no ACAO header
      const foreignPreflight = await fetch(`${baseUrl}/api/public`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example' },
      });
      assert.equal(foreignPreflight.status, 403);
      assert.equal(foreignPreflight.headers.get('access-control-allow-origin'), null);

      // Foreign origin POST is blocked (403)
      const foreignPost = await fetch(`${baseUrl}/api/protected-write`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example', 'X-Requested-With': 'XMLHttpRequest' },
      });
      assert.equal(foreignPost.status, 403);
    });

    // Explicitly allowed cross-origin works
    const authWithAllowed = createAdminAuth({
      allowedOrigins: ['https://trusted.example'],
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });
    await withTestServer(authWithAllowed, async (baseUrl) => {
      const trustedRes = await fetch(`${baseUrl}/api/public`, {
        headers: { Origin: 'https://trusted.example' },
      });
      assert.equal(trustedRes.status, 200);
      assert.equal(trustedRes.headers.get('access-control-allow-origin'), 'https://trusted.example');
    });
  });

  it('scrubs secrets from audit log details', () => {
    const scrubbed = scrubAuditDetails({
      enabled: true,
      botToken: '123456:SECRET_BOT_TOKEN',
      password: 'my-password',
      sessionSecret: 'secret-value',
      nested: {
        api_key: 'xyz',
        notifyWickets: true,
      },
    });
    assert.equal(scrubbed.enabled, true);
    assert.equal(scrubbed.botToken, '[REDACTED]');
    assert.equal(scrubbed.password, '[REDACTED]');
    assert.equal(scrubbed.sessionSecret, '[REDACTED]');
    assert.deepEqual(scrubbed.nested, { api_key: '[REDACTED]', notifyWickets: true });
  });
});
