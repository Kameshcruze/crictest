import type { QueryableDb } from './adminAuth';
import { sanitizeCountryCode } from './adminRateLimit';

export const PUBLIC_SITE_CONFIG_DB_KEY = 'public_site_config';
export const STRATEGY_ALERTS_CONFIG_DB_KEY = 'strategy_alerts_config';

export interface PublicSiteConfig {
  defaultCountryCode: string;
  defaultSoundEnabled: boolean;
  maintenanceBannerEnabled: boolean;
  maintenanceBannerText: string;
}

export interface AdminSiteSettings extends PublicSiteConfig {
  allowedSeriesFilter: string[];
}

export interface StrategyAlertsStatus {
  enabled: boolean;
  source: 'db' | 'env';
  envDefault: boolean;
  updatedAt: string | null;
}

export const DEFAULT_ADMIN_SITE_SETTINGS: AdminSiteSettings = {
  defaultCountryCode: 'IN',
  defaultSoundEnabled: true,
  allowedSeriesFilter: [],
  maintenanceBannerEnabled: false,
  maintenanceBannerText: '',
};

export const READ_ONLY_REFRESH_INTERVALS = Object.freeze({
  goscorerPollMs: 1000,
  crexPoolPollMs: 2000,
  oddsPollMs: 1000,
  timelineSaveMs: 1000,
  telegramConfigSyncMs: 30000,
});

export function sanitizeSeriesFilterList(raw: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(trimmed.slice(0, 120));
    }
  }
  return cleaned;
}

export function sanitizeAdminSiteSettings(
  raw: Record<string, unknown> | null | undefined,
  fallback: AdminSiteSettings = DEFAULT_ADMIN_SITE_SETTINGS
): AdminSiteSettings {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const defaultCountryCode =
    obj.defaultCountryCode !== undefined
      ? sanitizeCountryCode(obj.defaultCountryCode, fallback.defaultCountryCode)
      : fallback.defaultCountryCode;

  const defaultSoundEnabled =
    typeof obj.defaultSoundEnabled === 'boolean'
      ? obj.defaultSoundEnabled
      : fallback.defaultSoundEnabled;

  const allowedSeriesFilter =
    obj.allowedSeriesFilter !== undefined
      ? sanitizeSeriesFilterList(obj.allowedSeriesFilter, fallback.allowedSeriesFilter)
      : [...fallback.allowedSeriesFilter];

  const maintenanceBannerEnabled =
    typeof obj.maintenanceBannerEnabled === 'boolean'
      ? obj.maintenanceBannerEnabled
      : fallback.maintenanceBannerEnabled;

  const maintenanceBannerText =
    typeof obj.maintenanceBannerText === 'string'
      ? obj.maintenanceBannerText.trim().slice(0, 500)
      : fallback.maintenanceBannerText;

  return {
    defaultCountryCode,
    defaultSoundEnabled,
    allowedSeriesFilter,
    maintenanceBannerEnabled,
    maintenanceBannerText,
  };
}

export function toPublicSiteConfig(settings: AdminSiteSettings): PublicSiteConfig {
  return {
    defaultCountryCode: settings.defaultCountryCode,
    defaultSoundEnabled: settings.defaultSoundEnabled,
    maintenanceBannerEnabled: settings.maintenanceBannerEnabled,
    maintenanceBannerText: settings.maintenanceBannerText,
  };
}

export async function loadAdminSiteSettingsFromDb(
  db: QueryableDb
): Promise<AdminSiteSettings | null> {
  const res = await db.query('SELECT value FROM app_settings WHERE key = $1 LIMIT 1', [
    PUBLIC_SITE_CONFIG_DB_KEY,
  ]);
  if (res.rows.length === 0 || !res.rows[0]?.value || typeof res.rows[0].value !== 'object') {
    return null;
  }
  return sanitizeAdminSiteSettings(res.rows[0].value as Record<string, unknown>);
}

export async function saveAdminSiteSettingsToDb(
  db: QueryableDb,
  current: AdminSiteSettings,
  patch: Record<string, unknown>
): Promise<AdminSiteSettings> {
  const next = sanitizeAdminSiteSettings(patch, current);
  await db.query(
    `INSERT INTO app_settings (key, value, description, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [
      PUBLIC_SITE_CONFIG_DB_KEY,
      JSON.stringify(next),
      'Admin-managed site defaults, allowed series filter, and maintenance banner',
    ]
  );
  return next;
}

export async function loadStrategyAlertsStatusFromDb(
  db: QueryableDb,
  envDefault: boolean
): Promise<StrategyAlertsStatus> {
  const res = await db.query('SELECT value, updated_at FROM app_settings WHERE key = $1 LIMIT 1', [
    STRATEGY_ALERTS_CONFIG_DB_KEY,
  ]);
  const row = res.rows[0];
  if (row?.value && typeof row.value === 'object' && typeof (row.value as any).enabled === 'boolean') {
    return {
      enabled: (row.value as any).enabled === true,
      source: 'db',
      envDefault,
      updatedAt:
        typeof (row.value as any).updatedAt === 'string'
          ? (row.value as any).updatedAt
          : row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : null,
    };
  }
  return {
    enabled: envDefault,
    source: 'env',
    envDefault,
    updatedAt: null,
  };
}

export async function saveStrategyAlertsOverrideToDb(
  db: QueryableDb,
  enabled: boolean,
  envDefault: boolean
): Promise<StrategyAlertsStatus> {
  const updatedAt = new Date().toISOString();
  await db.query(
    `INSERT INTO app_settings (key, value, description, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [
      STRATEGY_ALERTS_CONFIG_DB_KEY,
      JSON.stringify({ enabled: enabled === true, updatedAt }),
      'Master strategy Telegram alerts override (takes priority over STRATEGY_ALERTS_ENABLED env default)',
    ]
  );
  return {
    enabled: enabled === true,
    source: 'db',
    envDefault,
    updatedAt,
  };
}

export async function clearStrategyAlertsOverrideInDb(
  db: QueryableDb,
  envDefault: boolean
): Promise<StrategyAlertsStatus> {
  await db.query('DELETE FROM app_settings WHERE key = $1', [STRATEGY_ALERTS_CONFIG_DB_KEY]);
  return {
    enabled: envDefault,
    source: 'env',
    envDefault,
    updatedAt: null,
  };
}
