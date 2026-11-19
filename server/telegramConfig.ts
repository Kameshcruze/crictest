import type { QueryableDb } from './adminAuth';

export const TELEGRAM_CONFIG_DB_KEY = 'telegram_config';
export const TELEGRAM_TOKEN_SECRET_DB_KEY = 'telegram_bot_token_secret';
export const TELEGRAM_MIGRATION_FLAG_KEY = 'migration:telegram_strip_legacy_token_v1';

export type TelegramTokenSource = 'env' | 'db' | 'none';

export interface StoredTelegramSettings {
  chatId: string;
  enabled: boolean;
  notifyWickets: boolean;
  notifyResults: boolean;
  notifyOverCompletion: boolean;
  notifyPeriodicDigest: boolean;
  notifyStrategyEntries: boolean;
  digestIntervalMinutes: number;
}

export interface SafeTelegramStatus extends StoredTelegramSettings {
  configured: boolean;
  status: 'configured' | 'not configured';
  tokenSource: TelegramTokenSource;
  tokenLast4: string | null;
  hasEnvToken: boolean;
  hasDbToken: boolean;
}

export interface ResolvedTelegramToken {
  token: string;
  source: TelegramTokenSource;
  configured: boolean;
  tokenLast4: string | null;
  status: 'configured' | 'not configured';
}

export const DEFAULT_TELEGRAM_SETTINGS: StoredTelegramSettings = {
  chatId: '',
  enabled: false,
  notifyWickets: false,
  notifyResults: false,
  notifyOverCompletion: false,
  notifyPeriodicDigest: false,
  notifyStrategyEntries: false,
  digestIntervalMinutes: 3,
};

export function cleanBotToken(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/^bot/i, '');
}

export function maskTokenLast4(raw: string | undefined | null): string | null {
  const clean = cleanBotToken(raw);
  if (!clean) return null;
  return clean.slice(-4);
}

/**
 * Resolves the effective Telegram bot token.
 * Priority: TELEGRAM_BOT_TOKEN env var > admin-saved server-side DB secret > none.
 */
export function resolveEffectiveTelegramToken(
  envToken: string | undefined | null,
  dbSecretToken: string | undefined | null
): ResolvedTelegramToken {
  const cleanEnv = cleanBotToken(envToken);
  if (cleanEnv) {
    return {
      token: cleanEnv,
      source: 'env',
      configured: true,
      tokenLast4: maskTokenLast4(cleanEnv),
      status: 'configured',
    };
  }

  const cleanDb = cleanBotToken(dbSecretToken);
  if (cleanDb) {
    return {
      token: cleanDb,
      source: 'db',
      configured: true,
      tokenLast4: maskTokenLast4(cleanDb),
      status: 'configured',
    };
  }

  return {
    token: '',
    source: 'none',
    configured: false,
    tokenLast4: null,
    status: 'not configured',
  };
}

export function sanitizeStoredTelegramSettings(
  raw: Record<string, unknown> | null | undefined,
  fallback: StoredTelegramSettings = DEFAULT_TELEGRAM_SETTINGS
): StoredTelegramSettings {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const rawDigest = Number(obj.digestIntervalMinutes);
  const digestIntervalMinutes =
    Number.isFinite(rawDigest) && rawDigest >= 1 && rawDigest <= 1440
      ? Math.round(rawDigest)
      : fallback.digestIntervalMinutes;

  return {
    chatId: typeof obj.chatId === 'string' ? obj.chatId.trim() : fallback.chatId,
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : fallback.enabled,
    notifyWickets: typeof obj.notifyWickets === 'boolean' ? obj.notifyWickets : fallback.notifyWickets,
    notifyResults: typeof obj.notifyResults === 'boolean' ? obj.notifyResults : fallback.notifyResults,
    notifyOverCompletion:
      typeof obj.notifyOverCompletion === 'boolean'
        ? obj.notifyOverCompletion
        : fallback.notifyOverCompletion,
    notifyPeriodicDigest:
      typeof obj.notifyPeriodicDigest === 'boolean'
        ? obj.notifyPeriodicDigest
        : fallback.notifyPeriodicDigest,
    notifyStrategyEntries:
      typeof obj.notifyStrategyEntries === 'boolean'
        ? obj.notifyStrategyEntries
        : fallback.notifyStrategyEntries,
    digestIntervalMinutes,
  };
}

export function buildSafeTelegramStatus(params: {
  envToken?: string | null;
  envChatId?: string | null;
  dbSecretToken?: string | null;
  settings: StoredTelegramSettings;
}): SafeTelegramStatus {
  const resolved = resolveEffectiveTelegramToken(params.envToken, params.dbSecretToken);
  const effectiveChatId = params.settings.chatId || (params.envChatId || '').trim();
  const hasEnvToken = Boolean(cleanBotToken(params.envToken));
  const hasDbToken = Boolean(cleanBotToken(params.dbSecretToken));

  return {
    ...params.settings,
    chatId: effectiveChatId,
    configured: resolved.configured,
    status: resolved.status,
    tokenSource: resolved.source,
    tokenLast4: resolved.tokenLast4,
    hasEnvToken,
    hasDbToken,
  };
}

