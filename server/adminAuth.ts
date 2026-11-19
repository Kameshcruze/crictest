import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';

export interface QueryableDb {
  query(text: string, values?: any[]): Promise<{ rows: any[] }>;
}

export const ADMIN_SESSION_COOKIE_NAME = 'crex_admin_session';
export const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const DEFAULT_LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_MAX_LOGIN_FAILURES = 5;

// Precomputed valid bcrypt hash (12 rounds) used when username does not match,
// guaranteeing constant-time bcrypt execution with zero user enumeration.
const DUMMY_BCRYPT_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKxGhu6/2M3f4s6N1V1sX2xQ3Y4z5A6b7C8d.';

const SENSITIVE_KEY_PATTERN = /(password|secret|token|cookie|authorization|hash|apikey|api_key)/i;

export interface AdminAuthConfig {
  adminUsername?: string;
  adminPasswordHash?: string;
  sessionSecret?: string;
  cookieSecure?: boolean;
  allowedOrigins?: string[];
  adminAllowedIps?: string[];
  cronSecret?: string;
  trustProxy?: boolean;
  sessionTtlMs?: number;
  lockoutWindowMs?: number;
  maxLoginFailures?: number;
  dbPool?: QueryableDb | null;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export interface AdminSessionRecord {
  sid: string;
  username: string;
  secretFingerprint: string;
  ip: string;
  createdAt: number;
  expiresAt: number;
}

export interface AdminAuditEntry {
  at: string;
  ip: string;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
}

export interface AuthenticatedAdminRequest extends Request {
  adminUser?: {
    username: string;
    sid: string;
    ip: string;
  };
}

export function normalizeIp(rawIp: string | undefined | null): string {
  if (!rawIp) return 'unknown';
  let ip = String(rawIp).trim();
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  if (ip === '::1') {
    return '127.0.0.1';
  }
  return ip || 'unknown';
}

export function getClientIp(req: Request, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
      return normalizeIp(xff);
    }
    if (Array.isArray(xff) && xff.length > 0) {
      return normalizeIp(xff[0]);
    }
    if (req.ip) {
      return normalizeIp(req.ip);
    }
  }
  const socketIp = req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip;
  return normalizeIp(socketIp);
}

export function parseCsvList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function isValidBcryptHash(hash: string): boolean {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);
}

export function computeSecretFingerprint(secret: string): string {
  return crypto.createHash('sha256').update(`crex-session-fp:${secret}`).digest('hex');
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

export function scrubAuditDetails(input: unknown, depth = 0): Record<string, unknown> {
  if (depth > 4 || !input || typeof input !== 'object') {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
      continue;
    }
    if (value === null || value === undefined) {
      result[key] = value ?? null;
    } else if (typeof value === 'string') {
      result[key] = value.length > 240 ? `${value.slice(0, 240)}…` : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.slice(0, 20).map((item) =>
        typeof item === 'object' && item !== null ? scrubAuditDetails(item, depth + 1) : item
      );
    } else if (typeof value === 'object') {
      result[key] = scrubAuditDetails(value, depth + 1);
    }
  }
  return result;
}

export function buildAdminAuthConfigFromEnv(
  env: NodeJS.ProcessEnv,
  dbPool?: QueryableDb | null
): AdminAuthConfig {
  const cookieSecure = env.COOKIE_SECURE === undefined ? true : env.COOKIE_SECURE.toLowerCase() !== 'false';
  const trustProxy = env.TRUST_PROXY === 'true';
  return {
    adminUsername: (env.ADMIN_USERNAME || '').trim(),
    adminPasswordHash: (env.ADMIN_PASSWORD_HASH || '').trim(),
    sessionSecret: (env.SESSION_SECRET || '').trim(),
    cookieSecure,
    allowedOrigins: parseCsvList(env.ALLOWED_ORIGINS),
    adminAllowedIps: parseCsvList(env.ADMIN_ALLOWED_IPS).map(normalizeIp),
    cronSecret: (env.CRON_SECRET || '').trim(),
    trustProxy,
    dbPool: dbPool ?? null,
  };
}

