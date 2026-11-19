import type { SafeTelegramConfigStatus } from './telegramService';
import type { RawApiResponse } from '../types/cricket';
import type { SerializedMatchStrategyState, PositionType } from './strategy/types';
import type { StrategyConfig } from './strategy/config';

export class AdminSessionExpiredError extends Error {
  constructor(message = 'Your admin session has expired. Please sign in again.') {
    super(message);
    this.name = 'AdminSessionExpiredError';
  }
}

export class AdminApiError extends Error {
  status: number;
  retryAfterSec?: number;

  constructor(message: string, status: number, retryAfterSec?: number) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export interface AdminSessionInfo {
  ok: boolean;
  authenticated: boolean;
  configured: boolean;
  username?: string;
  expiresAt?: string;
}

export interface StrategyAlertsStatus {
  enabled: boolean;
  source: 'db' | 'env';
  envDefault: boolean;
  updatedAt: string | null;
}

export interface PublicSiteConfig {
  defaultCountryCode: string;
  defaultSoundEnabled: boolean;
  maintenanceBannerEnabled: boolean;
  maintenanceBannerText: string;
}

export interface AdminSiteSettings extends PublicSiteConfig {
  allowedSeriesFilter: string[];
}

export interface ReadOnlyRefreshIntervals {
  goscorerPollMs: number;
  crexPoolPollMs: number;
  oddsPollMs: number;
  timelineSaveMs: number;
  telegramConfigSyncMs: number;
}

export interface AdminSettingsResponse {
  ok: boolean;
  data: AdminSiteSettings;
  refreshIntervals: ReadOnlyRefreshIntervals;
  liveMatchesCount?: number;
  prunedMatchesCount?: number;
  timestamp?: string;
}

export interface SeriesPreviewExcludedMatch {
  id: string;
  title: string;
  seriesName: string;
  format: string;
}

export interface SeriesPreviewResponse {
  ok: boolean;
  allowedSeriesFilter: string[];
  totalLive: number;
  includedLive: number;
  excludedLive: SeriesPreviewExcludedMatch[];
}

export interface AdminOverviewData {
  ok: boolean;
  server: {
    uptimeSec: number;
    nodeEnv: string;
    cookieSecure: boolean;
    trustProxy: boolean;
    sseClientsCount: number;
    activeSessionsCount: number;
    lastFeedSyncAt: string | null;
  };
  matches: {
    total: number;
    live: number;
  };
  db: {
    connected: boolean;
    matchesCount: number;
    teamsCount: number;
    positionsCount: number;
    tradesCount: number;
    error: string | null;
  };
  strategy: {
    alertsEnabled: boolean;
    alertsSource: 'db' | 'env';
    alertsEnvDefault: boolean;
    leaderActive: boolean;
    pendingOutbox: { trades: number; signals: number; positions: number };
    trackedStatesCount: number;
  };
  telegram: SafeTelegramConfigStatus;
  timestamp: string;
}

export interface AdminStrategyMatchItem {
  id: string;
  title: string;
  team1: string;
  team2: string;
  team1Name: string;
  team2Name: string;
  seriesName: string;
  format: string;
  status: 'live' | 'upcoming' | 'completed';
  innings: number;
  over: number;
  wickets: number;
  score1: string | null;
  score2: string | null;
  decimalBack: number | null;
  decimalLay: number | null;
  favTeam: string | null;
  state: SerializedMatchStrategyState | null;
}

export interface AdminStrategyRulesResponse {
  ok: boolean;
  rules: StrategyConfig;
  strategyAlerts: StrategyAlertsStatus;
  strategyAlertsEnabled: boolean;
  leaderActive: boolean;
  pendingOutbox: { trades: number; signals: number; positions: number };
  matches: AdminStrategyMatchItem[];
  states: Record<string, SerializedMatchStrategyState>;
  timestamp: string;
}

export interface AdminOddsDiagnosticItem {
  matchId: string;
  title: string;
  seriesName: string;
  format: string;
  matchStatus: 'live' | 'upcoming' | 'completed';
  score1: string | null;
  score2: string | null;
  cached: boolean;
  cacheAgeMs: number | null;
  oddsStatus: string;
  lastSuccessAt: string | null;
  consecutiveMisses: number;
  errorMessage: string | null;
  favTeam: string | null;
  backRate: number | null;
  layRate: number | null;
  decimalBack: number | null;
  decimalLay: number | null;
  rawF: string | null;
  rawFlb: string | null;
  rawSnapshot: Record<string, unknown> | null;
}

export interface AdminOddsDiagnosticsResponse {
  ok: boolean;
  totalMatches: number;
  cachedOddsCount: number;
  items: AdminOddsDiagnosticItem[];
  timestamp: string;
}

export interface AdminDbStatusResponse {
  ok: boolean;
  connected: boolean;
  database: string;
  url: string;
  matchesCount?: number;
  teamsCount?: number;
  positionsCount?: number;
  tradesCount?: number;
  settingsFound?: string[];
  error?: string;
  timestamp: string;
}

export interface AdminAuditEntryItem {
  id?: number | string;
  at: string;
  ip: string;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
}

export interface AdminAuditLogResponse {
  ok: boolean;
  source: 'postgres' | 'memory';
  entries: AdminAuditEntryItem[];
}

export interface AdminRawTopMatchesResponse {
  ok: boolean;
  cc: string;
  latencyMs: number;
  totalCount: number;
  matches: RawApiResponse;
  timestamp: string;
}

async function adminRequest<T>(
  url: string,
  options: RequestInit = {},
  { treat401AsExpired = true }: { treat401AsExpired?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers,
  });

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (res.status === 401 && treat401AsExpired) {
    throw new AdminSessionExpiredError(
      payload?.error || 'Your admin session has expired. Please sign in again.'
    );
  }