/**
 * One-time startup migration: strips the legacy plaintext `botToken` field from
 * `app_settings['telegram_config']` while preserving all notification toggles and `chatId`.
 * Guarded by `migration:telegram_strip_legacy_token_v1` in `app_settings`.
 */
export async function runOneTimeTelegramTokenMigration(
  db: QueryableDb,
  logger: Pick<Console, 'log' | 'warn'> = console
): Promise<{ migrated: boolean; hadLegacyToken: boolean }> {
  const flagRes = await db.query('SELECT key FROM app_settings WHERE key = $1 LIMIT 1', [
    TELEGRAM_MIGRATION_FLAG_KEY,
  ]);
  if (flagRes.rows.length > 0) {
    return { migrated: false, hadLegacyToken: false };
  }

  let hadLegacyToken = false;
  const cfgRes = await db.query('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', [
    TELEGRAM_CONFIG_DB_KEY,
  ]);

  if (cfgRes.rows.length > 0 && cfgRes.rows[0]?.value && typeof cfgRes.rows[0].value === 'object') {
    const existing = { ...(cfgRes.rows[0].value as Record<string, unknown>) };
    if ('botToken' in existing) {
      hadLegacyToken = Boolean(existing.botToken);
      delete existing.botToken;
      await db.query(
        `UPDATE app_settings SET value = $1::jsonb, updated_at = NOW() WHERE key = $2`,
        [JSON.stringify(existing), TELEGRAM_CONFIG_DB_KEY]
      );
      logger.log(
        `[Telegram Migration] Removed legacy plaintext botToken from app_settings['telegram_config'] (toggles and chatId preserved).`
      );
    }
  }

  await db.query(
    `INSERT INTO app_settings (key, value, description, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO NOTHING`,
    [
      TELEGRAM_MIGRATION_FLAG_KEY,
      JSON.stringify({ completedAt: new Date().toISOString(), hadLegacyToken }),
      'One-time migration removing legacy plaintext botToken from app_settings[telegram_config]',
    ]
  );

  return { migrated: true, hadLegacyToken };
}

export async function loadTelegramFromDb(db: QueryableDb): Promise<{
  settings: StoredTelegramSettings | null;
  dbSecretToken: string;
}> {
  const res = await db.query(
    'SELECT key, value FROM app_settings WHERE key = ANY($1::text[])',
    [[TELEGRAM_CONFIG_DB_KEY, TELEGRAM_TOKEN_SECRET_DB_KEY]]
  );

  let settings: StoredTelegramSettings | null = null;
  let dbSecretToken = '';

  for (const row of res.rows) {
    if (row.key === TELEGRAM_CONFIG_DB_KEY && row.value && typeof row.value === 'object') {
      settings = sanitizeStoredTelegramSettings(row.value as Record<string, unknown>);
    } else if (row.key === TELEGRAM_TOKEN_SECRET_DB_KEY && row.value && typeof row.value === 'object') {
      const tokenVal = (row.value as Record<string, unknown>).token;
      if (typeof tokenVal === 'string') {
        dbSecretToken = cleanBotToken(tokenVal);
      }
    }
  }

  return { settings, dbSecretToken };
}

export async function saveTelegramToDb(
  db: QueryableDb,
  currentSettings: StoredTelegramSettings,
  patch: Record<string, unknown>
): Promise<{
  settings: StoredTelegramSettings;
  tokenUpdated: boolean;
  tokenCleared: boolean;
}> {
  const nextSettings = sanitizeStoredTelegramSettings(patch, currentSettings);

  // Never store botToken inside app_settings['telegram_config']
  await db.query(
    `INSERT INTO app_settings (key, value, description, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [
      TELEGRAM_CONFIG_DB_KEY,
      JSON.stringify(nextSettings),
      'Telegram Bot notification toggles and chat ID (token stored separately or in env)',
    ]
  );

  let tokenUpdated = false;
  let tokenCleared = false;

  if (patch.clearStoredToken === true) {
    await db.query('DELETE FROM app_settings WHERE key = $1', [TELEGRAM_TOKEN_SECRET_DB_KEY]);
    tokenCleared = true;
  } else if (typeof patch.botToken === 'string' && cleanBotToken(patch.botToken).length > 0) {
    const clean = cleanBotToken(patch.botToken);
    await db.query(
      `INSERT INTO app_settings (key, value, description, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [
        TELEGRAM_TOKEN_SECRET_DB_KEY,
        JSON.stringify({ token: clean, updatedAt: new Date().toISOString() }),
        'Admin-saved Telegram Bot token (server-side only; never returned to browsers)',
      ]
    );
    tokenUpdated = true;
  }

  return { settings: nextSettings, tokenUpdated, tokenCleared };
}