export function createAdminAuth(config: AdminAuthConfig) {
  const adminUsername = (config.adminUsername || '').trim();
  const adminPasswordHash = (config.adminPasswordHash || '').trim();
  const sessionSecret = (config.sessionSecret || '').trim();
  const cookieSecure = config.cookieSecure !== false;
  const allowedOrigins = (config.allowedOrigins || []).map((o) => o.replace(/\/+$/, ''));
  const adminAllowedIps = (config.adminAllowedIps || []).map(normalizeIp).filter(Boolean);
  const cronSecret = (config.cronSecret || '').trim();
  const trustProxy = Boolean(config.trustProxy);
  const sessionTtlMs = config.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const lockoutWindowMs = config.lockoutWindowMs ?? DEFAULT_LOCKOUT_WINDOW_MS;
  const maxLoginFailures = config.maxLoginFailures ?? DEFAULT_MAX_LOGIN_FAILURES;
  const logger = config.logger || console;

  let activeDbPool: QueryableDb | null = config.dbPool ?? null;

  const missingConfigFields: string[] = [];
  if (!adminUsername) missingConfigFields.push('ADMIN_USERNAME');
  if (!adminPasswordHash) {
    missingConfigFields.push('ADMIN_PASSWORD_HASH');
  } else if (!isValidBcryptHash(adminPasswordHash)) {
    missingConfigFields.push('ADMIN_PASSWORD_HASH (invalid bcrypt format)');
  }
  if (!sessionSecret) missingConfigFields.push('SESSION_SECRET');

  const isConfigured = missingConfigFields.length === 0;
  const secretFingerprint = isConfigured ? computeSecretFingerprint(sessionSecret) : '';

  // Server-side active session cache (backed by PostgreSQL admin_sessions table when DB is online)
  const sessionsMemory = new Map<string, AdminSessionRecord>();

  // Per-IP failed login attempts timestamps (sliding window)
  const failedAttemptsByIp = new Map<string, number[]>();

  // In-memory ring buffer fallback for audit entries (max 500 entries)
  const recentAuditEntries: AdminAuditEntry[] = [];

  function setDbPool(pool: QueryableDb | null) {
    activeDbPool = pool;
  }

  function logStartupStatus() {
    if (!isConfigured) {
      logger.warn(
        `\n======================================================\n` +
          `[Admin Auth] DISABLED — Missing required environment variables: ${missingConfigFields.join(', ')}\n` +
          `[Admin Auth] POST /api/admin/login will return 503 until all three are configured.\n` +
          `[Admin Auth] No default credentials or fallback secrets are ever used.\n` +
          `[Admin Auth] Generate a password hash with: npm run admin:hash\n` +
          `======================================================\n`
      );
    } else {
      logger.log(
        `[Admin Auth] ENABLED | username=${adminUsername} | cookieSecure=${cookieSecure} | trustProxy=${trustProxy} | ipAllowlist=${
          adminAllowedIps.length > 0 ? adminAllowedIps.join(',') : 'ANY'
        }`
      );
    }
    if (!cronSecret) {
      logger.warn(`[Cron Auth] CRON_SECRET is not set — /api/cron and /api/telegram/cron will reject all requests (401).`);
    }
  }

  async function ensureAuthTables(queryable?: QueryableDb | null): Promise<void> {
    const db = queryable ?? activeDbPool;
    if (!db) return;

    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id BIGSERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ip VARCHAR(64),
        action VARCHAR(64) NOT NULL,
        target VARCHAR(128),
        details JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_log_at ON admin_audit_log (at DESC);

      CREATE TABLE IF NOT EXISTS admin_sessions (
        sid VARCHAR(96) PRIMARY KEY,
        username VARCHAR(128) NOT NULL,
        secret_fingerprint VARCHAR(64) NOT NULL,
        ip VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions (expires_at);
    `);

    // Prune expired sessions and drop any sessions belonging to a previous SESSION_SECRET.
    // Sessions matching the current SESSION_SECRET survive server restarts!
    if (isConfigured) {
      await db.query(
        `DELETE FROM admin_sessions WHERE expires_at <= NOW() OR secret_fingerprint <> $1`,
        [secretFingerprint]
      );
      const activeRes = await db.query(
        `SELECT sid, username, secret_fingerprint, ip, created_at, expires_at
         FROM admin_sessions
         WHERE expires_at > NOW() AND secret_fingerprint = $1`,
        [secretFingerprint]
      );
      for (const row of activeRes.rows) {
        sessionsMemory.set(row.sid, {
          sid: row.sid,
          username: row.username,
          secretFingerprint: row.secret_fingerprint,
          ip: row.ip || 'unknown',
          createdAt: new Date(row.created_at).getTime(),
          expiresAt: new Date(row.expires_at).getTime(),
        });
      }
    } else {
      // If admin auth is unconfigured, ensure no stale sessions remain valid
      await db.query(`DELETE FROM admin_sessions WHERE expires_at <= NOW()`);
    }
  }

  async function recordAdminAudit(
    action: string,
    target: string | null,
    details: Record<string, unknown> = {},
    ip = 'server'
  ): Promise<void> {
    const cleanDetails = scrubAuditDetails(details);
    const entry: AdminAuditEntry = {
      at: new Date().toISOString(),
      ip: normalizeIp(ip),
      action,
      target,
      details: cleanDetails,
    };
    recentAuditEntries.unshift(entry);
    if (recentAuditEntries.length > 500) {
      recentAuditEntries.length = 500;
    }
    if (!activeDbPool) return;
    try {
      await activeDbPool.query(
        `INSERT INTO admin_audit_log (ip, action, target, details) VALUES ($1, $2, $3, $4::jsonb)`,
        [entry.ip, entry.action, entry.target, JSON.stringify(entry.details)]
      );
    } catch {
      // Non-blocking if DB is temporarily offline
    }
  }

  function signSessionId(sid: string): string {
    const sig = crypto.createHmac('sha256', sessionSecret).update(sid).digest('hex');
    return `${sid}.${sig}`;
  }

  function verifySignedCookie(rawCookieValue: string | undefined): string | null {
    if (!isConfigured || !rawCookieValue) return null;
    const dotIdx = rawCookieValue.indexOf('.');
    if (dotIdx <= 0 || dotIdx === rawCookieValue.length - 1) return null;
    const sid = rawCookieValue.slice(0, dotIdx);
    const providedSig = rawCookieValue.slice(dotIdx + 1);
    if (!/^[a-f0-9]{32,96}$/i.test(sid) || !/^[a-f0-9]{64}$/i.test(providedSig)) {
      return null;
    }
    const expectedSig = crypto.createHmac('sha256', sessionSecret).update(sid).digest('hex');
    const bufA = Buffer.from(providedSig, 'hex');
    const bufB = Buffer.from(expectedSig, 'hex');
    if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
      return null;
    }
    return sid;
  }

  function buildSessionCookieHeader(signedValue: string, maxAgeSeconds: number): string {
    const parts = [
      `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(signedValue)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${maxAgeSeconds}`,
    ];
    if (cookieSecure) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }

  function buildClearCookieHeader(): string {
    const parts = [
      `${ADMIN_SESSION_COOKIE_NAME}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      'Max-Age=0',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ];
    if (cookieSecure) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }

  async function createSession(username: string, ip: string): Promise<{ record: AdminSessionRecord; cookieValue: string }> {
    const sid = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + sessionTtlMs;
    const record: AdminSessionRecord = {
      sid,
      username,
      secretFingerprint,
      ip: normalizeIp(ip),
      createdAt: now,
      expiresAt,
    };

    sessionsMemory.set(sid, record);

    if (activeDbPool) {
      try {
        await activeDbPool.query(
          `INSERT INTO admin_sessions (sid, username, secret_fingerprint, ip, created_at, expires_at)
           VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0))`,
          [sid, username, secretFingerprint, record.ip, now, expiresAt]
        );
      } catch {
        // Keep in-memory session active if DB is temporarily offline
      }
    }

    return { record, cookieValue: signSessionId(sid) };
  }

  async function validateSessionFromRequest(req: Request): Promise<AdminSessionRecord | null> {
    if (!isConfigured) return null;
    const cookies = parseCookieHeader(req.headers.cookie);
    const sid = verifySignedCookie(cookies[ADMIN_SESSION_COOKIE_NAME]);
    if (!sid) return null;

    const now = Date.now();
    const memRecord = sessionsMemory.get(sid);
    if (memRecord) {
      if (memRecord.expiresAt <= now || memRecord.secretFingerprint !== secretFingerprint) {
        sessionsMemory.delete(sid);
        void destroySessionById(sid);
        return null;
      }
      return memRecord;
    }

    // Check PostgreSQL in case the server restarted with the same SESSION_SECRET
    if (activeDbPool) {
      try {
        const res = await activeDbPool.query(
          `SELECT sid, username, secret_fingerprint, ip, created_at, expires_at
           FROM admin_sessions
           WHERE sid = $1 LIMIT 1`,
          [sid]
        );
        const row = res.rows[0];
        if (!row) return null;
        const expiresAt = new Date(row.expires_at).getTime();
        if (expiresAt <= now || row.secret_fingerprint !== secretFingerprint) {
          await activeDbPool.query(`DELETE FROM admin_sessions WHERE sid = $1`, [sid]).catch(() => {});
          return null;
        }
        const hydrated: AdminSessionRecord = {
          sid: row.sid,
          username: row.username,
          secretFingerprint: row.secret_fingerprint,
          ip: row.ip || 'unknown',
          createdAt: new Date(row.created_at).getTime(),
          expiresAt,
        };
        sessionsMemory.set(sid, hydrated);
        return hydrated;
      } catch {
        return null;
      }
    }

    return null;
  }

  async function destroySessionById(sid: string): Promise<void> {
    sessionsMemory.delete(sid);
    if (activeDbPool) {
      try {
        await activeDbPool.query(`DELETE FROM admin_sessions WHERE sid = $1`, [sid]);
      } catch {
        // Non-blocking
      }
    }
  }

  function isIpAllowed(ip: string): boolean {
    if (adminAllowedIps.length === 0) return true;
    const norm = normalizeIp(ip);
    return adminAllowedIps.includes(norm);
  }

  function getLockoutState(ip: string): { locked: boolean; retryAfterSec: number; failures: number } {
    const now = Date.now();
    const existing = (failedAttemptsByIp.get(ip) || []).filter((ts) => now - ts < lockoutWindowMs);
    if (existing.length === 0) {
      failedAttemptsByIp.delete(ip);
      return { locked: false, retryAfterSec: 0, failures: 0 };
    }
    failedAttemptsByIp.set(ip, existing);
    if (existing.length >= maxLoginFailures) {
      const oldest = existing[0];
      const retryAfterMs = Math.max(1000, lockoutWindowMs - (now - oldest));
      return {
        locked: true,
        retryAfterSec: Math.ceil(retryAfterMs / 1000),
        failures: existing.length,
      };
    }
    return { locked: false, retryAfterSec: 0, failures: existing.length };
  }

  function recordFailedAttempt(ip: string): number {
    const now = Date.now();
    const existing = (failedAttemptsByIp.get(ip) || []).filter((ts) => now - ts < lockoutWindowMs);
    existing.push(now);
    failedAttemptsByIp.set(ip, existing);
    return existing.length;
  }

  function clearFailedAttempts(ip: string): void {
    failedAttemptsByIp.delete(ip);
  }

  function hasValidCsrfHeader(req: Request): boolean {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }
    const headerVal = req.headers['x-requested-with'];
    if (typeof headerVal === 'string') {
      return headerVal.trim().length > 0;
    }
    if (Array.isArray(headerVal)) {
      return headerVal.some((v) => v.trim().length > 0);
    }
    return false;
  }

  // CORS middleware: same-origin ALWAYS allowed; ALLOWED_ORIGINS controls cross-origin access only.
  function corsMiddleware(req: Request, res: Response, next: NextFunction) {
    const rawOrigin = req.headers.origin;
    if (!rawOrigin || typeof rawOrigin !== 'string') {
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      return next();
    }

    const origin = rawOrigin.replace(/\/+$/, '');
    const host = req.get('host') || '';
    const proto = trustProxy
      ? String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
          .split(',')[0]
          .trim()
      : req.protocol || 'http';
    const selfOrigin = host ? `${proto}://${host}` : '';
    const isSameOrigin = Boolean(selfOrigin && origin === selfOrigin);
    const isExplicitlyAllowed = allowedOrigins.includes(origin);

    if (isSameOrigin || isExplicitlyAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, X-Cron-Secret, Cache-Control, Pragma'
      );
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      return next();
    }

    // Foreign origin not in ALLOWED_ORIGINS
    if (req.method === 'OPTIONS') {
      return res.status(403).json({ ok: false, error: 'CORS origin not allowed' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(403).json({ ok: false, error: 'Cross-origin request blocked' });
    }
    return next();
  }

  function requireAdminIp(req: Request, res: Response, next: NextFunction) {
    const ip = getClientIp(req, trustProxy);
    if (!isIpAllowed(ip)) {
      void recordAdminAudit('IP_BLOCKED', req.originalUrl || req.path, { method: req.method }, ip);
      return res.status(403).json({ ok: false, error: 'Access denied from this IP address' });
    }
    return next();
  }

  function requireCsrfHeader(req: Request, res: Response, next: NextFunction) {
    if (!hasValidCsrfHeader(req)) {
      return res.status(403).json({
        ok: false,
        error: 'Missing required CSRF header (X-Requested-With)',
      });
    }
    return next();
  }

  async function requireAdmin(req: AuthenticatedAdminRequest, res: Response, next: NextFunction) {
    const ip = getClientIp(req, trustProxy);
    if (!isIpAllowed(ip)) {
      void recordAdminAudit('IP_BLOCKED', req.originalUrl || req.path, { method: req.method }, ip);
      return res.status(403).json({ ok: false, error: 'Access denied from this IP address' });
    }

    if (!hasValidCsrfHeader(req)) {
      return res.status(403).json({
        ok: false,
        error: 'Missing required CSRF header (X-Requested-With)',
      });
    }

    const session = await validateSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Admin authentication required' });
    }

    req.adminUser = {
      username: session.username,
      sid: session.sid,
      ip,
    };
    return next();
  }

  function requireCronSecret(req: Request, res: Response, next: NextFunction) {
    if (!cronSecret) {
      return res.status(401).json({ ok: false, error: 'Cron authentication is not configured' });
    }

    let provided = '';
    const headerSecret = req.headers['x-cron-secret'];
    if (typeof headerSecret === 'string' && headerSecret.trim()) {
      provided = headerSecret.trim();
    } else if (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')) {
      provided = req.headers.authorization.slice(7).trim();
    } else if (typeof req.query.secret === 'string' && req.query.secret.trim()) {
      provided = req.query.secret.trim();
    }

    if (!provided || !timingSafeStringEqual(provided, cronSecret)) {
      return res.status(401).json({ ok: false, error: 'Invalid or missing cron secret' });
    }

    return next();
  }

  async function handleLogin(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const ip = getClientIp(req, trustProxy);

    if (!isIpAllowed(ip)) {
      void recordAdminAudit('IP_BLOCKED', '/api/admin/login', { method: 'POST' }, ip);
      return res.status(403).json({ ok: false, error: 'Access denied from this IP address' });
    }

    if (!hasValidCsrfHeader(req)) {
      return res.status(403).json({
        ok: false,
        error: 'Missing required CSRF header (X-Requested-With)',
      });
    }

    if (!isConfigured) {
      return res.status(503).json({
        ok: false,
        error: 'Admin authentication is not configured',
      });
    }

    const lockState = getLockoutState(ip);
    if (lockState.locked) {
      res.setHeader('Retry-After', String(lockState.retryAfterSec));
      void recordAdminAudit(
        'LOGIN_LOCKED',
        '/api/admin/login',
        { failures: lockState.failures, retryAfterSec: lockState.retryAfterSec },
        ip
      );
      return res.status(429).json({
        ok: false,
        error: 'Too many failed login attempts. Please try again later.',
      });
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const submittedUsername = typeof body.username === 'string' ? body.username.trim() : '';
    const submittedPassword = typeof body.password === 'string' ? body.password : '';

    const usernameMatches = submittedUsername.length > 0 && timingSafeStringEqual(submittedUsername, adminUsername);
    const hashToVerify = usernameMatches ? adminPasswordHash : DUMMY_BCRYPT_HASH;

    let passwordMatches = false;
    try {
      passwordMatches = await bcrypt.compare(submittedPassword, hashToVerify);
    } catch {
      passwordMatches = false;
    }

    if (!usernameMatches || !passwordMatches) {
      const failures = recordFailedAttempt(ip);
      void recordAdminAudit('LOGIN_FAILED', '/api/admin/login', { failures }, ip);
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    clearFailedAttempts(ip);
    const { record, cookieValue } = await createSession(adminUsername, ip);
    res.setHeader('Set-Cookie', buildSessionCookieHeader(cookieValue, Math.floor(sessionTtlMs / 1000)));
    void recordAdminAudit('LOGIN_SUCCESS', '/api/admin/login', { username: adminUsername }, ip);

    return res.json({
      ok: true,
      authenticated: true,
      username: record.username,
      expiresAt: new Date(record.expiresAt).toISOString(),
    });
  }

  async function handleLogout(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const ip = getClientIp(req, trustProxy);

    if (!isIpAllowed(ip)) {
      void recordAdminAudit('IP_BLOCKED', '/api/admin/logout', { method: 'POST' }, ip);
      return res.status(403).json({ ok: false, error: 'Access denied from this IP address' });
    }

    if (!hasValidCsrfHeader(req)) {
      return res.status(403).json({
        ok: false,
        error: 'Missing required CSRF header (X-Requested-With)',
      });
    }

    const cookies = parseCookieHeader(req.headers.cookie);
    const sid = verifySignedCookie(cookies[ADMIN_SESSION_COOKIE_NAME]);
    if (sid) {
      await destroySessionById(sid);
    }

    res.setHeader('Set-Cookie', buildClearCookieHeader());
    void recordAdminAudit('LOGOUT', '/api/admin/logout', { hadSession: Boolean(sid) }, ip);

    return res.json({ ok: true, authenticated: false });
  }

  async function handleMe(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const ip = getClientIp(req, trustProxy);

    if (!isIpAllowed(ip)) {
      void recordAdminAudit('IP_BLOCKED', '/api/admin/me', { method: 'GET' }, ip);
      return res.status(403).json({ ok: false, error: 'Access denied from this IP address' });
    }

    if (!isConfigured) {
      return res.json({
        ok: true,
        authenticated: false,
        configured: false,
      });
    }

    const session = await validateSessionFromRequest(req);
    if (!session) {
      return res.json({
        ok: true,
        authenticated: false,
        configured: true,
      });
    }

    return res.json({
      ok: true,
      authenticated: true,
      configured: true,
      username: session.username,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  }

  return {
    isConfigured,
    missingConfigFields,
    cookieSecure,
    trustProxy,
    secretFingerprint,
    setDbPool,
    logStartupStatus,
    ensureAuthTables,
    recordAdminAudit,
    getClientIp: (req: Request) => getClientIp(req, trustProxy),
    getRecentAuditEntries: () => [...recentAuditEntries],
    getActiveSessionCount: () => sessionsMemory.size,
    corsMiddleware,
    requireAdminIp,
    requireCsrfHeader,
    requireAdmin,
    requireCronSecret,
    handleLogin,
    handleLogout,
    handleMe,
  };
}