  if (!res.ok) {
    const retryHeader = res.headers.get('Retry-After');
    const retryAfterSec =
      typeof payload?.retryAfterSec === 'number'
        ? payload.retryAfterSec
        : retryHeader
        ? parseInt(retryHeader, 10)
        : undefined;
    throw new AdminApiError(
      payload?.error || payload?.description || `Request failed (${res.status})`,
      res.status,
      Number.isFinite(retryAfterSec) ? retryAfterSec : undefined
    );
  }

  return payload as T;
}

export function fetchAdminMe(): Promise<AdminSessionInfo> {
  return adminRequest<AdminSessionInfo>('/api/admin/me', { method: 'GET' }, { treat401AsExpired: false });
}

export function adminLogin(username: string, password: string): Promise<AdminSessionInfo> {
  return adminRequest<AdminSessionInfo>(
    '/api/admin/login',
    {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    },
    { treat401AsExpired: false }
  );
}

export function adminLogout(): Promise<{ ok: boolean; authenticated: boolean }> {
  return adminRequest<{ ok: boolean; authenticated: boolean }>(
    '/api/admin/logout',
    { method: 'POST', body: JSON.stringify({}) },
    { treat401AsExpired: false }
  );
}

export function fetchAdminOverview(): Promise<AdminOverviewData> {
  return adminRequest<AdminOverviewData>('/api/admin/overview', { method: 'GET' });
}

export function fetchAdminTelegramStatus(): Promise<{ ok: boolean; data: SafeTelegramConfigStatus }> {
  return adminRequest<{ ok: boolean; data: SafeTelegramConfigStatus }>('/api/admin/telegram', {
    method: 'GET',
  });
}

