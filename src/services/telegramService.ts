/**
 * Client-side Telegram types & legacy localStorage cleanup helper.
 *
 * All Telegram credentials and automated alert dispatches live exclusively
 * on the server (server.ts / server/telegramConfig.ts). No bot tokens or
 * chat IDs are ever bundled into or persisted by the browser.
 */

export interface SafeTelegramConfigStatus {
  configured: boolean;
  status: 'configured' | 'not configured';
  tokenSource: 'env' | 'db' | 'none';
  tokenLast4: string | null;
  hasEnvToken: boolean;
  hasDbToken: boolean;
  chatId: string;
  enabled: boolean;
  notifyWickets: boolean;
  notifyResults: boolean;
  notifyOverCompletion: boolean;
  notifyPeriodicDigest: boolean;
  notifyStrategyEntries: boolean;
  digestIntervalMinutes: number;
}

const LEGACY_TELEGRAM_STORAGE_KEYS = [
  'crex_telegram_bot_config_v3',
  'crex_telegram_bot_config_v2',
  'crex_telegram_bot_config',
];

/**
 * Removes any legacy browser-stored Telegram config keys on app boot
 * so old tokens/chat IDs never remain in visitor localStorage.
 */
export function clearLegacyTelegramLocalStorage(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  for (const key of LEGACY_TELEGRAM_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore storage access errors in restricted browsing modes
    }
  }
}
