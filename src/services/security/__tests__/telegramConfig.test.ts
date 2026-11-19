import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TELEGRAM_CONFIG_DB_KEY,
  TELEGRAM_MIGRATION_FLAG_KEY,
  TELEGRAM_TOKEN_SECRET_DB_KEY,
  DEFAULT_TELEGRAM_SETTINGS,
  buildSafeTelegramStatus,
  loadTelegramFromDb,
  maskTokenLast4,
  resolveEffectiveTelegramToken,
  runOneTimeTelegramTokenMigration,
  saveTelegramToDb,
} from '../../../../server/telegramConfig';

function createMockAppSettingsDb(initial: Record<string, any> = {}) {
  const store = new Map<string, any>(Object.entries(initial));

  const db = {
    async query(sql: string, params: any[] = []) {
      const text = sql.trim();

      if (text.startsWith('SELECT key FROM app_settings WHERE key = $1')) {
        const key = params[0];
        return { rows: store.has(key) ? [{ key }] : [] };
      }

      if (text.startsWith('SELECT value FROM app_settings WHERE key = $1')) {
        const key = params[0];
        return { rows: store.has(key) ? [{ value: store.get(key) }] : [] };
      }

      if (text.startsWith('SELECT key, value FROM app_settings WHERE key = ANY')) {
        const keys: string[] = params[0] || [];
        const rows = keys
          .filter((k) => store.has(k))
          .map((k) => ({ key: k, value: store.get(k) }));
        return { rows };
      }

      if (text.startsWith('UPDATE app_settings SET value = $1')) {
        const [jsonVal, key] = params;
        store.set(key, JSON.parse(jsonVal));
        return { rows: [] };
      }

      if (text.startsWith('INSERT INTO app_settings')) {
        const [key, jsonVal] = params;
        if (text.includes('ON CONFLICT (key) DO NOTHING') && store.has(key)) {
          return { rows: [] };
        }
        store.set(key, JSON.parse(jsonVal));
        return { rows: [{ key }] };
      }

      if (text.startsWith('DELETE FROM app_settings WHERE key = $1')) {
        store.delete(params[0]);
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  return { db, store };
}

describe('Phase 2 Server-Only Telegram Config & Migration', () => {
  it('runs one-time startup migration that strips legacy botToken while preserving toggles and chatId', async () => {
    const { db, store } = createMockAppSettingsDb({
      [TELEGRAM_CONFIG_DB_KEY]: {
        enabled: true,
        botToken: '1111111111:LEGACY_TOKEN_VALUE_TO_REMOVE',
        chatId: '-100999888777',
        notifyWickets: true,
        notifyResults: true,
        notifyOverCompletion: false,
        notifyPeriodicDigest: true,
        notifyStrategyEntries: false,
        digestIntervalMinutes: 5,
      },
    });

    const logs: string[] = [];
    const firstRun = await runOneTimeTelegramTokenMigration(db, {
      log: (m: any) => logs.push(String(m)),
      warn: () => {},
    });

    assert.equal(firstRun.migrated, true);
    assert.equal(firstRun.hadLegacyToken, true);
    assert.ok(store.has(TELEGRAM_MIGRATION_FLAG_KEY));

    const updatedRow = store.get(TELEGRAM_CONFIG_DB_KEY);
    assert.equal('botToken' in updatedRow, false, 'botToken must be stripped from telegram_config');
    assert.equal(updatedRow.chatId, '-100999888777');
    assert.equal(updatedRow.enabled, true);
    assert.equal(updatedRow.notifyWickets, true);
    assert.equal(updatedRow.notifyResults, true);
    assert.equal(updatedRow.notifyOverCompletion, false);
    assert.equal(updatedRow.notifyPeriodicDigest, true);
    assert.equal(updatedRow.digestIntervalMinutes, 5);

    // Second run is a strict no-op
    const secondRun = await runOneTimeTelegramTokenMigration(db, {
      log: () => {},
      warn: () => {},
    });
    assert.equal(secondRun.migrated, false);
  });

  it('gives TELEGRAM_BOT_TOKEN env var priority over DB secret, and reports "not configured" when neither exists', () => {
    const envWins = resolveEffectiveTelegramToken('12345:ENV_SECRET_ABCD', '67890:DB_SECRET_WXYZ');
    assert.equal(envWins.configured, true);
    assert.equal(envWins.source, 'env');
    assert.equal(envWins.tokenLast4, 'ABCD');
    assert.equal(envWins.status, 'configured');

    const dbFallback = resolveEffectiveTelegramToken('', '67890:DB_SECRET_WXYZ');
    assert.equal(dbFallback.configured, true);
    assert.equal(dbFallback.source, 'db');
    assert.equal(dbFallback.tokenLast4, 'WXYZ');
    assert.equal(dbFallback.status, 'configured');

    const none = resolveEffectiveTelegramToken('', '');
    assert.equal(none.configured, false);
    assert.equal(none.source, 'none');
    assert.equal(none.tokenLast4, null);
    assert.equal(none.status, 'not configured');
  });

  it('never exposes raw botToken in safe status and stores admin-saved tokens separately from telegram_config', async () => {
    const { db, store } = createMockAppSettingsDb();

    const saveResult = await saveTelegramToDb(db, DEFAULT_TELEGRAM_SETTINGS, {
      enabled: true,
      chatId: '-1001234567890',
      notifyWickets: true,
      notifyResults: true,
      botToken: 'bot5555555555:NEW_ADMIN_SAVED_TOKEN_9876',
    });
    assert.equal(saveResult.tokenUpdated, true);

    // telegram_config row must NEVER hold botToken
    const cfgRow = store.get(TELEGRAM_CONFIG_DB_KEY);
    assert.equal('botToken' in cfgRow, false);
    assert.equal(cfgRow.chatId, '-1001234567890');
    assert.equal(store.get(TELEGRAM_TOKEN_SECRET_DB_KEY)?.token, '5555555555:NEW_ADMIN_SAVED_TOKEN_9876');

    const loaded = await loadTelegramFromDb(db);
    assert.ok(loaded.settings);
    const safeStatus = buildSafeTelegramStatus({
      envToken: '',
      envChatId: '',
      dbSecretToken: loaded.dbSecretToken,
      settings: loaded.settings,
    });

    assert.equal(safeStatus.configured, true);
    assert.equal(safeStatus.status, 'configured');
    assert.equal(safeStatus.tokenSource, 'db');
    assert.equal(safeStatus.tokenLast4, '9876');
    assert.equal(maskTokenLast4('bot5555555555:NEW_ADMIN_SAVED_TOKEN_9876'), '9876');
    assert.equal('botToken' in (safeStatus as any), false);
    assert.doesNotMatch(JSON.stringify(safeStatus), /NEW_ADMIN_SAVED_TOKEN/);

    // Clearing stored token works cleanly
    const clearResult = await saveTelegramToDb(db, loaded.settings, { clearStoredToken: true });
    assert.equal(clearResult.tokenCleared, true);
    assert.equal(store.has(TELEGRAM_TOKEN_SECRET_DB_KEY), false);
  });
});