export function saveAdminTelegramConfig(
  patch: Partial<{
    chatId: string;
    enabled: boolean;
    notifyWickets: boolean;
    notifyResults: boolean;
    notifyOverCompletion: boolean;
    notifyPeriodicDigest: boolean;
    notifyStrategyEntries: boolean;
    digestIntervalMinutes: number;
    botToken: string;
    clearStoredToken: boolean;
  }>
): Promise<{ ok: boolean; data: SafeTelegramConfigStatus }> {
  return adminRequest<{ ok: boolean; data: SafeTelegramConfigStatus }>('/api/admin/telegram', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

export function sendAdminTelegramTest(chatId?: string): Promise<any> {
  return adminRequest<any>('/api/admin/telegram/test', {
    method: 'POST',
    body: JSON.stringify(chatId ? { chatId } : {}),
  });
}

export function sendAdminTelegramTestOver(matchId?: string): Promise<any> {
  return adminRequest<any>('/api/telegram/test-over', {
    method: 'POST',
    body: JSON.stringify(matchId ? { matchId } : {}),
  });
}

export function sendAdminTelegramBroadcast(params: {
  text: string;
  chatId?: string;
  confirm: boolean;
}): Promise<any> {
  return adminRequest<any>('/api/admin/telegram/broadcast', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function fetchAdminStrategyRules(): Promise<AdminStrategyRulesResponse> {
  return adminRequest<AdminStrategyRulesResponse>('/api/admin/strategy/rules', { method: 'GET' });
}

export function postAdminManualEntry(params: {
  matchId: string;
  positionType: PositionType;
  entryOdds: number;
  innings: number;
  over: number;
  wickets: number;
  bookingTeam: string;
  battingTeam?: string;
  bowlingTeam?: string;
  matchName?: string;
  seriesName?: string;
}): Promise<{ ok: boolean; state: SerializedMatchStrategyState }> {
  const { matchId, ...body } = params;
  return adminRequest<{ ok: boolean; state: SerializedMatchStrategyState }>(
    `/api/strategy/${encodeURIComponent(matchId)}/override-entry`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  );
}

export function postAdminManualExit(params: {
  matchId: string;
  positionType: PositionType;
  exitOdds: number;
  over: number;
  exitReason?: string;
}): Promise<{ ok: boolean; state: SerializedMatchStrategyState }> {
  const { matchId, ...body } = params;
  return adminRequest<{ ok: boolean; state: SerializedMatchStrategyState }>(
    `/api/strategy/${encodeURIComponent(matchId)}/override-exit`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  );
}

export function postAdminStrategyReset(
  matchId: string
): Promise<{ ok: boolean; state: SerializedMatchStrategyState }> {
  return adminRequest<{ ok: boolean; state: SerializedMatchStrategyState }>(
    `/api/strategy/${encodeURIComponent(matchId)}/reset`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
}

export function fetchAdminOddsDiagnostics(): Promise<AdminOddsDiagnosticsResponse> {
  return adminRequest<AdminOddsDiagnosticsResponse>('/api/admin/diagnostics/odds', {
    method: 'GET',
  });
}

export function fetchAdminRawTopMatches(
  cc: string,
  forceRefresh = false
): Promise<AdminRawTopMatchesResponse> {
  return adminRequest<AdminRawTopMatchesResponse>('/api/admin/diagnostics/raw-top-matches', {
    method: 'POST',
    body: JSON.stringify({ cc, forceRefresh }),
  });
}

export function fetchAdminDbStatus(): Promise<AdminDbStatusResponse> {
  return adminRequest<AdminDbStatusResponse>('/api/db/status', { method: 'GET' });
}

export function fetchAdminAuditLog(limit = 100, action?: string): Promise<AdminAuditLogResponse> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (action && action.trim()) qs.set('action', action.trim());
  return adminRequest<AdminAuditLogResponse>(`/api/admin/audit-log?${qs.toString()}`, {
    method: 'GET',
  });
}

export function fetchAdminSettings(): Promise<AdminSettingsResponse> {
  return adminRequest<AdminSettingsResponse>('/api/admin/settings', { method: 'GET' });
}

export function previewAdminSeriesFilter(
  allowedSeriesFilter: string[]
): Promise<SeriesPreviewResponse> {
  return adminRequest<SeriesPreviewResponse>('/api/admin/settings/preview-series', {
    method: 'POST',
    body: JSON.stringify({ allowedSeriesFilter }),
  });
}

export function saveAdminSettings(
  patch: Partial<AdminSiteSettings>
): Promise<AdminSettingsResponse> {
  return adminRequest<AdminSettingsResponse>('/api/admin/settings', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

export function toggleAdminStrategyAlerts(payload: {
  enabled?: boolean;
  confirm?: boolean;
  resetToEnvDefault?: boolean;
}): Promise<{ ok: boolean; strategyAlerts: StrategyAlertsStatus }> {
  return adminRequest<{ ok: boolean; strategyAlerts: StrategyAlertsStatus }>(
    '/api/admin/strategy/alerts',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export async function fetchPublicSiteConfig(): Promise<
  (PublicSiteConfig & { ok: boolean; timestamp?: string }) | null
> {
  try {
    const res = await fetch('/api/public/config', {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.ok !== true) return null;
    return data as PublicSiteConfig & { ok: boolean; timestamp?: string };
  } catch {
    return null;
  }
}
